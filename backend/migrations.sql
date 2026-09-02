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

ALTER TABLE search_cache
    DROP COLUMN IF EXISTS club_distance;

ALTER TABLE person
    DROP COLUMN IF EXISTS last_nag_time;

CREATE TABLE IF NOT EXISTS body_type (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

INSERT INTO body_type (name) VALUES
    ('Unanswered'),
    ('Thin'),
    ('Average'),
    ('Athletic'),
    ('Chubby'),
    ('Big')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE person
    ADD COLUMN IF NOT EXISTS body_type_id SMALLINT
    REFERENCES body_type(id) NOT NULL DEFAULT 1;

ALTER TABLE search_preference
    ADD COLUMN IF NOT EXISTS body_type_ids SMALLINT[];

UPDATE search_preference
SET body_type_ids = ARRAY(SELECT id FROM body_type ORDER BY id)
WHERE body_type_ids IS NULL;

ALTER TABLE search_preference
    ALTER COLUMN body_type_ids SET NOT NULL;

ALTER TABLE search_preference
    ADD COLUMN IF NOT EXISTS two_way_body_type BOOLEAN NOT NULL DEFAULT FALSE;
