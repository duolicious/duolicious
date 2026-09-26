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
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'person'::regclass
        AND attname = 'looking_for_id'
        AND NOT attisdropped
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE person
        ADD COLUMN looking_for_ids SMALLINT[] NOT NULL DEFAULT '{1}';

    UPDATE person
    SET looking_for_ids = ARRAY[looking_for_id]
    WHERE looking_for_id <> 1;

    ALTER TABLE person DROP COLUMN looking_for_id;
END $$;
