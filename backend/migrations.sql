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

CREATE TABLE IF NOT EXISTS experiment_exposure (
    web_visitor_id UUID NOT NULL,
    experiment TEXT NOT NULL,
    variant TEXT NOT NULL,
    ip_address inet,
    exposed_at TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY (web_visitor_id, experiment)
);

CREATE TABLE IF NOT EXISTS web_visitor_sign_up (
    web_visitor_id UUID PRIMARY KEY,
    signed_up_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One row each time someone goes from no gold to gold. Keeps only what
-- paywall experiments need: nothing here identifies the person.
CREATE TABLE IF NOT EXISTS gold_sign_up (
    provider gold_subscription_provider NOT NULL,
    -- person.id % 6, the arm armOf picks in point-of-sale-arms.tsx
    paywall_arm SMALLINT NOT NULL,
    signed_up_at TIMESTAMP NOT NULL DEFAULT NOW()
);
