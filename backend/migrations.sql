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


DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'person'::regclass
        AND attname = 'looking_for_ids'
        AND NOT attisdropped
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE person
        ADD COLUMN IF NOT EXISTS looking_for_ids SMALLINT[] NOT NULL DEFAULT '{1}';

    CREATE OR REPLACE FUNCTION
        sync_looking_for()
    RETURNS TRIGGER AS $fn$
    BEGIN
        IF NEW.looking_for_ids IS DISTINCT FROM OLD.looking_for_ids THEN
            NEW.looking_for_id := NEW.looking_for_ids[1];
        ELSIF NEW.looking_for_id IS DISTINCT FROM OLD.looking_for_id THEN
            NEW.looking_for_ids := ARRAY[NEW.looking_for_id];
        END IF;

        RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE TRIGGER
        trigger_sync_looking_for
    BEFORE UPDATE OF looking_for_id, looking_for_ids ON
        person
    FOR EACH ROW
    EXECUTE FUNCTION
        sync_looking_for();
END $$;

DO $$
BEGIN
    INSERT INTO looking_for (id, name) VALUES (6, 'Something casual')
    ON CONFLICT DO NOTHING;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE search_preference
    SET looking_for_ids = looking_for_ids || 6::SMALLINT
    WHERE looking_for_ids @> '{1,2,3,4,5}';
END $$;

CREATE TABLE IF NOT EXISTS video_job (
    uuid TEXT PRIMARY KEY,
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    position SMALLINT NOT NULL,
    byte_size INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'queued', 'running', 'success', 'failure')),
    message TEXT NOT NULL DEFAULT '',
    attempts SMALLINT NOT NULL DEFAULT 0,
    photo_uuid TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx__video_job__person_id__busy
    ON video_job(person_id)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx__video_job__person_id__created_at
    ON video_job(person_id, created_at);

CREATE INDEX IF NOT EXISTS idx__video_job__created_at__queued
    ON video_job(created_at)
    WHERE status = 'queued';
