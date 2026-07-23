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

-- Store the location-visibility choices in the same lookup-backed form as the
-- other profile settings.
CREATE TABLE IF NOT EXISTS yes_country_only_no (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

SELECT setval('yes_country_only_no_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM yes_country_only_no), FALSE);
INSERT INTO yes_country_only_no (name) VALUES ('Yes') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_country_only_no (name) VALUES ('Country only') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_country_only_no (name) VALUES ('No') ON CONFLICT (name) DO NOTHING;

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

ALTER TABLE person
    ADD COLUMN IF NOT EXISTS show_my_location_id SMALLINT REFERENCES yes_country_only_no(id);

-- Preserve both the production boolean representation and the short-lived
-- two-boolean representation from development versions of this migration.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        AND table_name = 'person'
        AND column_name = 'show_my_location'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        AND table_name = 'person'
        AND column_name = 'show_my_country_only'
    ) THEN
        UPDATE person
        SET show_my_location_id = yes_country_only_no.id
        FROM yes_country_only_no
        WHERE person.show_my_location_id IS NULL
        AND yes_country_only_no.name = CASE
            WHEN person.show_my_country_only THEN 'Country only'
            WHEN person.show_my_location THEN 'Yes'
            ELSE 'No'
        END;
    ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
        AND table_name = 'person'
        AND column_name = 'show_my_location'
    ) THEN
        UPDATE person
        SET show_my_location_id = yes_country_only_no.id
        FROM yes_country_only_no
        WHERE person.show_my_location_id IS NULL
        AND yes_country_only_no.name = CASE
            WHEN person.show_my_location THEN 'Yes'
            ELSE 'No'
        END;
    END IF;
END
$$;

UPDATE person
SET show_my_location_id = yes_country_only_no.id
FROM yes_country_only_no
WHERE person.show_my_location_id IS NULL
AND yes_country_only_no.name = 'Yes';

ALTER TABLE person
    ALTER COLUMN show_my_location_id SET DEFAULT 1,
    ALTER COLUMN show_my_location_id SET NOT NULL,
    DROP COLUMN IF EXISTS show_my_country_only,
    DROP COLUMN IF EXISTS show_my_location;
