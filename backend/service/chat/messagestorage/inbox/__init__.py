import traceback

from batcher import Batcher
from database import Row, Tx, api_tx
from dataclasses import dataclass
from service.chat.chatutil import (
    LSERVER,
    format_timestamp,
)
from chatprotocol.outbound import (
    InboxConversation,
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
#
# `entry_predicate` narrows the viewer's `inbox` rows: empty for the whole-inbox
# snapshot, or an equality on `remote_bare_jid` (the primary key's second
# column) for a single conversation. The predicate is kept a plain equality --
# rather than an `%(x)s IS NULL OR ...` that serves both -- so the single-entry
# query gets an index scan on `inbox_pkey` even under a generic plan, which a
# parameterised `IS NULL` branch would defeat.
#
# `matches_search_filters` says whether an intro's sender passes the viewer's
# search filters, so clients can sort and flag intros from outside them. The
# predicates mirror `Q_UNCACHED_SEARCH_2` in `search.sql` (kept in sync by
# hand; each notes the other, and `test_init` here fails when a preference
# table is consulted by one query and not the other), except those that can't
# apply to an intro: the
# sender's own gender preference and `hide_me_from_strangers` (the sender
# chose to message the viewer), skipped/messaged gating (the inbox `location`
# rules already handle those), and platform verification requirements (not a
# viewer-chosen filter). Searching within a club also deliberately doesn't
# count: it scopes a search, but an intro from outside the club isn't the
# kind of mismatch this flag is for. Non-intro conversations are always TRUE.
def _q_inbox_snapshot(entry_predicate: str) -> str:
    return f"""
WITH viewer AS (
    SELECT
        id,
        personality
    FROM
        person
    WHERE
        uuid = %(username)s::uuid
), viewer_search_preferences AS MATERIALIZED (
    SELECT
        id,
        coordinates,
        COALESCE(
            (
                SELECT
                    1000 * distance
                FROM
                    search_preference_distance
                WHERE
                    person_id = person.id
            ),
            1e9
        ) AS distance_preference,
        -- The latest date of birth the viewer's minimum age allows
        (
            SELECT
                (
                    CURRENT_DATE -
                    INTERVAL '1 year' *
                    COALESCE(min_age, 0)
                )::DATE
            FROM
                search_preference_age
            WHERE
                person_id = person.id
        ) AS max_date_of_birth_preference,
        -- The earliest date of birth the viewer's maximum age allows
        (
            SELECT
                (
                    CURRENT_DATE -
                    INTERVAL '1 year' *
                    (COALESCE(max_age, 999) + 1)
                )::DATE
            FROM
                search_preference_age
            WHERE
                person_id = person.id
        ) AS min_date_of_birth_preference,
        (
            SELECT min_height_cm FROM search_preference_height_cm
            WHERE person_id = person.id
        ) AS min_height_preference,
        (
            SELECT max_height_cm FROM search_preference_height_cm
            WHERE person_id = person.id
        ) AS max_height_preference,
        ARRAY(
            SELECT gender_id FROM search_preference_gender
            WHERE person_id = person.id
        ) AS gender_preference,
        ARRAY(
            SELECT orientation_id FROM search_preference_orientation
            WHERE person_id = person.id
        ) AS orientation_preference,
        ARRAY(
            SELECT ethnicity_id FROM search_preference_ethnicity
            WHERE person_id = person.id
        ) AS ethnicity_preference,
        ARRAY(
            SELECT has_profile_picture_id FROM search_preference_has_profile_picture
            WHERE person_id = person.id
        ) AS has_profile_picture_preference,
        ARRAY(
            SELECT looking_for_id FROM search_preference_looking_for
            WHERE person_id = person.id
        ) AS looking_for_preference,
        ARRAY(
            SELECT smoking_id FROM search_preference_smoking
            WHERE person_id = person.id
        ) AS smoking_preference,
        ARRAY(
            SELECT drinking_id FROM search_preference_drinking
            WHERE person_id = person.id
        ) AS drinking_preference,
        ARRAY(
            SELECT drugs_id FROM search_preference_drugs
            WHERE person_id = person.id
        ) AS drugs_preference,
        ARRAY(
            SELECT long_distance_id FROM search_preference_long_distance
            WHERE person_id = person.id
        ) AS long_distance_preference,
        ARRAY(
            SELECT relationship_status_id FROM search_preference_relationship_status
            WHERE person_id = person.id
        ) AS relationship_status_preference,
        ARRAY(
            SELECT has_kids_id FROM search_preference_has_kids
            WHERE person_id = person.id
        ) AS has_kids_preference,
        ARRAY(
            SELECT wants_kids_id FROM search_preference_wants_kids
            WHERE person_id = person.id
        ) AS wants_kids_preference,
        ARRAY(
            SELECT exercise_id FROM search_preference_exercise
            WHERE person_id = person.id
        ) AS exercise_preference,
        ARRAY(
            SELECT religion_id FROM search_preference_religion
            WHERE person_id = person.id
        ) AS religion_preference,
        ARRAY(
            SELECT star_sign_id FROM search_preference_star_sign
            WHERE person_id = person.id
        ) AS star_sign_preference
    FROM
        person
    WHERE
        uuid = %(username)s::uuid
), entry AS (
    SELECT
        uuid_or_null(split_part(remote_bare_jid, '@', 1)) AS prospect_uuid,
        body,
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
    unread_count = 0 AS last_message_read,
    timestamp AS last_message_timestamp,
    CASE
        WHEN location = 'intros'
        THEN COALESCE(
            (
                SELECT
                        prospect.gender_id = ANY(prefs.gender_preference)
                    AND
                        ST_DWithin(
                            prospect.coordinates,
                            prefs.coordinates,
                            prefs.distance_preference
                        )
                    AND
                        prospect.date_of_birth <= prefs.max_date_of_birth_preference
                    AND
                        prospect.date_of_birth > prefs.min_date_of_birth_preference
                    AND
                        prospect.orientation_id = ANY(prefs.orientation_preference)
                    AND
                        prospect.ethnicity_id = ANY(prefs.ethnicity_preference)
                    AND
                        COALESCE(prospect.height_cm, 0) >=
                            COALESCE(prefs.min_height_preference, 0)
                    AND
                        COALESCE(prospect.height_cm, 999) <=
                            COALESCE(prefs.max_height_preference, 999)
                    AND
                        prospect.has_profile_picture_id =
                            ANY(prefs.has_profile_picture_preference)
                    AND
                        prospect.looking_for_id = ANY(prefs.looking_for_preference)
                    AND
                        prospect.smoking_id = ANY(prefs.smoking_preference)
                    AND
                        prospect.drinking_id = ANY(prefs.drinking_preference)
                    AND
                        prospect.drugs_id = ANY(prefs.drugs_preference)
                    AND
                        prospect.long_distance_id = ANY(prefs.long_distance_preference)
                    AND
                        prospect.relationship_status_id =
                            ANY(prefs.relationship_status_preference)
                    AND
                        prospect.has_kids_id = ANY(prefs.has_kids_preference)
                    AND
                        prospect.wants_kids_id = ANY(prefs.wants_kids_preference)
                    AND
                        prospect.exercise_id = ANY(prefs.exercise_preference)
                    AND
                        prospect.religion_id = ANY(prefs.religion_preference)
                    AND
                        prospect.star_sign_id = ANY(prefs.star_sign_preference)
                    AND
                        -- NOT EXISTS an answer contrary to the viewer's preference...
                        NOT EXISTS (
                            SELECT 1
                            FROM (
                                SELECT *
                                FROM search_preference_answer
                                WHERE person_id = prefs.id
                            ) AS pref
                            LEFT JOIN
                                answer ans
                            ON
                                ans.person_id = prospect.id AND
                                ans.question_id = pref.question_id
                            WHERE
                                -- Contrary because the answer exists and is wrong
                                ans.answer IS NOT NULL AND
                                ans.answer != pref.answer
                            OR
                                -- Contrary because the answer doesn't exist but should
                                ans.answer IS NULL AND
                                pref.accept_unanswered = FALSE
                        )
                FROM
                    person AS prospect
                CROSS JOIN
                    viewer_search_preferences AS prefs
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
Q_INBOX_SNAPSHOT = _q_inbox_snapshot('')

# A single conversation: a plain primary-key equality on `remote_bare_jid`.
Q_INBOX_ENTRY = _q_inbox_snapshot('AND remote_bare_jid = %(remote_bare_jid)s')


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


# The wire shape itself is defined beside the stanzas that carry it
# (`chatprotocol.outbound.InboxConversation`); `Q_INBOX_SNAPSHOT`/
# `Q_INBOX_ENTRY` return the underlying columns and the query gates the
# viewer-visible fields, but the payload is assembled here.
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
        last_message=row['last_message'],
        last_message_read=row['last_message_read'],
        # The query returns raw microseconds; formatting here (rather than via
        # `to_char` in SQL) keeps the per-row timestamp work off the shared DB.
        last_message_timestamp=format_timestamp(row['last_message_timestamp']),
    )


async def _fetch_inbox_conversations(
    username: str,
    prospect_username: str | None = None,
) -> list[InboxConversation]:
    if prospect_username is None:
        query = Q_INBOX_SNAPSHOT
        params = dict(username=username)
    else:
        query = Q_INBOX_ENTRY
        params = dict(
            username=username,
            remote_bare_jid=f'{prospect_username}@{LSERVER}',
        )

    async with api_tx('read committed') as tx:
        # The whole-inbox query's estimated cost crosses the default jit
        # thresholds for users with large inboxes, so JIT spends ~1s compiling
        # for no benefit. (Same rationale as the legacy Q_INBOX_INFO.)
        await tx.execute('SET LOCAL jit = off')
        await tx.execute('SET LOCAL statement_timeout = 15000')
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
