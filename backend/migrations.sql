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

INSERT INTO sort_by (name) VALUES ('Distance') ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS spotify_oauth_state (
    state TEXT PRIMARY KEY,
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE TABLE IF NOT EXISTS person_spotify (
    person_id INT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    refresh_token TEXT NOT NULL,
    attempted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    artists_synced_at TIMESTAMP,
    top_artists JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx__person_spotify__attempted_at
    ON person_spotify(attempted_at);
