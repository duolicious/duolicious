Q_LAST_MESSAGES = """
WITH last_messages AS (
    SELECT
        mam_message.id AS id,
        CASE
        WHEN mam_message.direction = 'O'
            THEN 'reporter'
            ELSE 'accused'
        END AS sent_by,
        body
    FROM
        mam_message
    JOIN
        person
    ON
        person.id = mam_message.person_id
    AND
        person.uuid = %(subject_uuid)s
    WHERE
        mam_message.remote_bare_jid IN (
            %(subject_uuid)s::TEXT,
            %(object_uuid)s::TEXT
        )
    ORDER BY
        mam_message.id DESC
    LIMIT 25
)
SELECT
    sent_by,
    body
FROM
    last_messages
ORDER BY
    id
"""

Q_MAKE_REPORT = """
WITH object_person_id AS (
    SELECT
        id
    FROM
        person
    WHERE
        uuid = %(object_uuid)s
), subject_person_id AS (
    SELECT
        id
    FROM
        person
    WHERE
        uuid = %(subject_uuid)s
), token AS (
    INSERT INTO banned_person_admin_token (
        person_id
    )
    VALUES
        ((SELECT id FROM subject_person_id)),
        ((SELECT id FROM object_person_id))
    RETURNING
        person_id,
        token
), photo_ban AS (
    INSERT INTO deleted_photo_admin_token (
        photo_uuid
    )
    SELECT
        uuid AS photo_uuid
    FROM
        photo
    JOIN
        token
    ON
        photo.person_id = token.person_id
    RETURNING
        photo_uuid,
        token
), photo_ban_with_id AS (
    SELECT
        photo_ban.photo_uuid AS uuid,
        token.person_id AS person_id,
        photo_ban.token AS token,
        photo.position AS position
    FROM
        photo_ban
    JOIN
        photo ON photo_ban.photo_uuid = photo.uuid
    JOIN
        token ON photo.person_id = token.person_id
)
SELECT
    CASE
        WHEN id = (SELECT id FROM subject_person_id)
        THEN 'Reporter'
        ELSE 'Accused'
    END AS role,
    id,
    uuid::TEXT,
    location_long_friendly AS location,
    split_part(email, '@', 2) AS email_domain,
    ARRAY(
        SELECT DISTINCT
            ip_address::TEXT
        FROM duo_session
        WHERE person_id = p.id
    ) AS ip_addresses,
    count_answers,
    ARRAY(
        SELECT
            'https://user-images.duolicious.app/original-' || uuid || '.jpg'
        FROM photo
        WHERE photo.person_id = p.id
        ORDER BY position
    ) AS photo_links,
    ARRAY(
        SELECT
            uuid || ': https://api.duolicious.app/admin/delete-photo-link/' || photo_ban_with_id.token
        FROM photo_ban_with_id
        WHERE photo_ban_with_id.person_id = p.id
        ORDER BY position
    ) AS photo_deletion_links,
    EXTRACT(YEAR FROM AGE(date_of_birth))::int AS age,
    name,
    (
        select name from gender where id = gender_id
    ) AS gender,
    occupation,
    education,
    about,
    ARRAY(
        SELECT
            club_name
        FROM person_club
        WHERE person_id = p.id
    ) AS clubs,
    token::text,
    FLOOR(
        EXTRACT(epoch FROM age(now(), sign_up_time)) / 86400
    )::INT AS account_age_in_days,
    (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            reported
        AND
            object_person_id = p.id
    ) AS times_reported,
    (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            reported
        AND
            object_person_id = p.id
        AND
            created_at > NOW() - INTERVAL '1 day'
    ) AS times_reported_in_the_past_24_hours,
    ARRAY(
        SELECT
            report_reason
        FROM
            skipped
        WHERE
            reported
        AND
            object_person_id = p.id
        AND
            report_reason <> ''
    ) AS all_report_reasons,
    (
        SELECT
            name
        FROM
            verification_level
        WHERE
            verification_level.id = p.verification_level_id
    ) AS verification_level
FROM
    person AS p
JOIN
    token
ON
    token.person_id = p.id
ORDER BY
    (id = (SELECT id FROM subject_person_id)) DESC
"""

Q_INSERT_SKIPPED = """
WITH subject_person_id AS (
    SELECT
        id
    FROM
        person
    WHERE
        uuid = uuid_or_null(%(subject_uuid)s::TEXT)
), object_person_id AS (
    SELECT
        id
    FROM
        person
    WHERE
        uuid = uuid_or_null(%(object_uuid)s::TEXT)
), bot_report AS (
    SELECT
        (
            reporter.sign_up_time < now() - interval '1 month'
        AND
            reporter.verification_level_id >= 3
        OR
            reporter.roles && ARRAY['admin', 'mod']
        ) AS is_trustworthy
    FROM
        person AS reporter
    WHERE
        reporter.uuid = uuid_or_null(%(subject_uuid)s::TEXT)
    AND
        %(is_bot_report)s
), q1 AS (
    INSERT INTO skipped (
        subject_person_id,
        object_person_id,
        reported,
        report_reason
    ) VALUES (
        (SELECT id FROM subject_person_id),
        (SELECT id FROM object_person_id),
        %(reported)s,
        %(report_reason)s
    ) ON CONFLICT DO NOTHING
), q2 AS (
    DELETE FROM search_cache
    WHERE
        searcher_person_id = (SELECT id FROM subject_person_id) AND
        prospect_person_id = (SELECT id FROM object_person_id)
    OR
        searcher_person_id = (SELECT id FROM object_person_id) AND
        prospect_person_id = (SELECT id FROM subject_person_id)
), q3 AS (
    UPDATE
        person
    SET
        verification_required = TRUE
    FROM
        bot_report
    WHERE
        bot_report.is_trustworthy
    AND
        person.uuid = uuid_or_null(%(object_uuid)s::TEXT)
    RETURNING
        1
)
SELECT EXISTS (
    SELECT * FROM q3
) AS is_automoded_bot
"""

Q_TRUSTWORTHY_REPORTS = """
SELECT
    object.has_gold AS has_gold,
    ARRAY(
        SELECT
            skipped.report_reason
        FROM
            skipped
        JOIN
            person AS reporter
        ON
            reporter.id = skipped.subject_person_id
        WHERE
            skipped.object_person_id = object.id
        AND
            skipped.reported
        AND
            reporter.sign_up_time
                <= now() - %(min_account_age_days)s * interval '1 day'
        AND
            reporter.shadow_banned_at IS NULL
        AND
            char_length(reporter.about) >= %(min_bio_length)s
        AND
            reporter.count_answers >= %(min_questions_answered)s
        AND
            (
                SELECT
                    count(*)
                FROM
                    messaged
                WHERE
                    messaged.subject_person_id = reporter.id
            ) >= %(min_people_messaged)s
    ) AS trustworthy_report_reasons
FROM
    person AS object
WHERE
    object.uuid = uuid_or_null(%(object_uuid)s::TEXT)
"""

Q_SHADOW_BAN = """
UPDATE
    person
SET
    shadow_banned_at = now()
WHERE
    uuid = uuid_or_null(%(object_uuid)s::TEXT)
AND
    NOT has_gold
"""
