from typing import Literal

Q_DELETE_SENT_NOTIFICATION = """
DELETE FROM
    notification_due
WHERE
    person_id = %(person_id)s
AND
    kind = %(kind)s::notification_kind
AND
    event_at = %(event_at)s
"""

def due_notifications_sql(
    kind: Literal['intro', 'chat', 'visitor'],
    unseen_count: str,
) -> str:
    return f"""
WITH due AS (
    SELECT
        person_id,
        event_at
    FROM
        notification_due
    WHERE
        kind = '{kind}'
    AND
        due_at <= NOW()
    ORDER BY
        due_at
    LIMIT
        1000
    FOR UPDATE SKIP LOCKED
), checked AS (
    SELECT
        person.id AS person_id,
        person.uuid::TEXT AS person_uuid,
        due.event_at,
        person.name,
        person.email,
        person.last_online_time,
        CASE
            WHEN
                person.activated
            AND
                -- only notify users about events after their last activity
                person.last_online_time < due.event_at
            AND
                -- only notify users we haven't already notified
                person.{kind}_seconds < EXTRACT(EPOCH FROM due.event_at)
            AND
                immediacy.name <> 'Never'
            THEN ({unseen_count})
            ELSE 0
        END AS unseen_count
    FROM
        due
    JOIN
        person
    ON
        person.id = due.person_id
    JOIN
        immediacy
    ON
        immediacy.id = person.{kind}s_notification
), unsendable AS (
    DELETE FROM
        notification_due
    USING
        checked
    WHERE
        notification_due.kind = '{kind}'
    AND
        notification_due.person_id = checked.person_id
    AND
        checked.unseen_count = 0
)
SELECT
    checked.person_id,
    checked.person_uuid,
    checked.event_at,
    checked.name,
    checked.email,
    checked.unseen_count,
    -- One row per notification to send (see the LATERAL join below): a
    -- non-NULL token produces a push, a NULL token produces an email.
    notification_target.token
FROM
    checked
CROSS JOIN LATERAL (
    -- Per person, summarise their logged-in sessions. A signed-in `duo_session`
    -- with a NULL `push_token` is a push-less (web) client: only the mobile app
    -- registers a push token, so this is how a web client is identified (its
    -- `session_token_hash` can't be NULL, being the table's primary key).
    -- Logged-out devices aren't `signed_in`, so they're excluded.
    SELECT
        ARRAY_AGG(DISTINCT duo_session.push_token)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS push_tokens,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NULL) AS web_last_online,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS mobile_last_online
    FROM
        duo_session
    WHERE
        duo_session.person_id = checked.person_id
    AND
        duo_session.signed_in
) AS session_summary
-- Fan a single person out into one row per notification that must be sent:
-- one push per distinct logged-in mobile push token, plus a single email (NULL
-- token) when any of: no logged-in device can receive push; the user was last
-- online more than 8 days ago (a stale token may no longer reach them, so we
-- still push but also email as a backstop); or the user was last seen online on
-- a web client more recently than on any mobile session (ties favour mobile, so
-- the email is only added when a web session is strictly more recent).
CROSS JOIN LATERAL (
    SELECT
        token
    FROM
        unnest(session_summary.push_tokens) AS token

    UNION ALL

    SELECT
        NULL
    WHERE
        session_summary.push_tokens IS NULL
    OR
        extract(epoch from checked.last_online_time)
            <= EXTRACT(EPOCH FROM NOW() - INTERVAL '8 days')
    OR
        COALESCE(
            session_summary.web_last_online > session_summary.mobile_last_online,
            FALSE
        )
) AS notification_target
WHERE
    checked.unseen_count > 0
"""
