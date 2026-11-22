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
--
-- Once a migration has run on production, it is generally fine to delete it
-- from this file: init-api.sql already carries the change for fresh databases.

ALTER TABLE person DROP COLUMN IF EXISTS tiny_id;
ALTER TABLE person DROP COLUMN IF EXISTS club_vector_computed_at;

DROP TABLE IF EXISTS presence_histogram;

ALTER TABLE person ADD COLUMN IF NOT EXISTS marked_safe_at TIMESTAMP;

ALTER TABLE person ADD COLUMN IF NOT EXISTS pre_automod_verification_level_id SMALLINT;

ALTER TABLE inbox ADD COLUMN IF NOT EXISTS intro_score REAL;

ALTER TABLE duo_session ADD COLUMN IF NOT EXISTS platform TEXT;

CREATE TABLE IF NOT EXISTS platform_sign_up_count (
    platform TEXT NOT NULL,
    person_id_mod_64 SMALLINT NOT NULL,
    day DATE NOT NULL,
    count INT NOT NULL,

    PRIMARY KEY (platform, person_id_mod_64, day)
);
