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

ALTER TABLE search_preference ADD COLUMN IF NOT EXISTS same_country_only BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE duo_session ADD COLUMN IF NOT EXISTS ref TEXT;

CREATE TABLE IF NOT EXISTS person_ref (
    person_id INT REFERENCES person(id) ON DELETE SET NULL ON UPDATE CASCADE,
    ref TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS person_ref__person_id__idx
    ON person_ref (person_id);

ALTER TABLE person_ref DROP CONSTRAINT IF EXISTS person_ref_pkey;

ALTER TABLE person_ref ALTER COLUMN person_id DROP NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'person_ref'::regclass
        AND conname = 'person_ref_person_id_fkey'
        AND confdeltype = 'c'
    ) THEN
        ALTER TABLE person_ref DROP CONSTRAINT person_ref_person_id_fkey;
        ALTER TABLE person_ref ADD CONSTRAINT person_ref_person_id_fkey
            FOREIGN KEY (person_id) REFERENCES person(id)
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
