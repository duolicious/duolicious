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

ALTER TABLE person DROP COLUMN IF EXISTS tiny_id;
ALTER TABLE person DROP COLUMN IF EXISTS club_vector_computed_at;

DROP TABLE IF EXISTS presence_histogram;

ALTER TABLE person ADD COLUMN IF NOT EXISTS marked_safe_at TIMESTAMP;

ALTER TABLE person ADD COLUMN IF NOT EXISTS pre_automod_verification_level_id SMALLINT;

ALTER TABLE inbox ADD COLUMN IF NOT EXISTS intro_score REAL;

ALTER TABLE duo_session ADD COLUMN IF NOT EXISTS web_visitor_id UUID;

CREATE TABLE IF NOT EXISTS experiment (
    name TEXT PRIMARY KEY,
    variants TEXT[] NOT NULL CHECK (cardinality(variants) >= 2),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP,
    winner TEXT CHECK (winner = ANY(variants))
);

CREATE TABLE IF NOT EXISTS web_visitor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ref TEXT,
    network inet,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS web_visitor_variant (
    web_visitor_id UUID NOT NULL REFERENCES web_visitor(id) ON DELETE CASCADE,
    experiment_name TEXT NOT NULL REFERENCES experiment(name) ON DELETE CASCADE,
    variant TEXT NOT NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY (web_visitor_id, experiment_name)
);

CREATE INDEX IF NOT EXISTS web_visitor_variant__experiment_name__idx
    ON web_visitor_variant (experiment_name);

CREATE TABLE IF NOT EXISTS web_visitor_sign_up (
    web_visitor_id UUID PRIMARY KEY REFERENCES web_visitor(id) ON DELETE CASCADE,
    signed_up_at TIMESTAMP NOT NULL DEFAULT NOW()
);
