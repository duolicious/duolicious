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


DROP TABLE IF EXISTS search_cache;

ALTER TABLE photo ADD COLUMN IF NOT EXISTS nsfw_score_v2 FLOAT4;

CREATE INDEX IF NOT EXISTS idx__photo__nsfw_score_v2
    ON photo(nsfw_score_v2);

ALTER TABLE banned_photo_hash
    ADD COLUMN IF NOT EXISTS photo_uuid TEXT,
    ADD COLUMN IF NOT EXISTS embedding VECTOR(768);
