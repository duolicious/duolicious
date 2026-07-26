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

CREATE TABLE IF NOT EXISTS search_preference_two_way_filters (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (person_id)
);

ALTER TABLE search_preference_two_way_filters
    ADD COLUMN IF NOT EXISTS gender                BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS age                   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS furthest_distance     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS orientation           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS relationship_status   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS looking_for           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS wants_kids            BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_kids              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS has_a_profile_picture BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS drugs                 BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS long_distance         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ethnicity             BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS smoking               BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS religion              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS drinking              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS height                BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS exercise              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS star_sign             BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
    batch_size CONSTANT INT := 10000;
    inserted INT;
BEGIN
    LOOP
        INSERT INTO search_preference_two_way_filters (person_id)
        SELECT id
        FROM person
        WHERE NOT EXISTS (
            SELECT 1
            FROM search_preference_two_way_filters
            WHERE person_id = person.id
        )
        LIMIT batch_size
        ON CONFLICT (person_id) DO NOTHING;

        GET DIAGNOSTICS inserted = ROW_COUNT;

        EXIT WHEN inserted = 0;
    END LOOP;
END $$;

-- Everyone's visitor clock starts at the moment the column is added, so the
-- visits already in the table aren't all treated as unannounced. The default
-- then reverts to zero, so a person created later is notified about their
-- first visitor.
ALTER TABLE person
    ADD COLUMN IF NOT EXISTS visitors_notification SMALLINT
        REFERENCES immediacy(id) NOT NULL DEFAULT 4,
    ADD COLUMN IF NOT EXISTS visitor_seconds INT NOT NULL
        DEFAULT EXTRACT(EPOCH FROM NOW())::int;

ALTER TABLE person ALTER COLUMN visitor_seconds SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx__visited__updated_at__object__subject
    ON visited(updated_at DESC, object_person_id, subject_person_id)
    WHERE NOT invisible;
