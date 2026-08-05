-- Schema migrations, applied on every boot (see service/api/bootstrap.py),
-- after init-api.sql has created the base schema on a fresh database. Because
-- this file re-runs against an already-migrated database each time, every
-- statement here MUST be idempotent -- use IF NOT EXISTS / IF EXISTS (or an
-- equivalent guard) so re-running is a no-op.
--
-- Every change here must ALSO be made to init-api.sql, which is the schema a
-- fresh database is created from (this file only reaches existing databases).
-- init-api.sql is the source of truth for the current schema; migrations.sql
-- carries the same change to already-created databases.

-- The HNSW graph degenerates when many people share byte-identical
-- personality vectors (every unanswered profile holds the default), silently
-- omitting matching prospects from /search; the search now orders by exact
-- distance instead, and nothing else queries by personality proximity.
DROP INDEX IF EXISTS idx__person__personality;

-- Create the flat table and backfill it from the per-attribute preference
-- tables, which this release's code no longer maintains and the next
-- release's migrations drop, along with this whole block. Their absence means
-- there is nothing to upgrade: init-api.sql already creates the flat table on
-- a fresh database, and once they are dropped the work is long done.
DO $$
BEGIN
    IF to_regclass('search_preference_gender') IS NULL THEN
        RETURN;
    END IF;

    CREATE TABLE IF NOT EXISTS search_preference (
        person_id INT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,

        gender_ids              SMALLINT[] NOT NULL,
        orientation_ids         SMALLINT[] NOT NULL,
        ethnicity_ids           SMALLINT[] NOT NULL,
        has_profile_picture_ids SMALLINT[] NOT NULL,
        looking_for_ids         SMALLINT[] NOT NULL,
        smoking_ids             SMALLINT[] NOT NULL,
        drinking_ids            SMALLINT[] NOT NULL,
        drugs_ids               SMALLINT[] NOT NULL,
        long_distance_ids       SMALLINT[] NOT NULL,
        relationship_status_ids SMALLINT[] NOT NULL,
        has_kids_ids            SMALLINT[] NOT NULL,
        wants_kids_ids          SMALLINT[] NOT NULL,
        exercise_ids            SMALLINT[] NOT NULL,
        religion_ids            SMALLINT[] NOT NULL,
        star_sign_ids           SMALLINT[] NOT NULL,

        min_age SMALLINT,
        max_age SMALLINT,
        min_height_cm SMALLINT,
        max_height_cm SMALLINT,
        distance SMALLINT,

        last_online_id SMALLINT NOT NULL REFERENCES last_online(id) ON DELETE CASCADE,

        club_name TEXT REFERENCES club(name) ON DELETE SET NULL,

        show_messaged BOOLEAN NOT NULL DEFAULT TRUE,
        show_skipped BOOLEAN NOT NULL DEFAULT FALSE,

        two_way_gender                BOOLEAN NOT NULL DEFAULT TRUE,
        two_way_age                   BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_furthest_distance     BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_orientation           BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_relationship_status   BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_looking_for           BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_wants_kids            BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_has_kids              BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_has_a_profile_picture BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_drugs                 BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_long_distance         BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_ethnicity             BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_smoking               BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_religion              BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_drinking              BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_height                BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_exercise              BOOLEAN NOT NULL DEFAULT FALSE,
        two_way_star_sign             BOOLEAN NOT NULL DEFAULT FALSE
    );

    INSERT INTO search_preference (
        person_id,
        gender_ids,
        orientation_ids,
        ethnicity_ids,
        has_profile_picture_ids,
        looking_for_ids,
        smoking_ids,
        drinking_ids,
        drugs_ids,
        long_distance_ids,
        relationship_status_ids,
        has_kids_ids,
        wants_kids_ids,
        exercise_ids,
        religion_ids,
        star_sign_ids,
        min_age,
        max_age,
        min_height_cm,
        max_height_cm,
        distance,
        last_online_id,
        club_name,
        show_messaged,
        show_skipped,
        two_way_gender,
        two_way_age,
        two_way_furthest_distance,
        two_way_orientation,
        two_way_relationship_status,
        two_way_looking_for,
        two_way_wants_kids,
        two_way_has_kids,
        two_way_has_a_profile_picture,
        two_way_drugs,
        two_way_long_distance,
        two_way_ethnicity,
        two_way_smoking,
        two_way_religion,
        two_way_drinking,
        two_way_height,
        two_way_exercise,
        two_way_star_sign
    )
    SELECT
        person.id,
        ARRAY(SELECT gender_id FROM search_preference_gender WHERE person_id = person.id ORDER BY gender_id),
        ARRAY(SELECT orientation_id FROM search_preference_orientation WHERE person_id = person.id ORDER BY orientation_id),
        ARRAY(SELECT ethnicity_id FROM search_preference_ethnicity WHERE person_id = person.id ORDER BY ethnicity_id),
        ARRAY(SELECT has_profile_picture_id FROM search_preference_has_profile_picture WHERE person_id = person.id ORDER BY has_profile_picture_id),
        ARRAY(SELECT looking_for_id FROM search_preference_looking_for WHERE person_id = person.id ORDER BY looking_for_id),
        ARRAY(SELECT smoking_id FROM search_preference_smoking WHERE person_id = person.id ORDER BY smoking_id),
        ARRAY(SELECT drinking_id FROM search_preference_drinking WHERE person_id = person.id ORDER BY drinking_id),
        ARRAY(SELECT drugs_id FROM search_preference_drugs WHERE person_id = person.id ORDER BY drugs_id),
        ARRAY(SELECT long_distance_id FROM search_preference_long_distance WHERE person_id = person.id ORDER BY long_distance_id),
        ARRAY(SELECT relationship_status_id FROM search_preference_relationship_status WHERE person_id = person.id ORDER BY relationship_status_id),
        ARRAY(SELECT has_kids_id FROM search_preference_has_kids WHERE person_id = person.id ORDER BY has_kids_id),
        ARRAY(SELECT wants_kids_id FROM search_preference_wants_kids WHERE person_id = person.id ORDER BY wants_kids_id),
        ARRAY(SELECT exercise_id FROM search_preference_exercise WHERE person_id = person.id ORDER BY exercise_id),
        ARRAY(SELECT religion_id FROM search_preference_religion WHERE person_id = person.id ORDER BY religion_id),
        ARRAY(SELECT star_sign_id FROM search_preference_star_sign WHERE person_id = person.id ORDER BY star_sign_id),
        (SELECT min_age FROM search_preference_age WHERE person_id = person.id),
        (SELECT max_age FROM search_preference_age WHERE person_id = person.id),
        (SELECT min_height_cm FROM search_preference_height_cm WHERE person_id = person.id),
        (SELECT max_height_cm FROM search_preference_height_cm WHERE person_id = person.id),
        (SELECT distance FROM search_preference_distance WHERE person_id = person.id),
        COALESCE(
            (SELECT last_online_id FROM search_preference_last_online WHERE person_id = person.id),
            (SELECT id FROM last_online WHERE name = 'A month ago')
        ),
        (SELECT club_name FROM search_preference_club WHERE person_id = person.id),
        COALESCE(
            (
                SELECT yes_no.name = 'Yes'
                FROM search_preference_messaged
                JOIN yes_no ON yes_no.id = messaged_id
                WHERE person_id = person.id
            ),
            TRUE
        ),
        COALESCE(
            (
                SELECT yes_no.name = 'Yes'
                FROM search_preference_skipped
                JOIN yes_no ON yes_no.id = skipped_id
                WHERE person_id = person.id
            ),
            FALSE
        ),
        COALESCE(two_way.gender, TRUE),
        COALESCE(two_way.age, FALSE),
        COALESCE(two_way.furthest_distance, FALSE),
        COALESCE(two_way.orientation, FALSE),
        COALESCE(two_way.relationship_status, FALSE),
        COALESCE(two_way.looking_for, FALSE),
        COALESCE(two_way.wants_kids, FALSE),
        COALESCE(two_way.has_kids, FALSE),
        COALESCE(two_way.has_a_profile_picture, FALSE),
        COALESCE(two_way.drugs, FALSE),
        COALESCE(two_way.long_distance, FALSE),
        COALESCE(two_way.ethnicity, FALSE),
        COALESCE(two_way.smoking, FALSE),
        COALESCE(two_way.religion, FALSE),
        COALESCE(two_way.drinking, FALSE),
        COALESCE(two_way.height, FALSE),
        COALESCE(two_way.exercise, FALSE),
        COALESCE(two_way.star_sign, FALSE)
    FROM person
    LEFT JOIN search_preference_two_way_filters AS two_way
    ON two_way.person_id = person.id
    WHERE NOT EXISTS (
        SELECT 1 FROM search_preference WHERE person_id = person.id
    )
    ON CONFLICT (person_id) DO NOTHING;

    ANALYZE search_preference;
END
$$;
