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


ALTER TABLE photo
    DROP COLUMN IF EXISTS nsfw_score;

DO $$
BEGIN
    IF to_regclass('notification_due') IS NOT NULL THEN
        RETURN;
    END IF;

    CREATE TYPE notification_kind AS ENUM ('intro', 'chat', 'visitor');

    CREATE TABLE notification_due (
        person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
        kind notification_kind NOT NULL,
        event_at TIMESTAMP NOT NULL,
        due_at TIMESTAMP NOT NULL,

        PRIMARY KEY (person_id, kind)
    );

    CREATE INDEX idx__notification_due__kind__due_at
        ON notification_due(kind, due_at);
END $$;
