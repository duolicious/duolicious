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


DROP INDEX IF EXISTS idx__visited__updated_at__object__subject;

DROP INDEX IF EXISTS duo_idx__inbox__timestamp__luser__box;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'person'::regclass
        AND attname = 'required_verification_level_id'
        AND NOT attisdropped
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE person
        ADD COLUMN required_verification_level_id SMALLINT NOT NULL DEFAULT 1,
        ADD CONSTRAINT person_required_verification_level_id_fkey
            FOREIGN KEY (required_verification_level_id)
            REFERENCES verification_level(id) NOT VALID;

    CREATE OR REPLACE FUNCTION
        sync_verification_required()
    RETURNS TRIGGER AS $fn$
    BEGIN
        IF TG_OP = 'INSERT'
        OR NEW.required_verification_level_id
            IS NOT DISTINCT FROM OLD.required_verification_level_id
        THEN
            NEW.required_verification_level_id := CASE
                WHEN NEW.verification_required
                THEN GREATEST(NEW.required_verification_level_id, 2)
                WHEN TG_OP = 'INSERT'
                THEN NEW.required_verification_level_id
                ELSE 1
            END;
        END IF;

        NEW.verification_required := NEW.required_verification_level_id > 1;

        RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE TRIGGER
        trigger_sync_verification_required
    BEFORE INSERT OR UPDATE OF verification_required, required_verification_level_id ON
        person
    FOR EACH ROW
    EXECUTE FUNCTION
        sync_verification_required();
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'photo'::regclass
        AND attname = 'clip_embedding'
        AND NOT attisdropped
    ) THEN
        ALTER TABLE photo ADD COLUMN clip_embedding VECTOR(768);
    END IF;
END $$;
