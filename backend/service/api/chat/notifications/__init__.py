import notify
import webpushsender
from async_lru_cache import AsyncLruCache
from chatprotocol.message import gif_aware_body
from collections.abc import Mapping
from constants import MAX_NOTIFICATION_LENGTH
from database import api_tx, row_str, row_str_or_none
from functools import partial
from service.api.chat.chatutil import is_online
from service.api.chat.maybewebpush import (
    clear_web_push_subscription,
    fetch_web_push_subscriptions,
)
from service.api.chat.upsertlastnotification import upsert_last_notification
from unseennotificationcount import increment_unseen_notification_count
from util import truncate_text, Json

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


async def send_notifications(
    from_id: int,
    to_username: str,
    message: str,
    is_intro: bool,
    immediate_data: Mapping[str, Json] | None,
    emoji: str | None = None,
    has_subscribers: bool | None = None,
) -> None:
    data = (
        immediate_data
        if immediate_data is not None
        else await fetch_web_push_data(from_id=from_id))
    if data is None:
        return

    from_name = row_str_or_none(data, 'name')
    if from_name is None:
        return

    online = await is_online(to_username, has_subscribers)

    title = _notification_title(from_name, emoji)
    body = _notification_body(message)
    routing = _conversation_screen_data(data)

    if immediate_data is not None:
        await _send_mobile_push(
            to_username=to_username,
            title=title,
            body=body,
            routing=routing,
            is_intro=is_intro,
            online=online,
        )

    if not online:
        return

    await _send_web_push(
        to_username=to_username,
        title=title,
        body=body,
        routing=routing,
    )


async def send_reaction_notifications(
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

    await send_notifications(
        from_id=from_id,
        to_username=partner_username,
        message=target_body,
        is_intro=False,
        immediate_data=immediate_data,
        emoji=emoji,
        has_subscribers=has_subscribers,
    )


async def _send_mobile_push(
    to_username: str,
    title: str,
    body: str,
    routing: Json,
    is_intro: bool,
    online: bool,
) -> None:
    to_tokens = await fetch_push_tokens(username=to_username)

    # No device is reachable by push notification. Leave the last-notification
    # time untouched so the cron job falls back to emailing the user.
    if not to_tokens:
        return

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
            title=title,
            body=body,
            data=routing,
            badge=badge,
        )

    upsert_last_notification(username=to_username, is_intro=is_intro)


async def _send_web_push(
    to_username: str,
    title: str,
    body: str,
    routing: Json,
) -> None:
    subscriptions = await fetch_web_push_subscriptions(username=to_username)
    if not subscriptions:
        return

    for session_token_hash, subscription in subscriptions:
        webpushsender.enqueue_web_push(
            subscription=subscription,
            title=title,
            body=body,
            data=routing,
            on_gone=partial(clear_web_push_subscription, session_token_hash),
        )


def _default_notification_title(from_name: str) -> str:
    return f"{from_name} sent you a message"


def _reaction_notification_title(from_name: str, emoji: str) -> str:
    return f"{from_name} reacted {emoji} to your message"


def _notification_title(from_name: str, emoji: str | None) -> str:
    if emoji is None:
        return _default_notification_title(from_name)
    return _reaction_notification_title(from_name, emoji)


def _notification_body(message: str) -> str:
    return truncate_text(gif_aware_body(message), MAX_NOTIFICATION_LENGTH)


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
