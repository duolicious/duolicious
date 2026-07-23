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
DROP INDEX IF EXISTS idx__photo__crop_backlog;
DROP INDEX IF EXISTS idx__photo__crop_backlog__person_id;

ALTER TABLE photo
    DROP COLUMN IF EXISTS crop_attempted_at;

-- Keep the country alongside the other denormalized location labels so feed
-- and visitor queries can enforce country-only visibility without joining the
-- full location catalogue for every candidate.
ALTER TABLE person
    ADD COLUMN IF NOT EXISTS location_country TEXT;

UPDATE person AS p
SET location_country = location.country
FROM location
WHERE
    p.location_country IS NULL
AND
    p.location_long_friendly = location.long_friendly;

ALTER TABLE person
    ALTER COLUMN location_country SET NOT NULL;

-- `show_my_location` remains the legacy visible/hidden flag. This additional
-- flag narrows visible locations to their country while preserving old-client
-- Yes/No semantics.
ALTER TABLE person
    ADD COLUMN IF NOT EXISTS show_my_country_only BOOLEAN NOT NULL DEFAULT FALSE;
