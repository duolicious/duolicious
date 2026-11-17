from serviceshared.antiabuse.highrisk.features import FIRST_CHECK_HOURS
from serviceshared.antiabuse.networkactivity import (
    NETWORK_EVENT,
    decay_sql,
    network_sql,
    replayed_sql,
)

_TARGET = f"""
target AS (
    SELECT
        person.id AS person_id,
        target.hours,
        person.sign_up_time,
        person.sign_up_time
            + greatest(target.hours, {FIRST_CHECK_HOURS}) * INTERVAL '1 hour'
            AS as_of
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
    date_part('year', age(person.sign_up_time, person.date_of_birth))::INT
        AS age,
    person.about,
    (
        extract(HOUR FROM person.sign_up_time)
        + extract(MINUTE FROM person.sign_up_time) / 60
    )::FLOAT8 AS sign_up_hour,
    ST_Y(person.coordinates::geometry) AS latitude,
    ST_X(person.coordinates::geometry) AS longitude,
    person.location_country AS country,
    cardinality(search_preference.gender_ids) AS genders_sought,
    coalesce(1 = ANY(search_preference.gender_ids), FALSE) AS seeks_men,
    coalesce(2 = ANY(search_preference.gender_ids), FALSE) AS seeks_women
FROM
    target
JOIN
    person
ON
    person.id = target.person_id
LEFT JOIN
    search_preference
ON
    search_preference.person_id = target.person_id
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
        duo_session.signed_in_at - target.sign_up_time
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
    duo_session.signed_in_at < target.as_of
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
    made.skips AS skips_made,
    made.reports AS reports_made,
    got.skips AS skips_got,
    got.reports AS reports_got,
    visit.visits AS visits_made,
    visitor.visits AS visits_got,
    recipient.men AS recipient_men,
    recipient.age_gap AS recipient_age_gap,
    recipient.km AS recipient_km,
    visit.age_gap AS visit_age_gap,
    visit.men AS visit_men
FROM
    target
JOIN
    person
ON
    person.id = target.person_id
CROSS JOIN LATERAL (
    SELECT
        count(*) AS skips,
        count(*) FILTER (WHERE reported) AS reports
    FROM
        skipped
    WHERE
        subject_person_id = target.person_id
    AND
        created_at < target.as_of
) AS made
CROSS JOIN LATERAL (
    SELECT
        count(*) AS skips,
        count(*) FILTER (WHERE reported) AS reports
    FROM
        skipped
    WHERE
        object_person_id = target.person_id
    AND
        created_at < target.as_of
) AS got
CROSS JOIN LATERAL (
    SELECT
        count(*) AS visits
    FROM
        visited
    WHERE
        object_person_id = target.person_id
    AND
        updated_at < target.as_of
) AS visitor
CROSS JOIN LATERAL (
    SELECT
        avg((other.gender_id = 1)::INT)::FLOAT8 AS men,
        avg(
            date_part('year', age(target.sign_up_time, other.date_of_birth))
            - date_part('year', age(target.sign_up_time, person.date_of_birth))
        )::FLOAT8 AS age_gap,
        avg(ST_Distance(other.coordinates, person.coordinates) / 1000)::FLOAT8
            AS km
    FROM
        messaged
    JOIN
        person AS other
    ON
        other.id = messaged.object_person_id
    WHERE
        messaged.subject_person_id = target.person_id
    AND
        messaged.created_at < target.as_of
) AS recipient
CROSS JOIN LATERAL (
    SELECT
        count(*) AS visits,
        avg((other.gender_id = 1)::INT)::FLOAT8 AS men,
        avg(
            date_part('year', age(target.sign_up_time, other.date_of_birth))
            - date_part('year', age(target.sign_up_time, person.date_of_birth))
        )::FLOAT8 AS age_gap
    FROM
        visited
    JOIN
        person AS other
    ON
        other.id = visited.object_person_id
    WHERE
        visited.subject_person_id = target.person_id
    AND
        visited.updated_at < target.as_of
) AS visit
"""

_OWN_NETWORK = f"""
own_network AS (
    SELECT DISTINCT
        target.person_id,
        target.hours,
        target.as_of,
        {network_sql('duo_session.ip_address')} AS network
    FROM
        target
    JOIN
        duo_session
    ON
        duo_session.person_id = target.person_id
    WHERE
        duo_session.ip_address IS NOT NULL
    AND
        duo_session.signed_in_at < target.as_of
)
"""

_DECAY_UNTIL_SCORE = decay_sql(
    'network_activity.updated_at', 'own_network.as_of')

Q_NETWORK_ACTIVITY = f"""
WITH {_TARGET}, {_OWN_NETWORK}
SELECT
    target.person_id,
    target.hours,
    coalesce(sum(
        network_activity.sign_ups * {_DECAY_UNTIL_SCORE}
    ), 0)::FLOAT8 AS sign_ups,
    coalesce(sum(
        network_activity.shadow_bans * {_DECAY_UNTIL_SCORE}
    ), 0)::FLOAT8 AS shadow_bans
FROM
    target
LEFT JOIN
    own_network
ON
    own_network.person_id = target.person_id
AND
    own_network.hours = target.hours
LEFT JOIN
    network_activity
ON
    network_activity.network = own_network.network
GROUP BY
    target.person_id,
    target.hours
"""

Q_PAST_NETWORK_ACTIVITY = f"""
WITH {_TARGET}, {_OWN_NETWORK}, {NETWORK_EVENT}
SELECT
    target.person_id,
    target.hours,
    {replayed_sql('sign up', 'own_network.as_of')}::FLOAT8 AS sign_ups,
    {replayed_sql('shadow ban', 'own_network.as_of')}::FLOAT8 AS shadow_bans
FROM
    target
LEFT JOIN
    own_network
ON
    own_network.person_id = target.person_id
AND
    own_network.hours = target.hours
LEFT JOIN
    network_event
ON
    network_event.network = own_network.network
AND
    network_event.at <= own_network.as_of
AND NOT (
    network_event.kind = 'shadow ban'
    AND network_event.person_id = own_network.person_id
)
GROUP BY
    target.person_id,
    target.hours
"""
