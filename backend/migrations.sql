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
        SELECT 1
        FROM pg_class idx
        JOIN pg_am am ON am.oid = idx.relam
        WHERE idx.relname = 'idx__person__personality'
        AND am.amname <> 'hnsw'
    ) THEN
        DROP INDEX idx__person__personality;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS
    idx__person__personality
    ON person
    USING hnsw (personality vector_ip_ops);
