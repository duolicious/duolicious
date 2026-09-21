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

ALTER TABLE onboardee ADD COLUMN IF NOT EXISTS ref TEXT;

CREATE TABLE IF NOT EXISTS person_ref (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    ref TEXT NOT NULL,

    PRIMARY KEY (person_id)
);
