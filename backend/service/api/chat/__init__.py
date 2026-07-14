import dataclasses
from functools import partial
from database import (
    api_tx,
    row_str,
    row_str_or_none,
)
import asyncio
import duohash
import regex
import traceback
import sys
from websockets.exceptions import ConnectionClosedError
import notify
import webpushsender
from async_lru_cache import AsyncLruCache
from unseennotificationcount import increment_unseen_notification_count
import random
from collections.abc import Mapping
from datetime import datetime, timezone
from service.api.chat.robot9000 import Q_SELECT_INTRO_HASH, upsert_intro_hash
from service.api.chat.mayberegister import register_push_token
from service.api.chat.maybewebpush import (
    clear_web_push_subscription,
    fetch_web_push_subscriptions,
    register_web_push_subscription,
)
from service.api.chat.spam import is_spam_message
from service.api.chat.upsertlastnotification import upsert_last_notification
from service.api.chat.messagestorage.inbox import (
    get_inbox,
    get_inbox_entry,
    get_inbox_snapshot,
    mark_displayed,
)
from service.api.chat.messagestorage.mam import (
    get_conversation,
    microseconds_to_mam_message_id,
    sibling_mam_id,
)
from chatprotocol.mam_id import encode_mam_id
from service.api.chat.messagestorage import (
    store_message,
    store_reaction,
)
from service.api.chat.messagestorage.reaction import fetch_reaction_target
from service.api.chat.session import (
    Session,
    maybe_get_session_response,
)
from service.api.chat.online import (
    maybe_redis_subscribe_online,
    maybe_redis_unsubscribe_online,
    update_came_online_if_first_client,
    update_online_once,
    update_online_forever,
)
from service.api.chat.ratelimit import (
    maybe_fetch_rate_limit,
)
from service.api.chat.chatutil import (
    fetch_is_skipped,
    fetch_is_shadow_banned,
    fetch_has_gold,
    format_timestamp,
    now_microseconds,
    fetch_id_from_username,
    redis_has_subscribers,
    redis_publish_many,
    REDIS_HOST,
    REDIS_PORT,
    REDIS_WORKER_CLIENT,
)
from chatprotocol.message import (
    AudioMessage,
    ChatMessage,
    Message,
    ReactionMessage,
    TypingMessage,
)
from chatprotocol import (
    InboxQuery,
    InboxSnapshotQuery,
    MamQuery,
    MarkDisplayed,
    MarkVisitorsChecked,
    Ping,
    RegisterPushToken,
    RegisterWebPushSubscription,
    SessionRequest,
    SubscribeOnline,
    UnsubscribeOnline,
    VisitorsQuery,
    parse_incoming,
)
from service.api.chat.visitors import (
    get_visitors_snapshot,
    mark_visitors_checked,
)
from chatprotocol.outbound import (
    IncomingChat,
    IncomingReaction,
    IncomingTyping,
    MessageBlocked,
    MessageDelivered,
    MessageNotUnique,
    MessageTooLong,
    Outbound,
    Pong,
    ReactionBlocked,
    ReactionDelivered,
    RegistrationSuccessful,
    ServerError,
    answer_to_wire,
    from_bus,
)
from service.api.chat.questioncard import (
    fetch_card,
    fetch_question,
)
from service.api.chat.audiomessage import (
    transcode_and_put,
)
import redis.asyncio as redis
from fastapi import WebSocket, WebSocketDisconnect
import json
from constants import (
    MAX_NOTIFICATION_LENGTH,
)
from util import truncate_text, Json
from service.api.chat.verification import (
    verification_required,
)

Q_HAS_MESSAGE = """
SELECT
    1
FROM
    messaged
WHERE
    subject_person_id = %(to_id)s AND object_person_id = %(from_id)s
"""

# Accounts are trusted after they've been around for a day. Verified accounts
# are trusted a bit sooner.
Q_IS_TRUSTED_ACCOUNT = """
SELECT
    1
FROM
    person
WHERE
    id = %(from_id)s
AND
    sign_up_time < now() - (interval '1 day') / power(verification_level_id, 2)
"""

_Q_SENDER_CARD = """
{prefix}SELECT
    person.id AS person_id,
    person.uuid::TEXT AS person_uuid,
    person.name AS name,
    photo.uuid AS photo_uuid,
    photo.blurhash AS photo_blurhash
FROM
    person
LEFT JOIN
    photo
ON
    photo.person_id = person.id
WHERE
    person.id = %(from_id)s{gate}
ORDER BY
    photo.position
LIMIT 1
"""

Q_IMMEDIATE_DATA = _Q_SENDER_CARD.format(
    prefix="""WITH to_notification AS (
    SELECT
        1
    FROM
        person
    WHERE
        id = %(to_id)s
    AND
        [[type]]_notification = 1 -- Immediate notification ID
)
""",
    gate="""
AND
    EXISTS (SELECT 1 FROM to_notification)""")

Q_IMMEDIATE_INTRO_DATA = Q_IMMEDIATE_DATA.replace('[[type]]', 'intros')

Q_IMMEDIATE_CHAT_DATA = Q_IMMEDIATE_DATA.replace('[[type]]', 'chats')

Q_SELECT_PUSH_TOKENS = """
WITH session_summary AS (
    SELECT
        ARRAY_AGG(DISTINCT duo_session.push_token)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS push_tokens,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NULL) AS web_last_online,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS mobile_last_online
    FROM
        duo_session
    JOIN
        person
    ON
        person.id = duo_session.person_id
    WHERE
        person.uuid = uuid_or_null(%(username)s)
    AND
        duo_session.signed_in
)
SELECT
    unnest(push_tokens) AS token
FROM
    session_summary
WHERE
    -- A web session being strictly more recent means we defer the whole
    -- notification to the cron, which pushes *and* emails. Pushing here would
    -- upsert the last-notification time and suppress that email. Ties favour
    -- mobile, matching the cron's web-vs-mobile comparison.
    NOT COALESCE(web_last_online > mobile_last_online, FALSE)
"""

Q_WEB_PUSH_DATA = _Q_SENDER_CARD.format(prefix='', gate='')

MAX_MESSAGE_LEN = 5000

NON_ALPHANUMERIC_RE = regex.compile(r'[^\p{L}\p{N}]')
REPEATED_CHARACTERS_RE = regex.compile(r'(.)\1{1,}')


async def redis_forward_to_websocket(
    pubsub: redis.client.PubSub,
    websocket: WebSocket
) -> None:
    """
    Listens on the Redis subscription channel and forwards any messages to the
    connected websocket client, rendering each protocol-neutral bus payload to
    JSON.
    """
    try:
        async for message in pubsub.listen():
            if message is None or message.get("type") != "message":
                continue

            try:
                outbound = from_bus(message['data'])
                data = outbound.to_json()
            except:
                continue

            await websocket.send_text(data)
    except asyncio.CancelledError:
        raise
    except:
        print(traceback.format_exc())


async def _is_online(username: str, has_subscribers: bool | None) -> bool:
    if has_subscribers is not None:
        return has_subscribers

    return await redis_has_subscribers(REDIS_WORKER_CLIENT, username)


async def send_notification(
    from_name: str | None,
    to_username: str | None,
    message: str | None,
    is_intro: bool,
    data: object,
    title: str | None = None,
    has_subscribers: bool | None = None,
) -> None:
    if from_name is None:
        return None

    if to_username is None:
        return

    if message is None:
        return

    if data is None:
        return

    to_tokens = await fetch_push_tokens(username=to_username)

    # No device is reachable by push notification. Leave the last-notification
    # time untouched so the cron job falls back to emailing the user.
    if not to_tokens:
        return

    truncated_message = truncate_text(message, MAX_NOTIFICATION_LENGTH)

    online = await _is_online(to_username, has_subscribers)

    # The app-icon badge counts pushes sent while the user had no connected
    # clients. With a client open, the user can see the message themselves, so
    # the counter is left alone and the badge omitted, which leaves each
    # device's badge untouched.
    badge = (
        None
        if online
        else await increment_unseen_notification_count(username=to_username))

    for to_token in to_tokens:
        notify.enqueue_mobile_notification(
            token=to_token,
            title=title if title is not None else _default_notification_title(from_name),
            body=truncated_message,
            data=data,
            badge=badge,
        )

    upsert_last_notification(username=to_username, is_intro=is_intro)


def _default_notification_title(from_name: str) -> str:
    return f"{from_name} sent you a message"


def _reaction_notification_title(from_name: str, emoji: str) -> str:
    return f"{from_name} reacted {emoji} to your message"


def _conversation_screen_data(
    immediate_data: Mapping[str, Json],
) -> Json:
    return {
        'screen': 'Conversation Screen',
        'params': {
            'personId': immediate_data['person_id'],
            'personUuid': immediate_data['person_uuid'],
            'name': immediate_data['name'],
            'photoUuid': immediate_data['photo_uuid'],
            'photoBlurhash': immediate_data['photo_blurhash'],
        },
    }


def normalize_message(message_str: str) -> str:
    message_str = message_str.lower()

    # Remove everything but non-alphanumeric characters
    message_str = NON_ALPHANUMERIC_RE.sub('', message_str)

    # Remove repeated characters
    message_str = REPEATED_CHARACTERS_RE.sub(r'\1', message_str)

    return message_str


def is_text_too_long(message: Message) -> bool:
    if isinstance(message, ChatMessage):
        return len(message.body) > MAX_MESSAGE_LEN
    else:
        return False


def estimated_used_count(measured_count: int, ramp_at: int = 3333) -> int:
    # TODO: When this is removed, the tests should be updated
    #
    # intro_hash tracking started after the app launched, so raw counts are
    # under-estimates; prorate to approximate what the true count would be.
    if measured_count <= 1:
        return measured_count

    app_launched = datetime(2023, 8, 26, 1, 5, 49, tzinfo=timezone.utc)
    intro_hash_counting_started = datetime(2026, 6, 3, 1, 18, 0, tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)

    seconds_since_app_launched = (
            now - app_launched).total_seconds()

    seconds_since_intro_hash_counting = (
            now - intro_hash_counting_started).total_seconds()

    prorating = seconds_since_app_launched / seconds_since_intro_hash_counting

    prorating_certainty = max(0, min(1, measured_count / ramp_at))

    return round(
            measured_count * (1 - prorating_certainty) +
            measured_count * (0 + prorating_certainty) * prorating)


def _positive_count(count: object) -> bool:
    return isinstance(count, int) and count > 0


@AsyncLruCache(ttl=1, cache_condition=_positive_count)
async def intro_use_count(message: Message) -> int:
    if isinstance(message, AudioMessage):
        return 0

    if isinstance(message, TypingMessage):
        return 0

    normalized = normalize_message(message.body)
    hashed = duohash.md5(normalized)

    params = dict(hash=hashed)

    async with api_tx('read committed') as tx:
        cursor = await tx.execute(Q_SELECT_INTRO_HASH, params)
        row = await cursor.fetchone()

    upsert_intro_hash(hashed)

    return row['used_count'] if row is not None else 0

@AsyncLruCache(cache_condition=lambda x: not x)
async def fetch_is_intro(from_id: int, to_id: int) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_HAS_MESSAGE, dict(from_id=from_id, to_id=to_id))
        row = await tx.fetchone()

    return not bool(row)

@AsyncLruCache(ttl=5)  # 5 seconds
async def fetch_is_trusted_account(from_id: int) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(
                Q_IS_TRUSTED_ACCOUNT,
                dict(from_id=from_id))
        row = await tx.fetchone()

    return bool(row)

@AsyncLruCache(ttl=2 * 60)  # 2 minutes
async def fetch_push_tokens(username: str) -> list[str]:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_SELECT_PUSH_TOKENS, dict(username=username))
        rows = await tx.fetchall()

    return list({row_str(row, 'token') for row in rows})

@AsyncLruCache(ttl=10)  # 10 seconds
async def fetch_immediate_data(
    from_id: int,
    to_id: int,
    is_intro: bool,
) -> Mapping[str, Json] | None:
    q = Q_IMMEDIATE_INTRO_DATA if is_intro else Q_IMMEDIATE_CHAT_DATA

    async with api_tx('read committed') as tx:
        await tx.execute(q, dict(from_id=from_id, to_id=to_id))
        row = await tx.fetchone()

    return row if row else None


@AsyncLruCache(ttl=10)  # 10 seconds
async def fetch_web_push_data(from_id: int) -> Mapping[str, Json] | None:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_WEB_PUSH_DATA, dict(from_id=from_id))
        row = await tx.fetchone()

    return row if row else None


async def send_web_push_notification(
    from_id: int,
    to_username: str | None,
    message: str | None,
    immediate_data: Mapping[str, Json] | None,
    emoji: str | None = None,
    has_subscribers: bool | None = None,
) -> None:
    if to_username is None:
        return

    if message is None:
        return

    if not await _is_online(to_username, has_subscribers):
        return

    subscriptions = await fetch_web_push_subscriptions(username=to_username)
    if not subscriptions:
        return

    data = (
        immediate_data
        if immediate_data is not None
        else await fetch_web_push_data(from_id=from_id))
    if data is None:
        return

    from_name = row_str_or_none(data, 'name')
    if from_name is None:
        return

    title = (
        _reaction_notification_title(from_name, emoji)
        if emoji is not None
        else _default_notification_title(from_name))
    body = truncate_text(message, MAX_NOTIFICATION_LENGTH)
    routing = _conversation_screen_data(data)

    for session_token_hash, subscription in subscriptions:
        webpushsender.enqueue_web_push(
            subscription=subscription,
            title=title,
            body=body,
            data=routing,
            on_gone=partial(clear_web_push_subscription, session_token_hash),
        )


async def _chat_interaction_blocked(
    from_id: int,
    to_id: int,
) -> tuple[bool, str | None]:
    """
    Whether `from_id` may not currently interact with `to_id` (whether sending a
    message or reacting to one), as `(blocked, reason)`. `reason` is the
    client-facing `MessageBlocked` reason (None for a generic block) and is only
    meaningful when `blocked` is True. Each caller renders its own stanza
    (`MessageBlocked` or `ReactionBlocked`); only the gating rules are shared.
    """
    if await verification_required(person_id=from_id):
        return True, 'age-verification'

    if await fetch_is_skipped(from_id=from_id, to_id=to_id):
        return True, None

    return False, None


async def _publish_inbox_entry(
    viewer_username: str,
    prospect_username: str,
    has_subscribers: bool | None = None,
) -> None:
    # An offline viewer gets the whole inbox via `duo_query_inbox` on reconnect.
    if not await _is_online(viewer_username, has_subscribers):
        return

    await redis_publish_many(
        viewer_username,
        await get_inbox_entry(
            viewer_username=viewer_username,
            prospect_username=prospect_username))


async def _send_reaction_notification(
    from_id: int,
    partner_id: int,
    partner_username: str,
    emoji: str,
    target_body: str,
    has_subscribers: bool | None = None,
) -> None:
    immediate_data = await fetch_immediate_data(
        from_id=from_id,
        to_id=partner_id,
        is_intro=False)

    await send_web_push_notification(
        from_id=from_id,
        to_username=partner_username,
        message=target_body,
        immediate_data=immediate_data,
        emoji=emoji,
        has_subscribers=has_subscribers,
    )

    if immediate_data is None:
        return

    from_name = row_str_or_none(immediate_data, 'name')
    if from_name is None:
        return

    await send_notification(
        from_name=from_name,
        to_username=partner_username,
        message=target_body,
        is_intro=False,
        title=_reaction_notification_title(from_name, emoji),
        data=_conversation_screen_data(immediate_data),
        has_subscribers=has_subscribers,
    )


async def _handle_reaction(
    parsed: ReactionMessage,
    from_username: str,
    connection_uuid: str,
) -> None:
    async def reject() -> None:
        await redis_publish_many(connection_uuid, [
            ReactionBlocked(stanza_id=parsed.stanza_id)
        ])

    reactor_copy_id = parsed.target_mam_message_id

    from_id = await fetch_id_from_username(from_username)
    if not from_id:
        return None

    target = await fetch_reaction_target(
        reactor_username=from_username,
        reactor_copy_id=reactor_copy_id,
    )
    if target is None:
        return await reject()

    partner_username = target.partner_username

    partner_id = await fetch_id_from_username(partner_username)
    if partner_id is None:
        return await reject()

    is_blocked, _ = await _chat_interaction_blocked(
        from_id=from_id,
        to_id=partner_id,
    )
    if is_blocked:
        return await reject()

    deliver_to_partner = not await fetch_is_shadow_banned(from_id)

    stored = await store_reaction(
        reactor_username=from_username,
        partner_username=partner_username,
        reactor_id=from_id,
        partner_id=partner_id,
        reactor_copy_id=reactor_copy_id,
        emoji=parsed.emoji,
        previous_reaction=target.previous_reaction,
        target_body=target.target_body,
        deliver_to_recipient=deliver_to_partner,
    )

    if stored is None:
        return await reject()

    stamp = format_timestamp(now_microseconds())

    partner_has_subscribers = await redis_has_subscribers(
        REDIS_WORKER_CLIENT, partner_username)

    if stored.partner_inbox_updated:
        await _publish_inbox_entry(
            viewer_username=partner_username,
            prospect_username=from_username,
            has_subscribers=partner_has_subscribers)

    if stored.reactor_inbox_updated:
        await _publish_inbox_entry(
            viewer_username=from_username,
            prospect_username=partner_username)

    if deliver_to_partner:
        await redis_publish_many(partner_username, [
            IncomingReaction(
                from_username=from_username,
                to_username=partner_username,
                mam_id=encode_mam_id(sibling_mam_id(reactor_copy_id)),
                emoji=parsed.emoji,
                stamp=stamp,
            )
        ])

    if deliver_to_partner and stored.is_new_visible_reaction:
        await _send_reaction_notification(
            from_id=from_id,
            partner_id=partner_id,
            partner_username=partner_username,
            emoji=parsed.emoji,
            target_body=target.target_body,
            has_subscribers=partner_has_subscribers)

    await redis_publish_many(connection_uuid, [
        ReactionDelivered(stanza_id=parsed.stanza_id, stamp=stamp)
    ])


async def process_text(
    session: Session,
    pubsub: redis.client.PubSub,
    text: str
) -> object | None:
    from_username = session.username
    connection_uuid = session.connection_uuid

    parsed = parse_incoming(text)

    if parsed is None:
        return None

    if isinstance(parsed, SessionRequest):
        return await redis_publish_many(
                connection_uuid,
                await maybe_get_session_response(parsed, session))

    if isinstance(parsed, Ping):
        return await redis_publish_many(connection_uuid, [Pong()])

    # Online-status subscriptions are handled before the authentication gate so
    # that logged-out viewers can see the online status of public profiles. The
    # subscription handler itself restricts unauthenticated viewers to profiles
    # which have opted in to `public_profile`.
    if isinstance(parsed, SubscribeOnline):
        return await redis_publish_many(
                connection_uuid,
                await maybe_redis_subscribe_online(
                    from_username=from_username,
                    to_username=parsed.uuid,
                    redis_client=REDIS_WORKER_CLIENT,
                    pubsub=pubsub,
                    session=session))

    if isinstance(parsed, UnsubscribeOnline):
        return await redis_publish_many(
                connection_uuid,
                await maybe_redis_unsubscribe_online(
                    username=parsed.uuid,
                    pubsub=pubsub,
                    session=session))

    if not from_username:
        return None

    if isinstance(parsed, RegisterPushToken):
        if register_push_token(parsed, session.session_token_hash):
            return await redis_publish_many(
                    connection_uuid, [RegistrationSuccessful()])
        return None

    if isinstance(parsed, RegisterWebPushSubscription):
        registered = register_web_push_subscription(
                parsed, session.session_token_hash)
        return await redis_publish_many(
                connection_uuid,
                [RegistrationSuccessful()] if registered else [])

    if isinstance(parsed, MamQuery):
        return await redis_publish_many(
                connection_uuid,
                await get_conversation(parsed, from_username))

    if isinstance(parsed, InboxQuery):
        return await redis_publish_many(
                connection_uuid,
                await get_inbox(parsed.query_id, from_username))

    if isinstance(parsed, InboxSnapshotQuery):
        return await redis_publish_many(
                connection_uuid,
                await get_inbox_snapshot(from_username))

    if isinstance(parsed, VisitorsQuery):
        return await redis_publish_many(
                connection_uuid,
                await get_visitors_snapshot(from_username))

    if isinstance(parsed, MarkVisitorsChecked):
        await mark_visitors_checked(username=from_username, when=parsed.when)
        return None

    if isinstance(parsed, MarkDisplayed):
        displayed_to = parsed.to_username

        reader_id = await fetch_id_from_username(from_username)
        publish_receipt = (
            reader_id is not None and
            not await fetch_is_shadow_banned(reader_id) and
            await fetch_has_gold(displayed_to)
        )

        mark_displayed(
            from_username=from_username,
            to_username=displayed_to,
            publish_receipt=publish_receipt,
        )
        return None

    if isinstance(parsed, ReactionMessage):
        await _handle_reaction(
            parsed=parsed,
            from_username=from_username,
            connection_uuid=connection_uuid,
        )
        return None

    maybe_message = parsed if isinstance(parsed, Message) else None

    if not maybe_message:
        return None

    stanza_id = maybe_message.stanza_id

    to_username = maybe_message.to_username

    from_id = await fetch_id_from_username(from_username)

    if not from_id:
        return None

    to_id = await fetch_id_from_username(to_username)

    if not to_id:
        return None

    question_id = (
        maybe_message.question_id
        if isinstance(maybe_message, ChatMessage)
        else None)

    if (
        isinstance(maybe_message, ChatMessage) and
        question_id is not None and
        await fetch_question(question_id) is None
    ):
        maybe_message = dataclasses.replace(maybe_message, question_id=None)
        question_id = None

    # Shadow-banned senders perceive the app as normal -- validation runs as
    # usual and their own client/storage behave normally -- but nothing they
    # send reaches the recipient: no real-time delivery, push notification, or
    # recipient-side storage. Their own copy (MAM + chats list) is still stored
    # so their conversation history persists when they navigate back to it.
    is_shadow_banned = await fetch_is_shadow_banned(from_id)

    is_blocked, block_reason = await _chat_interaction_blocked(
        from_id=from_id,
        to_id=to_id,
    )
    if is_blocked:
        return await redis_publish_many(connection_uuid, [
            MessageBlocked(stanza_id=stanza_id, reason=block_reason)
        ])

    if isinstance(maybe_message, TypingMessage):
        # A shadow-banned sender's typing indicator must not reach the recipient.
        if is_shadow_banned:
            return None

        return await redis_publish_many(to_username, [
            IncomingTyping(
                from_username=from_username,
                to_username=to_username,
                stanza_id=maybe_message.stanza_id,
            )
        ])

    if is_text_too_long(maybe_message):
        return await redis_publish_many(connection_uuid, [
            MessageTooLong(stanza_id=stanza_id)
        ])

    is_intro = await fetch_is_intro(from_id=from_id, to_id=to_id)

    if \
            is_intro and \
            is_spam_message(maybe_message) and \
            not await fetch_is_trusted_account(from_id=from_id):
        return await redis_publish_many(connection_uuid, [
            MessageBlocked(stanza_id=stanza_id, reason='spam')
        ])

    if is_intro:
        maybe_rate_limit = await maybe_fetch_rate_limit(
                from_id=from_id,
                stanza_id=stanza_id)

        if maybe_rate_limit:
            return await redis_publish_many(connection_uuid, maybe_rate_limit)

    used_count = await intro_use_count(maybe_message) if is_intro else 0
    if is_intro and used_count > 0:
        return await redis_publish_many(connection_uuid, [
            MessageNotUnique(
                stanza_id=stanza_id,
                used_count=estimated_used_count(used_count),
            )
        ])

    # The same instant is used to stamp the stored message and the delivery
    # receipt, so the sender's client can timestamp its own message in server
    # time (rather than its possibly-skewed local clock). This keeps read
    # receipts, which are compared against this timestamp, accurate.
    sent_at_microseconds = now_microseconds()
    sent_at_stamp = format_timestamp(sent_at_microseconds)

    async def store_audio_and_notify() -> None:
        if \
                isinstance(maybe_message, AudioMessage) and \
                not await transcode_and_put(
                    uuid=maybe_message.audio_uuid,
                    audio_base64=maybe_message.audio_base64,
                ):
            await redis_publish_many(connection_uuid, [
                ServerError(stanza_id=stanza_id)
            ])
            return None

        audio_uuid = (
                maybe_message.audio_uuid
                if isinstance(maybe_message, AudioMessage)
                else None)

        sender_copy_id = microseconds_to_mam_message_id(sent_at_microseconds)
        sender_mam_id = encode_mam_id(sender_copy_id)
        recipient_mam_id = encode_mam_id(sibling_mam_id(sender_copy_id))

        card = (
            await fetch_card(
                question_id=question_id,
                viewer_id=to_id,
                partner_id=from_id,
            )
            if question_id is not None
            else None)

        delivery_message = IncomingChat(
            from_username=from_username,
            to_username=to_username,
            stanza_id=maybe_message.stanza_id,
            body=maybe_message.body,
            audio_uuid=audio_uuid,
            mam_id=recipient_mam_id,
            question_id=question_id if card else None,
            question=card.question if card else None,
            question_topic=card.topic if card else None,
            viewer_answer=answer_to_wire(card.viewer_answer) if card else None,
            viewer_answer_public=card.viewer_answer_public if card else None,
            partner_answer=answer_to_wire(card.partner_answer) if card else None,
        )

        immediate_data = await fetch_immediate_data(
                from_id=from_id,
                to_id=to_id,
                is_intro=is_intro)

        to_has_subscribers = (
            None
            if is_shadow_banned
            else await redis_has_subscribers(REDIS_WORKER_CLIENT, to_username))

        if immediate_data is not None and not is_shadow_banned:
            await send_notification(
                from_name=row_str_or_none(immediate_data, 'name'),
                to_username=to_username,
                message=maybe_message.body,
                is_intro=is_intro,
                data=_conversation_screen_data(immediate_data),
                has_subscribers=to_has_subscribers,
            )

        response = MessageDelivered(
            stanza_id=stanza_id,
            stamp=sent_at_stamp,
            audio_uuid=(
                maybe_message.audio_uuid
                if isinstance(maybe_message, AudioMessage)
                else None),
            mam_id=sender_mam_id,
        )

        # Don't deliver to the recipient when the sender is shadow-banned; the
        # sender still gets their delivery receipt below.
        if not is_shadow_banned:
            # The complete inbox entry goes out before the message itself so
            # that by the time the recipient's client reacts to the message,
            # its inbox already has the sender's info. This runs after the
            # message is stored, so the entry reflects the new message.
            await _publish_inbox_entry(
                viewer_username=to_username,
                prospect_username=from_username,
                has_subscribers=to_has_subscribers)

            await redis_publish_many(to_username, [delivery_message])

            await send_web_push_notification(
                from_id=from_id,
                to_username=to_username,
                message=maybe_message.body,
                immediate_data=immediate_data,
                has_subscribers=to_has_subscribers,
            )

        await redis_publish_many(connection_uuid, [response])

    store_message(
        from_username=from_username,
        to_username=to_username,
        from_id=from_id,
        to_id=to_id,
        msg_id=stanza_id,
        message=maybe_message,
        deliver_to_recipient=not is_shadow_banned,
        callback=store_audio_and_notify,
        timestamp_microseconds=sent_at_microseconds)
    return None


async def process_websocket_messages(websocket: WebSocket) -> None:
    await websocket.accept(subprotocol='json')

    session = Session()

    redis_websocket_client: redis.Redis = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            decode_responses=True)

    pubsub = redis_websocket_client.pubsub()

    await pubsub.subscribe(session.connection_uuid)

    # asyncio.create_task requires some manual memory management!
    # https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
    # https://github.com/python/cpython/issues/91887
    update_online_task = None

    redis_forward_to_websocket_task = asyncio.create_task(
            redis_forward_to_websocket(pubsub, websocket))

    is_subscribed_by_username = False

    try:
        while True:
            text = await websocket.receive_text()

            await asyncio.shield(
                    process_text(
                        session=session,
                        pubsub=pubsub,
                        text=text))

            if not update_online_task and session.username:
                # This runs before the `pubsub.subscribe(session.username)`
                # below, which is what counts as a connected client, so at
                # this point the subscriber count still excludes this
                # connection.
                await update_came_online_if_first_client(
                    redis_client=REDIS_WORKER_CLIENT,
                    session=session,
                )

                update_online_task = asyncio.create_task(
                    update_online_forever(
                        redis_client=REDIS_WORKER_CLIENT,
                        session=session,
                        online=True
                    )
                )


            if not is_subscribed_by_username and session.username:
                await pubsub.subscribe(session.username)
                is_subscribed_by_username = True
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        raise
    except:
        print(
            datetime.utcnow(),
            f"Exception while processing for username: {session.username}"
        )
        print(traceback.format_exc())
    finally:
        if update_online_task:
            update_online_task.cancel()

            try:
                await update_online_task
            except asyncio.CancelledError:
                pass

            # Drop this connection's subscription to the user's own channel
            # before counting subscribers, so the count only reflects the
            # user's other connections. If another client is still connected,
            # the user stays 'online'; only losing the last connection demotes
            # them to 'online-recently'.
            if is_subscribed_by_username and session.username:
                try:
                    await pubsub.unsubscribe(session.username)
                except:
                    print(traceback.format_exc())

            try:
                await update_online_once(
                    redis_client=REDIS_WORKER_CLIENT,
                    session=session,
                    online=bool(
                        session.username and
                        await redis_has_subscribers(
                            REDIS_WORKER_CLIENT, session.username)),
                )
            except asyncio.CancelledError:
                pass

        if redis_forward_to_websocket_task:
            redis_forward_to_websocket_task.cancel()
            try:
                await redis_forward_to_websocket_task
            except asyncio.CancelledError:
                pass

        await pubsub.close()
        await redis_websocket_client.close()
