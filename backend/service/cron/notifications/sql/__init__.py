Q_PENDING_NOTIFICATIONS = """
WITH ten_minutes_ago AS (
    SELECT
        EXTRACT(EPOCH FROM (
            NOW() - INTERVAL '10 minutes'))::bigint AS seconds
), inbox_first_pass AS (
    SELECT
        luser AS username,
        MAX(CASE WHEN box = 'inbox' THEN timestamp ELSE 0 END) / 1000000 AS last_intro_seconds,
        MAX(CASE WHEN box = 'chats' THEN timestamp ELSE 0 END) / 1000000 AS last_chat_seconds,
        BOOL_OR(box = 'inbox')  AS has_intro,
        BOOL_OR(box = 'chats')  AS has_chat
    FROM
        inbox
    WHERE
        unread_count > 0
    AND
        timestamp >
            -- ten days ago as microseconds
            EXTRACT(EPOCH FROM (NOW() - INTERVAL '10 days'))::bigint * 1000000
    GROUP BY
        luser
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
), visitor_by_username AS (
    -- Keyed like the inbox pass so the two can be joined. The lookup is done
    -- after aggregating, so it costs one index hit per visited person rather
    -- than one per visit.
    SELECT
        person.uuid::TEXT AS username,
        visitor_first_pass.last_visitor_seconds
    FROM
        visitor_first_pass
    JOIN
        person
    ON
        person.id = visitor_first_pass.person_id
), first_pass AS (
    -- A person is a candidate if they have an unread message, a recent
    -- visitor, or both, so the two passes are joined rather than intersected.
    SELECT
        COALESCE(inbox_first_pass.username, visitor_by_username.username) AS username,
        COALESCE(inbox_first_pass.last_intro_seconds, 0) AS last_intro_seconds,
        COALESCE(inbox_first_pass.last_chat_seconds, 0) AS last_chat_seconds,
        COALESCE(inbox_first_pass.has_intro, FALSE) AS has_intro,
        COALESCE(inbox_first_pass.has_chat, FALSE) AS has_chat,
        COALESCE(visitor_by_username.last_visitor_seconds, 0) AS last_visitor_seconds,
        visitor_by_username.username IS NOT NULL AS has_visitor
    FROM
        inbox_first_pass
    FULL OUTER JOIN
        visitor_by_username
    ON
        visitor_by_username.username = inbox_first_pass.username
), notifiable AS (
    -- Decide, per person, whether they're due an intro, chat and/or visitor
    -- notification. This depends only on the person, their inbox and their
    -- visitors, never on their sessions, so it's done before the (more
    -- expensive) session summary below: only the handful of people who survive
    -- this filter need it.
    SELECT
        person.uuid::TEXT AS person_uuid,
        person.id AS person_id,
        person.last_online_time,
        first_pass.last_intro_seconds,
        first_pass.last_chat_seconds,
        first_pass.last_visitor_seconds,
        COALESCE(person.intro_seconds, 0) AS last_intro_notification_seconds,
        COALESCE(person.chat_seconds, 0) AS last_chat_notification_seconds,
        COALESCE(person.visitor_seconds, 0) AS last_visitor_notification_seconds,
        (
                first_pass.has_intro
            AND
                -- only notify users we haven't already notified
                first_pass.last_intro_seconds >
                    COALESCE(person.intro_seconds, 0)
            AND
                -- only notify users about messages sent longer than ten minutes
                -- ago
                first_pass.last_intro_seconds <
                    (SELECT seconds FROM ten_minutes_ago)
            AND
                -- only notify users about messages sent after their last
                -- activity
                extract(epoch from person.last_online_time) < first_pass.last_intro_seconds
            AND
                -- only notify users whose last activity was longer than ten
                -- minutes ago
                extract(epoch from person.last_online_time) <
                    (SELECT seconds FROM ten_minutes_ago)
        ) AS has_intro,
        (
                first_pass.has_chat
            AND
                -- only notify users we haven't already notified
                first_pass.last_chat_seconds >
                    COALESCE(person.chat_seconds, 0)
            AND
                -- only notify users about messages sent longer than ten minutes
                -- ago
                first_pass.last_chat_seconds <
                    (SELECT seconds FROM ten_minutes_ago)
            AND
                -- only notify users about messages sent after their last
                -- activity
                extract(epoch from person.last_online_time) < first_pass.last_chat_seconds
            AND
                -- only notify users whose last activity was longer than ten
                -- minutes ago
                extract(epoch from person.last_online_time) <
                    (SELECT seconds FROM ten_minutes_ago)
        ) AS has_chat,
        (
                first_pass.has_visitor
            AND
                -- only notify users we haven't already notified
                first_pass.last_visitor_seconds >
                    COALESCE(person.visitor_seconds, 0)
            AND
                -- only notify users about visits made longer than ten minutes
                -- ago
                first_pass.last_visitor_seconds <
                    (SELECT seconds FROM ten_minutes_ago)
            AND
                -- only notify users about visits made after their last activity
                extract(epoch from person.last_online_time) < first_pass.last_visitor_seconds
            AND
                -- only notify users whose last activity was longer than ten
                -- minutes ago
                extract(epoch from person.last_online_time) <
                    (SELECT seconds FROM ten_minutes_ago)
        ) AS has_visitor,
        person.name,
        person.email,
        CASE
            WHEN im_chats.name = 'Immediately'  THEN 0
            WHEN im_chats.name = 'Daily'        THEN 86400
            WHEN im_chats.name = 'Every 3 days' THEN 259200
            WHEN im_chats.name = 'Weekly'       THEN 604800
            WHEN im_chats.name = 'Never'        THEN -1
            ELSE                                     0
        END AS chats_drift_seconds,
        CASE
            WHEN im_intros.name = 'Immediately'  THEN 0
            WHEN im_intros.name = 'Daily'        THEN 86400
            WHEN im_intros.name = 'Every 3 days' THEN 259200
            WHEN im_intros.name = 'Weekly'       THEN 604800
            WHEN im_intros.name = 'Never'        THEN -1
            ELSE                                      0
        END AS intros_drift_seconds,
        CASE
            WHEN im_visitors.name = 'Immediately'  THEN 0
            WHEN im_visitors.name = 'Daily'        THEN 86400
            WHEN im_visitors.name = 'Every 3 days' THEN 259200
            WHEN im_visitors.name = 'Weekly'       THEN 604800
            WHEN im_visitors.name = 'Never'        THEN -1
            ELSE                                        604800
        END AS visitors_drift_seconds
    FROM
        first_pass
    JOIN
        person
    ON
        person.uuid = uuid_or_null(first_pass.username)
    LEFT JOIN
        immediacy AS im_chats
    ON
        im_chats.id = person.chats_notification
    LEFT JOIN
        immediacy AS im_intros
    ON
        im_intros.id = person.intros_notification
    LEFT JOIN
        immediacy AS im_visitors
    ON
        im_visitors.id = person.visitors_notification
    WHERE
        person.activated
), filtered AS (
    SELECT * FROM notifiable WHERE has_intro OR has_chat OR has_visitor
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
    filtered.last_intro_seconds,
    filtered.last_chat_seconds,
    filtered.last_visitor_seconds,
    filtered.last_intro_notification_seconds,
    filtered.last_chat_notification_seconds,
    filtered.last_visitor_notification_seconds,
    filtered.has_intro,
    filtered.has_chat,
    filtered.has_visitor,
    -- One row per notification to send (see the LATERAL join below): a
    -- non-NULL token produces a push, a NULL token produces an email.
    notification_target.token,
    filtered.name,
    filtered.email,
    filtered.chats_drift_seconds,
    filtered.intros_drift_seconds,
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
