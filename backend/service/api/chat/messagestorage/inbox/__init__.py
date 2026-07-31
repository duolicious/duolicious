import traceback

from batcher import Batcher
from constants import LAST_ONLINE_DEFAULT_SECONDS
from database import Row, Tx, api_tx, row_int, row_str
from searchfilters import (
    Q_SEARCH_PARAMETERS_BY_UUID,
    SearchParam,
    and_clauses,
    prospect_filters,
    two_way_filters,
)
from dataclasses import dataclass
from datetime import datetime
from service.api.chat.chatutil import (
    LSERVER,
    format_datetime,
    format_timestamp,
    redis_publish_many,
)
from chatprotocol.message import (
    gif_aware_body,
)
from chatprotocol.outbound import (
    InboxConversation,
    InboxEntry,
    InboxFin,
    InboxResult,
    InboxSnapshot,
    Outbound,
    ReadReceipt,
)

Q_GET_INBOX = f"""
SELECT
    *
FROM
    inbox
WHERE
    luser = %(username)s
ORDER BY
    timestamp
"""


# This query joins the gating rules (which fields a viewer may see, and which
# box the conversation belongs in) against the viewer's `inbox` rows so one
# websocket response carries complete conversations.
#
# `entry_predicate` narrows the viewer's `inbox` rows: empty for the whole-inbox
# snapshot, or an equality on `remote_bare_jid` (the primary key's second
# column) for a single conversation. The predicate is kept a plain equality --
# rather than an `%(x)s IS NULL OR ...` that serves both -- so the single-entry
# query gets an index scan on `inbox_pkey` even under a generic plan, which a
# parameterised `IS NULL` branch would defeat.
#
# `matches_search_filters` says whether an intro's sender passes the viewer's
# search filters, so clients can sort and flag intros from outside them. It is
# built from `searchfilters.prospect_filters` and `two_way_filters` (the same
# prospect-level predicates the search applies), so it can't drift from the
# search, which additionally applies `search_only_clauses` -- the ones that
# can't apply to an intro. Non-intro conversations are always TRUE.
def _q_inbox_snapshot(
    entry_predicate: str,
    matches_search_filters: str,
) -> str:
    return f"""
WITH viewer AS (
    SELECT
        id,
        personality
    FROM
        person
    WHERE
        uuid = %(username)s::uuid
), entry AS (
    SELECT
        uuid_or_null(split_part(remote_bare_jid, '@', 1)) AS prospect_uuid,
        body,
        reaction,
        reaction_body,
        COALESCE(unread_count, 0) AS unread_count,
        timestamp
    FROM
        inbox
    WHERE
        luser = %(username)s::text
    {entry_predicate}
), conversation AS (
    SELECT
        entry.prospect_uuid,
        entry.body,
        entry.reaction,
        entry.reaction_body,
        entry.unread_count,
        entry.timestamp,
        prospect.url_slug AS url_slug,
        prospect.name AS name,
        COALESCE(prospect.verification_level_id > 1, FALSE) AS verified,
        photo.uuid AS image_uuid,
        photo.blurhash AS image_blurhash,
        CLAMP(
            0,
            99,
            100 * (1 - (viewer.personality <#> prospect.personality)) / 2
        )::SMALLINT AS match_percentage,
        prospect.id IS NULL AS is_prospect_deleted,
        COALESCE(
            prospect.activated AND prospect.shadow_banned_at IS NULL, FALSE
        ) AS is_prospect_activated,
        COALESCE(
            prospect.last_online_time >
                NOW() - %(recently_online_seconds)s * INTERVAL '1 second',
            FALSE
        ) AS is_prospect_recently_online,
        -- Only for the final SELECT's `matches_search_filters` probe; never
        -- sent to the client.
        prospect.id AS prospect_id,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = viewer.id
            AND
                object_person_id = prospect.id
        ) AS person_messaged_prospect,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = prospect.id
            AND
                object_person_id = viewer.id
        ) AS prospect_messaged_person,
        EXISTS (
            SELECT
                1
            FROM
                skipped
            WHERE
                subject_person_id = viewer.id
            AND
                object_person_id = prospect.id
        ) AS person_skipped_prospect,
        EXISTS (
            SELECT
                1
            FROM
                skipped
            WHERE
                subject_person_id = prospect.id
            AND
                object_person_id = viewer.id
        ) AS prospect_skipped_person
    FROM
        entry
    LEFT JOIN
        person AS prospect
    ON
        prospect.uuid = entry.prospect_uuid
    LEFT JOIN
        viewer
    ON
        TRUE
    LEFT JOIN LATERAL (
        SELECT
            uuid,
            blurhash
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS photo
    ON
        TRUE
), gated AS (
    SELECT
        conversation.*,
        is_prospect_activated AND NOT prospect_skipped_person AS is_available,
        CASE
            WHEN
                    NOT is_prospect_deleted
                AND
                    NOT prospect_messaged_person
            THEN 'nowhere'
            WHEN
                    is_prospect_activated
                AND
                    is_prospect_recently_online
                AND
                    NOT prospect_skipped_person
                AND
                    NOT person_skipped_prospect
                AND
                    prospect_messaged_person
                AND
                    person_messaged_prospect
            THEN 'chats'
            WHEN
                    is_prospect_activated
                AND
                    is_prospect_recently_online
                AND
                    NOT prospect_skipped_person
                AND
                    NOT person_skipped_prospect
                AND
                    prospect_messaged_person
                AND
                    NOT person_messaged_prospect
            THEN 'intros'
            ELSE 'archive'
        END AS location
    FROM
        conversation
    OFFSET 0
)
SELECT
    prospect_uuid::TEXT AS person_uuid,
    url_slug,
    CASE WHEN is_available THEN name END AS name,
    CASE WHEN is_available THEN match_percentage END AS match_percentage,
    CASE WHEN is_available THEN image_uuid END AS image_uuid,
    CASE WHEN is_available THEN image_blurhash END AS image_blurhash,
    is_available AND verified AS is_verified,
    is_available,
    location,
    body AS last_message,
    reaction,
    reaction_body,
    unread_count = 0 AS last_message_read,
    timestamp AS last_message_timestamp,
    CASE
        WHEN location = 'intros'
        THEN COALESCE(
            (
                SELECT
                    {matches_search_filters}
                FROM
                    person AS prospect
                WHERE
                    prospect.id = gated.prospect_id
            ),
            FALSE
        )
        ELSE TRUE
    END AS matches_search_filters
FROM
    gated
WHERE
    location <> 'nowhere'
ORDER BY
    timestamp
"""


# The whole inbox: no extra `entry` predicate beyond the viewer's `luser`.
_ENTRY_PREDICATE_SNAPSHOT = ''

# A single conversation: a plain primary-key equality on `remote_bare_jid`.
_ENTRY_PREDICATE_ENTRY = 'AND remote_bare_jid = %(remote_bare_jid)s'


Q_UPSERT_CONVERSATION = f"""
WITH upsert_sender AS (
    INSERT INTO inbox (
        luser,
        remote_bare_jid,
        msg_id,
        box,
        body,
        direction,
        timestamp,
        unread_count
    )
    VALUES (
        %(from_username)s,
        %(recipient_jid)s,
        %(msg_id)s,
        'chats',
        %(body)s,
        -- The sender's own copy: remote_bare_jid is the recipient (the To), so
        -- the message is outgoing.
        'O'::mam_direction,
        %(timestamp)s,
        0
    )
    ON CONFLICT (luser, remote_bare_jid)
    DO UPDATE SET
        msg_id = EXCLUDED.msg_id,
        box = 'chats',
        body = EXCLUDED.body,
        direction = EXCLUDED.direction,
        timestamp = EXCLUDED.timestamp,
        unread_count = 0,
        reaction = NULL,
        reaction_target_mam_id = NULL,
        reaction_body = NULL
), upsert_recipient AS (
    -- Skipped (the SELECT returns no rows) when %(deliver_to_recipient)s is
    -- false -- i.e. the sender is shadow-banned -- so the recipient's inbox
    -- never gains an entry or unread count, and the notification cron (which
    -- reads `inbox`) never sees it. The sender's own row above is still written.
    INSERT INTO inbox (
        luser,
        remote_bare_jid,
        msg_id,
        box,
        body,
        direction,
        timestamp,
        unread_count
    )
    SELECT
        %(to_username)s,
        %(sender_jid)s,
        %(msg_id)s,
        'inbox',
        %(body)s,
        -- The recipient's copy: remote_bare_jid is the sender (the From), so
        -- the message is incoming.
        'I'::mam_direction,
        %(timestamp)s,
        1
    WHERE
        %(deliver_to_recipient)s::BOOLEAN
    ON CONFLICT (luser, remote_bare_jid)
    DO UPDATE SET
        msg_id = EXCLUDED.msg_id,
        body = EXCLUDED.body,
        direction = EXCLUDED.direction,
        timestamp = EXCLUDED.timestamp,
        unread_count = COALESCE(inbox.unread_count, 0) + 1,
        reaction = NULL,
        reaction_target_mam_id = NULL,
        reaction_body = NULL
)
SELECT 1
"""


Q_SET_INBOX_REACTION = f"""
WITH update_reactor AS (
    UPDATE inbox SET
        reaction = %(reaction)s,
        reaction_target_mam_id = %(reaction_target_mam_id)s,
        reaction_body = %(reaction_body)s,
        box = 'chats',
        timestamp = %(timestamp)s,
        unread_count = 0
    WHERE
        luser = %(reactor_username)s
    AND
        remote_bare_jid = %(partner_jid)s
)
UPDATE inbox SET
    reaction = %(reaction)s,
    reaction_target_mam_id = %(reaction_target_mam_id)s,
    reaction_body = %(reaction_body)s,
    box = 'chats',
    timestamp = %(timestamp)s,
    unread_count = CASE
        WHEN reaction_target_mam_id = %(reaction_target_mam_id)s
        THEN GREATEST(COALESCE(unread_count, 0), 1)
        ELSE COALESCE(unread_count, 0) + 1
    END
WHERE
    %(deliver_to_recipient)s::BOOLEAN
AND
    luser = %(partner_username)s
AND
    remote_bare_jid = %(reactor_jid)s
"""


Q_CLEAR_INBOX_REACTION = f"""
WITH update_reactor AS (
    UPDATE inbox SET
        reaction = NULL,
        reaction_target_mam_id = NULL,
        reaction_body = NULL
    WHERE
        luser = %(reactor_username)s
    AND
        remote_bare_jid = %(partner_jid)s
    AND
        reaction_target_mam_id = %(reaction_target_mam_id)s
    RETURNING
        1
), update_partner AS (
    UPDATE inbox SET
        reaction = NULL,
        reaction_target_mam_id = NULL,
        reaction_body = NULL,
        unread_count = GREATEST(COALESCE(unread_count, 0) - 1, 0)
    WHERE
        %(deliver_to_recipient)s::BOOLEAN
    AND
        luser = %(partner_username)s
    AND
        remote_bare_jid = %(reactor_jid)s
    AND
        reaction_target_mam_id = %(reaction_target_mam_id)s
    RETURNING
        1
)
SELECT
    EXISTS (SELECT 1 FROM update_reactor) AS reactor_reverted,
    EXISTS (SELECT 1 FROM update_partner) AS partner_reverted
"""


Q_MARK_DISPLAYED = """
UPDATE
    inbox
SET
    displayed_at = target.displayed_at,
    unread_count = 0
FROM
    unnest(
        %(lusers)s::text[],
        %(remote_bare_jids)s::text[],
        %(displayed_ats)s::timestamp[]
    ) AS target(luser, remote_bare_jid, displayed_at)
WHERE
    inbox.luser = target.luser
AND
    inbox.remote_bare_jid = target.remote_bare_jid
AND
    inbox.unread_count > 0
RETURNING
    inbox.luser,
    inbox.remote_bare_jid,
    inbox.displayed_at
"""


@dataclass(frozen=True)
class UpsertConversationJob:
    from_username: str
    to_username: str
    msg_id: str
    body: str
    timestamp: int
    deliver_to_recipient: bool = True


@dataclass(frozen=True)
class MarkDisplayedJob:
    from_username: str
    to_username: str
    publish_receipt: bool
    displayed_at: datetime


def reaction_inbox_body(emoji: str, target_body: str) -> str:
    return f'Reacted {emoji} to: {target_body}'


def _composed_body(body: str, reaction: str | None, reaction_body: str | None) -> str:
    if reaction is None or reaction_body is None:
        return gif_aware_body(body)

    return reaction_inbox_body(reaction, gif_aware_body(reaction_body))


async def get_inbox(query_id: str, username: str) -> list[Outbound]:
    """
    Fetches the user's inbox using the query_id and builds an `InboxResult` for
    each message, followed by a final `InboxFin`.
    """
    async with api_tx('read committed') as tx:
        await tx.execute(Q_GET_INBOX, dict(username=username))
        rows = await tx.fetchall()

    messages: list[Outbound] = []
    for row in rows:
        try:
            body = _composed_body(
                row['body'], row['reaction'], row['reaction_body'])
            if not body:
                continue

            owner_username = row['luser']
            remote_username = row['remote_bare_jid'].split('@', 1)[0]

            if row['direction'] == 'O':
                from_username, to_username = owner_username, remote_username
            else:
                from_username, to_username = remote_username, owner_username

            messages.append(InboxResult(
                owner_username=owner_username,
                msg_id=f"{row['msg_id']}",
                inner_from_username=from_username,
                inner_to_username=to_username,
                body=body,
                stamp=format_timestamp(row['timestamp']),
                unread_count=row['unread_count'],
                box=row['box'],
                query_id=query_id,
                muted_until=row.get('muted_until', 0),
            ))

        except Exception as e:
            print(f"Error processing row: {e}")
            continue

    messages.append(InboxFin(query_id=query_id))

    return messages


# The wire shape itself is defined beside the stanzas that carry it
# (`chatprotocol.outbound.InboxConversation`); `_q_inbox_snapshot` returns the
# underlying columns, but the payload is assembled here.
def _conversation_from_row(row: Row) -> InboxConversation:
    return InboxConversation(
        person_uuid=row['person_uuid'],
        url_slug=row['url_slug'],
        name=row['name'],
        match_percentage=row['match_percentage'],
        image_uuid=row['image_uuid'],
        image_blurhash=row['image_blurhash'],
        is_verified=row['is_verified'],
        is_available=row['is_available'],
        location=row['location'],
        matches_search_filters=row['matches_search_filters'],
        last_message=_composed_body(
            row['last_message'], row['reaction'], row['reaction_body']),
        last_message_read=row['last_message_read'],
        # The query returns raw microseconds; formatting here (rather than via
        # `to_char` in SQL) keeps the per-row timestamp work off the shared DB.
        last_message_timestamp=format_timestamp(row['last_message_timestamp']),
    )


def build_inbox_snapshot_query(
    username: str,
    prefs: Row,
    prospect_username: str | None,
) -> tuple[str, dict[str, SearchParam]]:
    filters = prospect_filters(prefs)
    reverse = two_way_filters(prefs)

    params: dict[str, SearchParam] = dict(
        username=username,
        recently_online_seconds=LAST_ONLINE_DEFAULT_SECONDS,
    )
    params.update(filters.params)
    params.update(reverse.params)

    if prospect_username is not None:
        params['remote_bare_jid'] = f'{prospect_username}@{LSERVER}'

    query = _q_inbox_snapshot(
        entry_predicate=(
            _ENTRY_PREDICATE_SNAPSHOT if prospect_username is None
            else _ENTRY_PREDICATE_ENTRY
        ),
        matches_search_filters=and_clauses([
            *filters.clauses,
            *reverse.clauses,
        ]),
    )

    return query, params


async def _fetch_inbox_conversations(
    username: str,
    prospect_username: str | None = None,
) -> list[InboxConversation]:
    async with api_tx('read committed') as tx:
        # The whole-inbox query's estimated cost crosses the default jit
        # thresholds for users with large inboxes, so JIT spends ~1s compiling
        # for no benefit.
        await tx.execute('SET LOCAL jit = off')
        await tx.execute('SET LOCAL statement_timeout = 15000')

        prefs = await tx.require_one(
            Q_SEARCH_PARAMETERS_BY_UUID,
            dict(username=username),
        )

        query, params = build_inbox_snapshot_query(
            username=username,
            prefs=prefs,
            prospect_username=prospect_username,
        )

        await tx.execute(query, params)
        rows = await tx.fetchall()

    return [_conversation_from_row(row) for row in rows]


async def get_inbox_snapshot(username: str) -> list[Outbound]:
    """
    The user's whole inbox, each conversation complete with person info, as a
    single `InboxSnapshot`.
    """
    try:
        conversations = await _fetch_inbox_conversations(username)

        return [InboxSnapshot(payload={'conversations': conversations})]
    except Exception:
        print(traceback.format_exc())
        return []


async def get_inbox_entry(
    viewer_username: str,
    prospect_username: str,
) -> list[Outbound]:
    """
    The viewer's conversation with one prospect, in the same shape as an
    `InboxSnapshot` entry, for pushing alongside a delivered message. Empty
    when the viewer has no inbox row for the prospect (or on failure), so
    callers can publish the result unconditionally.
    """
    try:
        conversations = await _fetch_inbox_conversations(
            viewer_username,
            prospect_username,
        )

        if not conversations:
            return []

        return [InboxEntry(payload=conversations[0])]
    except Exception:
        print(traceback.format_exc())
        return []


async def set_inbox_reaction(
    tx: Tx,
    reactor_username: str,
    partner_username: str,
    reaction_target_mam_id: int,
    emoji: str,
    target_body: str,
    timestamp: int,
    deliver_to_recipient: bool,
) -> None:
    await tx.execute(
        Q_SET_INBOX_REACTION,
        dict(
            reactor_username=reactor_username,
            partner_username=partner_username,
            reactor_jid=f'{reactor_username}@{LSERVER}',
            partner_jid=f'{partner_username}@{LSERVER}',
            reaction_target_mam_id=reaction_target_mam_id,
            reaction=emoji,
            reaction_body=target_body,
            timestamp=timestamp,
            deliver_to_recipient=deliver_to_recipient,
        ),
    )


@dataclass(frozen=True)
class ClearedInboxReaction:
    reactor_reverted: bool = False
    partner_reverted: bool = False


async def clear_inbox_reaction(
    tx: Tx,
    reactor_username: str,
    partner_username: str,
    reaction_target_mam_id: int,
    deliver_to_recipient: bool,
) -> ClearedInboxReaction:
    """
    Removes the reaction from each inbox row that still reflects it; the
    flags say whose rows changed and so need a fresh inbox entry pushed.
    """
    await tx.execute(
        Q_CLEAR_INBOX_REACTION,
        dict(
            reactor_username=reactor_username,
            partner_username=partner_username,
            reactor_jid=f'{reactor_username}@{LSERVER}',
            partner_jid=f'{partner_username}@{LSERVER}',
            reaction_target_mam_id=reaction_target_mam_id,
            deliver_to_recipient=deliver_to_recipient,
        ),
    )
    row = await tx.fetchone()

    return ClearedInboxReaction(
        reactor_reverted=bool(row and row['reactor_reverted']),
        partner_reverted=bool(row and row['partner_reverted']),
    )


async def process_upsert_conversation_batch(tx: Tx, batch: list[UpsertConversationJob]) -> None:
    params_seq = [
        dict(
            from_username=job.from_username,
            to_username=job.to_username,
            sender_jid=f"{job.from_username}@{LSERVER}",
            recipient_jid=f"{job.to_username}@{LSERVER}",
            msg_id=job.msg_id,
            body=job.body,
            timestamp=job.timestamp,
            deliver_to_recipient=job.deliver_to_recipient,
        )
        for job in batch
    ]

    await tx.executemany(Q_UPSERT_CONVERSATION, params_seq)


def mark_displayed(
    from_username: str,
    to_username: str,
    publish_receipt: bool,
) -> None:
    _mark_displayed_batcher.enqueue(
        MarkDisplayedJob(
            from_username=from_username,
            to_username=to_username,
            publish_receipt=publish_receipt,
            displayed_at=datetime.utcnow(),
        )
    )


async def _write_mark_displayed(
    conversations: list[tuple[str, str, datetime]],
) -> dict[tuple[str, str], datetime]:
    """
    Marks each (reader, sender) conversation as read, returning the recorded read
    time only for conversations that had unread messages; an already-read
    conversation is absent from the result.
    """
    targets = list({
        (reader, f'{sender}@{LSERVER}'): displayed_at
        for reader, sender, displayed_at in conversations
    }.items())

    if not targets:
        return {}

    try:
        async with api_tx('read committed') as tx:
            await tx.execute(Q_MARK_DISPLAYED, dict(
                lusers=[luser for (luser, _), _ in targets],
                remote_bare_jids=[jid for (_, jid), _ in targets],
                displayed_ats=[displayed_at for _, displayed_at in targets],
            ))
            rows = await tx.fetchall()
    except Exception:
        print(traceback.format_exc())
        return {}

    return {
        (row['luser'], row['remote_bare_jid'].split('@')[0]): row['displayed_at']
        for row in rows
    }


async def _process_mark_displayed_batch(batch: list[MarkDisplayedJob]) -> None:
    publish_receipt = {
        (job.from_username, job.to_username): job.publish_receipt
        for job in batch
    }

    displayed_ats = {
        (job.from_username, job.to_username): job.displayed_at
        for job in batch
    }

    advanced = await _write_mark_displayed([
        (reader, sender, at)
        for (reader, sender), at in displayed_ats.items()
    ])

    for (reader, sender), displayed_at in advanced.items():
        if not publish_receipt.get((reader, sender)):
            continue
        await redis_publish_many(sender, [
            ReadReceipt(
                from_username=reader,
                to_username=sender,
                stamp=format_datetime(displayed_at),
            )
        ])


_mark_displayed_batcher = Batcher[MarkDisplayedJob](
    process_fn=_process_mark_displayed_batch,
    flush_interval=0.1,
    min_batch_size=1,
    max_batch_size=1000,
    retry=False,
)
