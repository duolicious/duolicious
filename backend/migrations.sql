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

CREATE INDEX IF NOT EXISTS idx__search_preference_age__person_id__bounds
    ON search_preference_age(person_id) INCLUDE (min_age, max_age);

CREATE INDEX IF NOT EXISTS idx__search_preference_distance__person_id__distance
    ON search_preference_distance(person_id) INCLUDE (distance);

CREATE INDEX IF NOT EXISTS idx__search_preference_height_cm__person_id__bounds
    ON search_preference_height_cm(person_id) INCLUDE (min_height_cm, max_height_cm);
