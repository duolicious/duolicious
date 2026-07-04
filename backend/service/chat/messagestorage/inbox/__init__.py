import traceback

from batcher import Batcher
from database import Tx, api_tx
from dataclasses import dataclass
from service.chat.chatutil import (
    LSERVER,
    format_timestamp,
)
from chatprotocol.outbound import (
    InboxEntry,
    InboxFin,
    InboxResult,
    InboxSnapshot,
    Outbound,
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


# The gating rules (which fields a viewer may see, and which box the
# conversation belongs in) mirror Q_INBOX_INFO, which serves the legacy
# `/inbox-info` endpoint. This query joins them against the viewer's `inbox`
# rows so one websocket response carries complete conversations.
Q_INBOX_SNAPSHOT = """
WITH viewer AS (
    SELECT
        id,
        personality
    FROM
        person
    WHERE
        uuid = uuid_or_null(%(username)s)
), entry AS (
    SELECT
        split_part(remote_bare_jid, '@', 1) AS prospect_uuid,
        body,
        COALESCE(unread_count, 0) AS unread_count,
        timestamp
    FROM
        inbox
    WHERE
        luser = %(username)s
    AND
        (
            %(prospect_uuid)s::TEXT IS NULL
        OR
            split_part(remote_bare_jid, '@', 1) = %(prospect_uuid)s::TEXT
        )
), conversation AS (
    SELECT
        entry.prospect_uuid,
        entry.body,
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
        prospect.uuid = uuid_or_null(entry.prospect_uuid)
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
)
SELECT
    JSON_BUILD_OBJECT(
        'conversations',
        COALESCE(
            JSON_AGG(
                JSON_BUILD_OBJECT(
                    'person_uuid', prospect_uuid,
                    'url_slug', url_slug,
                    'name', CASE WHEN is_available THEN name END,
                    'match_percentage',
                        CASE WHEN is_available THEN match_percentage END,
                    'image_uuid', CASE WHEN is_available THEN image_uuid END,
                    'image_blurhash',
                        CASE WHEN is_available THEN image_blurhash END,
                    'is_verified', is_available AND verified,
                    'is_available', is_available,
                    'location', location,
                    'last_message', body,
                    'last_message_read', unread_count = 0,
                    'last_message_timestamp', iso8601_utc(
                        (TO_TIMESTAMP(timestamp / 1e6) AT TIME ZONE 'UTC')
                    )
                )
                ORDER BY timestamp
            ),
            '[]'::JSON
        )
    ) AS j
FROM
    gated
"""


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
        EXTRACT(EPOCH FROM NOW()) * 1e6,
        0
    )
    ON CONFLICT (luser, remote_bare_jid)
    DO UPDATE SET
        msg_id = EXCLUDED.msg_id,
        box = 'chats',
        body = EXCLUDED.body,
        direction = EXCLUDED.direction,
        timestamp = EXCLUDED.timestamp,
        unread_count = 0
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
        EXTRACT(EPOCH FROM NOW()) * 1e6,
        1
    WHERE
        %(deliver_to_recipient)s::BOOLEAN
    ON CONFLICT (luser, remote_bare_jid)
    DO UPDATE SET
        msg_id = EXCLUDED.msg_id,
        box = 'chats',
        body = EXCLUDED.body,
        direction = EXCLUDED.direction,
        timestamp = EXCLUDED.timestamp,
        unread_count = COALESCE(inbox.unread_count, 0) + 1
)
SELECT 1
"""


Q_MARK_DISPLAYED = f"""
UPDATE
    inbox
SET
    displayed_at = NOW(),
    unread_count = 0
WHERE
    luser = %(luser)s
AND
    remote_bare_jid = %(remote_bare_jid)s
AND
    unread_count > 0
"""


@dataclass(frozen=True)
class UpsertConversationJob:
    from_username: str
    to_username: str
    msg_id: str
    body: str
    deliver_to_recipient: bool = True


@dataclass(frozen=True)
class MarkDisplayedJob:
    from_username: str
    to_username: str


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
            body = row['body']
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


async def _fetch_inbox_conversations(
    username: str,
    prospect_uuid: str | None = None,
) -> dict:
    params = dict(username=username, prospect_uuid=prospect_uuid)

    async with api_tx('read committed') as tx:
        # The query is cheap (index-only scans) but its estimated cost crosses
        # the default jit thresholds for users with large inboxes, so JIT
        # spends ~1s compiling for no benefit. (Same rationale as the legacy
        # Q_INBOX_INFO.)
        await tx.execute('SET LOCAL jit = off')
        row = await tx.require_one(Q_INBOX_SNAPSHOT, params)

    return row['j']


async def get_inbox_snapshot(username: str) -> list[Outbound]:
    """
    The user's whole inbox, each conversation complete with person info, as a
    single `InboxSnapshot`.
    """
    try:
        payload = await _fetch_inbox_conversations(username)

        return [InboxSnapshot(payload=payload)]
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
        payload = await _fetch_inbox_conversations(
            username=viewer_username,
            prospect_uuid=prospect_username,
        )

        conversations = payload['conversations']

        if not conversations:
            return []

        return [InboxEntry(payload=conversations[0])]
    except Exception:
        print(traceback.format_exc())
        return []


async def process_upsert_conversation_batch(tx: Tx, batch: list[UpsertConversationJob]) -> None:
    params_seq = [
        dict(
            from_username=job.from_username,
            to_username=job.to_username,
            sender_jid=f"{job.from_username}@{LSERVER}",
            recipient_jid=f"{job.to_username}@{LSERVER}",
            msg_id=job.msg_id,
            body=job.body,
            deliver_to_recipient=job.deliver_to_recipient,
        )
        for job in batch
    ]

    await tx.executemany(Q_UPSERT_CONVERSATION, params_seq)


def mark_displayed(from_username: str, to_username: str) -> None:
    """
    Marks the conversation as read. Whether the read actually advances the
    stored read state is decided in the database: Q_MARK_DISPLAYED only touches
    the row (and bumps displayed_at) when there are unread messages, so
    re-opening an already-read conversation is a no-op.
    """
    job = MarkDisplayedJob(from_username=from_username, to_username=to_username)

    _mark_displayed_batcher.enqueue(job)


async def _process_mark_displayed_batch(batch: list[MarkDisplayedJob]) -> None:
    params_seq = [
        dict(
            luser=job.from_username,
            remote_bare_jid=f'{job.to_username}@{LSERVER}',
        )
        for job in batch
    ]

    async with api_tx('read committed') as tx:
        await tx.executemany(Q_MARK_DISPLAYED, params_seq)


_mark_displayed_batcher = Batcher[MarkDisplayedJob](
    process_fn=_process_mark_displayed_batch,
    flush_interval=1.0,
    min_batch_size=1,
    max_batch_size=1000,
    retry=False,
)
