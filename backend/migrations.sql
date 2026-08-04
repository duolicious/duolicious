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

-- The per-attribute search-preference tables were flattened into
-- search_preference (and backfilled from these tables) by the previous
-- release, which left them in place, unmaintained, so that release's
-- predecessor could keep serving during its deploy. Nothing reads or writes
-- them anymore.
DROP TABLE IF EXISTS search_preference_gender;
DROP TABLE IF EXISTS search_preference_orientation;
DROP TABLE IF EXISTS search_preference_ethnicity;
DROP TABLE IF EXISTS search_preference_age;
DROP TABLE IF EXISTS search_preference_distance;
DROP TABLE IF EXISTS search_preference_last_online;
DROP TABLE IF EXISTS search_preference_height_cm;
DROP TABLE IF EXISTS search_preference_has_profile_picture;
DROP TABLE IF EXISTS search_preference_looking_for;
DROP TABLE IF EXISTS search_preference_smoking;
DROP TABLE IF EXISTS search_preference_drinking;
DROP TABLE IF EXISTS search_preference_drugs;
DROP TABLE IF EXISTS search_preference_long_distance;
DROP TABLE IF EXISTS search_preference_relationship_status;
DROP TABLE IF EXISTS search_preference_has_kids;
DROP TABLE IF EXISTS search_preference_wants_kids;
DROP TABLE IF EXISTS search_preference_exercise;
DROP TABLE IF EXISTS search_preference_religion;
DROP TABLE IF EXISTS search_preference_star_sign;
DROP TABLE IF EXISTS search_preference_club;
DROP TABLE IF EXISTS search_preference_messaged;
DROP TABLE IF EXISTS search_preference_skipped;
DROP TABLE IF EXISTS search_preference_two_way_filters;
