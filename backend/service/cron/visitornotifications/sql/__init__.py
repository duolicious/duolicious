Q_PENDING_VISITOR_NOTIFICATIONS = """
WITH ten_minutes_ago AS (
    SELECT
        EXTRACT(EPOCH FROM (
            NOW() - INTERVAL '10 minutes'))::bigint AS seconds
), visitor_first_pass AS (
    -- The most recent visit each person received. `visited` holds one row per
    -- (visitor, visited) pair, updated in place, so the ten-day window covers
    -- the pairs whose latest visit is recent rather than every visit ever
    -- made. Invisible visits are excluded because they never show up in the
    -- visitors tab, and so are visits from people the tab hides.
    SELECT
        visited.object_person_id AS person_id,
        EXTRACT(EPOCH FROM MAX(visited.updated_at))::bigint AS last_visitor_seconds
    FROM
        visited
    JOIN
        person AS visitor
    ON
        visitor.id = visited.subject_person_id
    WHERE
        NOT visited.invisible
    AND
        visited.updated_at > NOW() - INTERVAL '10 days'
    AND
        visitor.activated
    AND
        visitor.shadow_banned_at IS NULL
    GROUP BY
        visited.object_person_id
), notifiable AS (
    -- Decide, per person, whether they're due a visitor notification. This
    -- depends only on the person and their visitors, never on their sessions,
    -- so it's done before the (more expensive) session summary below: only the
    -- handful of people who survive this filter need it.
    SELECT
        person.uuid::TEXT AS person_uuid,
        person.id AS person_id,
        person.last_online_time,
        visitor_first_pass.last_visitor_seconds,
        COALESCE(person.visitor_seconds, 0) AS last_visitor_notification_seconds,
        (
                -- only notify users we haven't already notified
                visitor_first_pass.last_visitor_seconds >
                    COALESCE(person.visitor_seconds, 0)
            AND
                -- only notify users about visits made longer than ten minutes
                -- ago
                visitor_first_pass.last_visitor_seconds <
                    (SELECT seconds FROM ten_minutes_ago)
            AND
                -- only notify users about visits made after their last activity
                extract(epoch from person.last_online_time) <
                    visitor_first_pass.last_visitor_seconds
            AND
                -- only notify users whose last activity was longer than ten
                -- minutes ago
                extract(epoch from person.last_online_time) <
                    (SELECT seconds FROM ten_minutes_ago)
        ) AS has_visitor,
        person.name,
        person.email,
        CASE
            WHEN im_visitors.name = 'Immediately'  THEN 0
            WHEN im_visitors.name = 'Daily'        THEN 86400
            WHEN im_visitors.name = 'Every 3 days' THEN 259200
            WHEN im_visitors.name = 'Weekly'       THEN 604800
            WHEN im_visitors.name = 'Never'        THEN -1
            ELSE                                        604800
        END AS visitors_drift_seconds
    FROM
        visitor_first_pass
    JOIN
        person
    ON
        person.id = visitor_first_pass.person_id
    LEFT JOIN
        immediacy AS im_visitors
    ON
        im_visitors.id = person.visitors_notification
    WHERE
        person.activated
), filtered AS (
    SELECT * FROM notifiable WHERE has_visitor
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
    filtered.person_uuid,
    filtered.last_visitor_seconds,
    filtered.last_visitor_notification_seconds,
    -- One row per notification to send (see the LATERAL join below): a
    -- non-NULL token produces a push, a NULL token produces an email.
    notification_target.token,
    filtered.name,
    filtered.email,
    filtered.visitors_drift_seconds
FROM
    filtered
LEFT JOIN
    session_summary
ON
    session_summary.person_id = filtered.person_id
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
        extract(epoch from filtered.last_online_time)
            <= EXTRACT(EPOCH FROM NOW() - INTERVAL '8 days')
    OR
        COALESCE(
            session_summary.web_last_online > session_summary.mobile_last_online,
            FALSE
        )
) AS notification_target
"""
