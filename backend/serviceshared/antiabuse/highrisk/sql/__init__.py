_TARGET = """
target AS (
    SELECT
        person.id AS person_id,
        target.hours,
        person.sign_up_time,
        person.sign_up_time + target.hours * INTERVAL '1 hour' AS as_of
    FROM
        unnest(%(person_ids)s::INT[], %(hours)s::INT[])
            AS target(person_id, hours)
    JOIN
        person
    ON
        person.id = target.person_id
)
"""

Q_PROFILES = f"""
WITH {_TARGET}
SELECT
    target.person_id,
    target.hours,
    person.gender_id,
    date_part('year', age(person.sign_up_time, person.date_of_birth))::INT
        AS age,
    person.name,
    person.about,
    split_part(person.email, '@', 2) AS email_domain,
    (
        extract(HOUR FROM person.sign_up_time)
        + extract(MINUTE FROM person.sign_up_time) / 60
    )::FLOAT8 AS sign_up_hour,
    ST_Y(person.coordinates::geometry) AS latitude,
    ST_X(person.coordinates::geometry) AS longitude,
    person.location_country AS country
FROM
    target
JOIN
    person
ON
    person.id = target.person_id
"""

Q_PHOTOS = """
SELECT
    person_id,
    clip_embedding::REAL[] AS clip_embedding
FROM
    photo
WHERE
    person_id = ANY(%(person_ids)s::INT[])
AND
    clip_embedding IS NOT NULL
ORDER BY
    person_id,
    position
"""

Q_SESSIONS = f"""
WITH {_TARGET}
SELECT
    target.person_id,
    target.hours,
    host(duo_session.ip_address) AS ip,
    (extract(EPOCH FROM
        duo_session.session_expiry - INTERVAL '6 months'
        - target.sign_up_time
    ) / 3600)::FLOAT8 AS hours_after_sign_up
FROM
    target
JOIN
    duo_session
ON
    duo_session.person_id = target.person_id
WHERE
    duo_session.ip_address IS NOT NULL
AND
    duo_session.session_expiry - INTERVAL '6 months' < target.as_of
"""

Q_MESSAGES = f"""
WITH {_TARGET}, message AS (
    SELECT
        target.person_id,
        target.hours,
        target.sign_up_time,
        mam_message.id,
        mam_message.direction,
        mam_message.remote_bare_jid,
        mam_message.body,
        mam_message.audio_uuid IS NOT NULL AS is_audio,
        row_number() OVER (
            PARTITION BY
                target.person_id,
                target.hours,
                mam_message.remote_bare_jid
            ORDER BY
                mam_message.id
        ) = 1 AS first_in_chat
    FROM
        target
    JOIN
        mam_message
    ON
        mam_message.person_id = target.person_id
    WHERE
        mam_message.id <
            (extract(EPOCH FROM target.as_of) * 1e6)::BIGINT << 8
)
SELECT
    message.person_id,
    message.hours,
    message.direction = 'O' AS sent,
    message.remote_bare_jid,
    message.body,
    message.is_audio,
    message.first_in_chat,
    (extract(EPOCH FROM
        to_timestamp((message.id >> 8) / 1e6)::TIMESTAMP
        - message.sign_up_time
    ) / 3600)::FLOAT8 AS hours_after_sign_up
FROM
    message
"""

Q_ACTIVITY = f"""
WITH {_TARGET}
SELECT
    target.person_id,
    target.hours,
    (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            subject_person_id = target.person_id
        AND
            created_at < target.as_of
    ) AS skips_made,
    (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            subject_person_id = target.person_id
        AND
            created_at < target.as_of
        AND
            reported
    ) AS reports_made,
    (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            object_person_id = target.person_id
        AND
            created_at < target.as_of
    ) AS skips_got,
    (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            object_person_id = target.person_id
        AND
            created_at < target.as_of
        AND
            reported
    ) AS reports_got,
    (
        SELECT
            count(*)
        FROM
            visited
        WHERE
            subject_person_id = target.person_id
        AND
            updated_at < target.as_of
    ) AS visits_made,
    (
        SELECT
            count(*)
        FROM
            visited
        WHERE
            object_person_id = target.person_id
        AND
            updated_at < target.as_of
    ) AS visits_got,
    (
        SELECT
            count(*)
        FROM
            rude_message
        WHERE
            person_id = target.person_id
        AND
            created_at < target.as_of
    ) AS rude_messages
FROM
    target
"""

Q_LINKED = f"""
WITH {_TARGET}, own_network AS (
    SELECT DISTINCT
        target.person_id,
        target.hours,
        network(set_masklen(
            duo_session.ip_address,
            CASE family(duo_session.ip_address) WHEN 4 THEN 24 ELSE 64 END
        )) AS network
    FROM
        target
    JOIN
        duo_session
    ON
        duo_session.person_id = target.person_id
    WHERE
        duo_session.ip_address IS NOT NULL
    AND
        duo_session.session_expiry - INTERVAL '6 months' < target.as_of
), neighbour AS (
    SELECT DISTINCT
        target.person_id,
        target.hours,
        duo_session.person_id AS neighbour_id
    FROM
        target
    JOIN
        own_network
    ON
        own_network.person_id = target.person_id
    AND
        own_network.hours = target.hours
    JOIN
        duo_session
    ON
        duo_session.ip_address << own_network.network
    WHERE
        duo_session.person_id <> target.person_id
    AND
        duo_session.session_expiry - INTERVAL '6 months' < target.as_of
)
SELECT
    target.person_id,
    target.hours,
    count(other.id) AS people,
    count(other.id) FILTER (
        WHERE other.shadow_banned_at < target.as_of
    ) AS banned,
    count(other.id) FILTER (
        WHERE other.sign_up_time >= target.as_of - INTERVAL '30 days'
    ) AS recent,
    count(other.id) FILTER (
        WHERE other.sign_up_time >= target.as_of - INTERVAL '30 days'
        AND other.gender_id = person.gender_id
    ) AS alike
FROM
    target
JOIN
    person
ON
    person.id = target.person_id
LEFT JOIN
    neighbour
ON
    neighbour.person_id = target.person_id
AND
    neighbour.hours = target.hours
LEFT JOIN
    person AS other
ON
    other.id = neighbour.neighbour_id
GROUP BY
    target.person_id,
    target.hours
"""
