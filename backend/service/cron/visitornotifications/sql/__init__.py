Q_PENDING_VISITOR_NOTIFICATIONS = """
WITH ten_minutes_ago AS (
    SELECT
        EXTRACT(EPOCH FROM (
            NOW() - INTERVAL '10 minutes'))::bigint AS seconds
), filtered AS (
    -- The people due a visitor notification. `visitor_pending_seconds` holds
    -- the newest visit awaiting a notification: a trigger stamps it as
    -- qualifying visits are recorded, and it's cleared when a notification is
    -- sent or the person comes online. That leaves this poll a handful of
    -- stamped people, found through a small partial index, instead of a sweep
    -- of every visit in the last ten days.
    SELECT
        person.uuid::TEXT AS person_uuid,
        person.id AS person_id,
        person.last_online_time,
        person.visitor_pending_seconds AS last_visitor_seconds,
        COALESCE(person.visitor_seconds, 0) AS last_visitor_notification_seconds,
        person.name,
        person.email,
        immediacy_drift_seconds(im_visitors.name) AS visitors_drift_seconds
    FROM
        person
    LEFT JOIN
        immediacy AS im_visitors
    ON
        im_visitors.id = person.visitors_notification
    WHERE
        person.visitor_pending_seconds > 0
    AND
        -- only notify users about visits made longer than ten minutes ago
        person.visitor_pending_seconds < (SELECT seconds FROM ten_minutes_ago)
    AND
        -- only notify users about visits less than ten days old
        person.visitor_pending_seconds >
            EXTRACT(EPOCH FROM NOW() - INTERVAL '10 days')::bigint
    AND
        -- only notify users about visits made after their last activity. The
        -- online path clears the stamp itself; this also covers activity
        -- recorded by writing `last_online_time` directly.
        extract(epoch from person.last_online_time) <
            person.visitor_pending_seconds
    AND
        -- only notify users whose last activity was longer than ten minutes
        -- ago
        extract(epoch from person.last_online_time) <
            (SELECT seconds FROM ten_minutes_ago)
    AND
        person.activated
), counted AS (
    -- How many people visited since the person was last online, so the copy
    -- can say how many. Capped at 100 (rendered as "99+"), so the scan stops
    -- early for very popular profiles. The count is only computed where the
    -- drift gate (mirroring `do_send_notification`) passes; a stamped person
    -- whose frequency setting has since changed gets a 0 that `is_sendable`
    -- discards anyway.
    SELECT
        filtered.*,
        (CASE
            WHEN
                filtered.visitors_drift_seconds >= 0
            AND
                filtered.last_visitor_notification_seconds +
                    filtered.visitors_drift_seconds <
                        filtered.last_visitor_seconds
            THEN (
                SELECT
                    COUNT(*)
                FROM (
                    SELECT
                        1
                    FROM
                        visited
                    JOIN
                        person AS visitor
                    ON
                        visitor.id = visited.subject_person_id
                    WHERE
                        visited.object_person_id = filtered.person_id
                    AND
                        NOT visited.invisible
                    AND
                        visited.updated_at > filtered.last_online_time
                    AND
                        visitor.activated
                    AND
                        visitor.shadow_banned_at IS NULL
                    LIMIT 100
                ) AS visitor
            )
            ELSE 0
        END)::int AS visitor_count
    FROM
        filtered
), session_summary AS (
    -- Per person, summarise their logged-in sessions. A signed-in `duo_session`
    -- with a NULL `push_token` is a push-less (web) client: only the mobile app
    -- registers a push token, so this is how a web client is identified (its
    -- `session_token_hash` can't be NULL, being the table's primary key).
    -- Logged-out devices aren't `signed_in`, so they're excluded. Only the
    -- people who passed `filtered` are summarised, so this looks up sessions by
    -- person rather than scanning every signed-in session.
    SELECT
        duo_session.person_id,
        ARRAY_AGG(DISTINCT duo_session.push_token)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS push_tokens,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NULL) AS web_last_online,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS mobile_last_online
    FROM
        filtered
    JOIN
        duo_session
    ON
        duo_session.person_id = filtered.person_id
    WHERE
        duo_session.signed_in
    GROUP BY
        duo_session.person_id
)
SELECT
    counted.person_uuid,
    counted.last_visitor_seconds,
    counted.last_visitor_notification_seconds,
    -- One row per notification to send (see the LATERAL join below): a
    -- non-NULL token produces a push, a NULL token produces an email.
    notification_target.token,
    counted.name,
    counted.email,
    counted.visitors_drift_seconds,
    counted.visitor_count
FROM
    counted
LEFT JOIN
    session_summary
ON
    session_summary.person_id = counted.person_id
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
        extract(epoch from counted.last_online_time)
            <= EXTRACT(EPOCH FROM NOW() - INTERVAL '8 days')
    OR
        COALESCE(
            session_summary.web_last_online > session_summary.mobile_last_online,
            FALSE
        )
) AS notification_target
"""
