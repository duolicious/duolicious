"""Queries for reading a person's model inputs and storing the result."""

Q_STALE_PEOPLE = """
SELECT id
FROM person
ORDER BY kv_vector_computed_at ASC, id ASC
LIMIT %(batch_size)s
"""

Q_PERSON_ROWS = """
SELECT
    p.id,
    EXTRACT(YEAR FROM AGE(p.date_of_birth))::INT AS age,
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
    s.club_name IS NOT NULL AS has_club_filter,
    s.two_way_gender, s.two_way_age, s.two_way_furthest_distance,
    s.two_way_orientation, s.two_way_relationship_status, s.two_way_looking_for,
    s.two_way_wants_kids, s.two_way_has_kids, s.two_way_has_a_profile_picture,
    s.two_way_drugs, s.two_way_long_distance, s.two_way_ethnicity,
    s.two_way_smoking, s.two_way_religion, s.two_way_drinking, s.two_way_height,
    s.two_way_exercise, s.two_way_star_sign
FROM person p
LEFT JOIN search_preference s ON s.person_id = p.id
WHERE p.id = ANY(%(person_ids)s)
ORDER BY p.id
"""

Q_ANSWERS = """
SELECT person_id, question_id, answer
FROM answer
WHERE person_id = ANY(%(person_ids)s)
AND answer IS NOT NULL
"""

Q_PREF_ANSWERS = """
SELECT person_id, question_id, answer
FROM search_preference_answer
WHERE person_id = ANY(%(person_ids)s)
AND answer IS NOT NULL
"""

Q_CLUBS = """
SELECT person_id, club_name
FROM person_club
WHERE person_id = ANY(%(person_ids)s)
AND activated
"""

Q_WRITE_VECTORS = """
UPDATE person
SET kv_vector = data.vector::halfvec,
    kv_vector_computed_at = NOW()
FROM (
    SELECT
        unnest(%(person_ids)s::INT[]) AS id,
        unnest(%(vectors)s::TEXT[]) AS vector
) AS data
WHERE person.id = data.id
"""
