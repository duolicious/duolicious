"""The rows a person's model features are built from, and the writes that
store their computed vector and cached preactivations.

Each query serves one person or the whole population, so the training
extraction reads exactly the columns the backend does instead of a second
list to keep in step with this one.
"""


def person_rows_query(everyone: bool) -> str:
    scope = "" if everyone else "WHERE p.id = %(person_id)s"
    return f"""
SELECT
    p.id,
    EXTRACT(YEAR FROM p.date_of_birth)::INT AS birth_year,
    p.height_cm,
    ST_Y(p.coordinates::geometry) AS lat,
    ST_X(p.coordinates::geometry) AS lon,
    p.location_country AS country,
    p.gender_id, p.orientation_id, p.ethnicity_id, p.looking_for_id,
    p.smoking_id, p.drinking_id, p.drugs_id, p.long_distance_id,
    p.relationship_status_id, p.has_kids_id, p.wants_kids_id, p.exercise_id,
    p.religion_id, p.star_sign_id,
    s.gender_ids, s.orientation_ids, s.ethnicity_ids, s.has_profile_picture_ids,
    s.looking_for_ids, s.smoking_ids, s.drinking_ids, s.drugs_ids,
    s.long_distance_ids, s.relationship_status_ids, s.has_kids_ids,
    s.wants_kids_ids, s.exercise_ids, s.religion_ids, s.star_sign_ids,
    s.min_age, s.max_age, s.min_height_cm, s.max_height_cm, s.distance,
    s.last_online_id,
    p.count_intros_received, p.count_intros_replied, p.count_intros_sent,
    p.count_messages_received,
    p.verification_level_id,
    p.about,
    (SELECT count(*) FROM photo WHERE photo.person_id = p.id) AS photo_count,
    (SELECT count(*) FROM person_club pc
     WHERE pc.person_id = p.id AND pc.activated) AS club_count,
    s.club_name IS NOT NULL AS has_club_filter,
    s.two_way_gender, s.two_way_age, s.two_way_furthest_distance,
    s.two_way_orientation, s.two_way_relationship_status, s.two_way_looking_for,
    s.two_way_wants_kids, s.two_way_has_kids, s.two_way_has_a_profile_picture,
    s.two_way_drugs, s.two_way_long_distance, s.two_way_ethnicity,
    s.two_way_smoking, s.two_way_religion, s.two_way_drinking, s.two_way_height,
    s.two_way_exercise, s.two_way_star_sign
FROM person p
LEFT JOIN search_preference s ON s.person_id = p.id
{scope}
ORDER BY p.id
"""


def answers_query(everyone: bool) -> str:
    return _answers_query("answer", everyone)


def pref_answers_query(everyone: bool) -> str:
    return _answers_query("search_preference_answer", everyone)


def _answers_query(table: str, everyone: bool) -> str:
    scope = "" if everyone else "AND person_id = %(person_id)s"
    return f"""
SELECT person_id, question_id, answer
FROM {table}
WHERE answer IS NOT NULL
{scope}
"""

Q_QPRE = """
SELECT
    kv_who_pre AS who_pre,
    kv_look_pre AS look_pre
FROM person
WHERE id = %(person_id)s
AND kv_who_pre IS NOT NULL
"""

Q_WRITE_QPRE = """
UPDATE person
SET
    kv_who_pre = %(who_pre)s,
    kv_look_pre = %(look_pre)s
WHERE id = %(person_id)s
"""

Q_ADD_QPRE = """
UPDATE person
SET
    kv_who_pre = kv_who_pre + %(who_delta)s,
    kv_look_pre = kv_look_pre + %(look_delta)s
WHERE id = %(person_id)s
AND kv_who_pre IS NOT NULL
RETURNING
    kv_who_pre AS who_pre,
    kv_look_pre AS look_pre
"""

Q_WRITE_VECTOR = """
UPDATE person
SET kv_vector = %(vector)s
WHERE id = %(person_id)s
"""


def beh_counts_query(everyone: bool) -> str:
    """The single definition of the four behaviour counters, used by the
    training extraction (with a cutoff, for the whole population), the
    backfill (no cutoff, a batch of people) and `verify_serving`. A messaged
    row is a reply when a strictly earlier row exists the other way; a tie
    (both directions in one batch, sharing a transaction's now()) counts as
    crossed intros, which is also how the chat path counts it live.

    `messages_received` counts the recipient's own archive copies, so
    messages from shadow-banned senders (never delivered) do not count.
    The mam id encodes the timestamp in its high bits, so the cutoff is
    applied to `id` directly (`cutoff_mid`), keeping the scan on the primary
    key.
    """
    scope_m = ("" if everyone else
               "AND (subject_person_id = ANY(%(person_ids)s)"
               " OR object_person_id = ANY(%(person_ids)s))")
    scope_p = "" if everyone else "WHERE id = ANY(%(person_ids)s)"
    scope_a = "" if everyone else "AND person_id = ANY(%(person_ids)s)"
    return f"""
WITH m AS (
    SELECT
        subject_person_id AS s,
        object_person_id AS o,
        EXISTS (
            SELECT 1 FROM messaged r
            WHERE r.subject_person_id = m0.object_person_id
            AND r.object_person_id = m0.subject_person_id
            AND r.created_at < m0.created_at
        ) AS is_reply
    FROM messaged m0
    WHERE (%(cutoff)s::TIMESTAMP IS NULL OR created_at < %(cutoff)s)
    {scope_m}
), received AS (
    SELECT o AS pid, count(*) AS n
    FROM m
    WHERE NOT is_reply
    GROUP BY o
), sent AS (
    SELECT
        s AS pid,
        count(*) FILTER (WHERE NOT is_reply) AS n_sent,
        count(*) FILTER (WHERE is_reply) AS n_replied
    FROM m
    GROUP BY s
), archive AS (
    SELECT person_id AS pid, count(*) AS n
    FROM mam_message
    WHERE direction = 'I'
    AND (%(cutoff_mid)s::BIGINT IS NULL OR id < %(cutoff_mid)s)
    {scope_a}
    GROUP BY person_id
)
SELECT
    person.id AS person_id,
    COALESCE(received.n, 0)::INT AS count_intros_received,
    COALESCE(sent.n_replied, 0)::INT AS count_intros_replied,
    COALESCE(sent.n_sent, 0)::INT AS count_intros_sent,
    COALESCE(archive.n, 0)::INT AS count_messages_received
FROM person
LEFT JOIN received ON received.pid = person.id
LEFT JOIN sent ON sent.pid = person.id
LEFT JOIN archive ON archive.pid = person.id
{scope_p}
"""
