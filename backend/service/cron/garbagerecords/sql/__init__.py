from commonsql import Q_UPDATE_VERIFICATION_LEVEL_ASSIGN

Q_DELETE_GARBAGE_RECORDS = f"""
WITH q1 AS (
    DELETE FROM
        banned_person_admin_token
    WHERE
        expires_at < NOW()
    RETURNING
        1
), q2 AS (
    DELETE FROM
        deleted_photo_admin_token
    WHERE
        expires_at < NOW()
    RETURNING
        1
), q3 AS (
    DELETE FROM
        banned_person
    WHERE
        expires_at < NOW()
    RETURNING
        1
), q4 AS (
    DELETE FROM
        duo_session
    WHERE
        session_expiry < NOW()
    RETURNING
        1
), q5 AS (
    DELETE FROM
        onboardee
    WHERE
        created_at < NOW() - INTERVAL '1 week'
    RETURNING
        1
), q6 AS (
    DELETE FROM
        verification_job
    WHERE
        expires_at < NOW()
    RETURNING
        photo_uuid AS uuid
), q7 AS (
    DELETE FROM
        photo
    WHERE
        nsfw_score > 0.8
    RETURNING
        uuid, person_id
), each_deleted_photo AS (
    SELECT uuid FROM q6

    UNION

    SELECT uuid FROM q7
), q8 AS (
    DELETE FROM
        export_data_token
    WHERE
        expires_at < NOW()
    RETURNING
        1
), q9 AS (
    INSERT INTO
        undeleted_photo (uuid)
    SELECT
        uuid
    FROM
        each_deleted_photo
    RETURNING
        1
), q10 AS (
    UPDATE
        person
    SET
        {Q_UPDATE_VERIFICATION_LEVEL_ASSIGN},

        -- The account's last event was likely `added_photo_uuid`, but we just
        -- removed the photo which the event referred to.
        last_event_time = sign_up_time,
        last_event_name = 'joined',
        last_event_data = '{{}}'  -- Escape python's f-string syntax
    WHERE
        id IN (SELECT person_id FROM q7)
)
SELECT
    SUM(n) AS count
FROM (
    SELECT 1 AS n FROM q1 UNION ALL
    SELECT 1 AS n FROM q2 UNION ALL
    SELECT 1 AS n FROM q3 UNION ALL
    SELECT 1 AS n FROM q4 UNION ALL
    SELECT 1 AS n FROM q5 UNION ALL
    SELECT 1 AS n FROM q6 UNION ALL
    SELECT 1 AS n FROM q7 UNION ALL
    SELECT 1 AS n FROM q8
) AS t(n)
"""
