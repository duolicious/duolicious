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

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'person'::regclass
        AND attname = 'automod_verification_level_id'
        AND NOT attisdropped
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE person
        ADD COLUMN automod_verification_level_id SMALLINT NOT NULL DEFAULT 1,
        ADD CONSTRAINT person_automod_verification_level_id_fkey
            FOREIGN KEY (automod_verification_level_id)
            REFERENCES verification_level(id) NOT VALID;
END $$;
