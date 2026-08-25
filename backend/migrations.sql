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


DROP TABLE IF EXISTS club_overlap;

ALTER TABLE person
    ADD COLUMN IF NOT EXISTS kv_vector HALFVEC(132) NOT NULL DEFAULT array_full(132, 0);

ALTER TABLE search_cache
    ADD COLUMN IF NOT EXISTS kv_distance REAL NOT NULL DEFAULT 0;

INSERT INTO sort_by (name) VALUES ('Longer conversations') ON CONFLICT (name) DO NOTHING;
