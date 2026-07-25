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

-- The `photocrop` backfill has finished and been removed, taking its queue
-- index and bookkeeping column with it. The index shipped under two names over
-- its life, so both are dropped; `photo.width` and friends stay, because the
-- upload path fills them for every new photo.

ALTER TABLE person
ADD COLUMN IF NOT EXISTS show_my_online_status BOOLEAN NOT NULL DEFAULT TRUE;
