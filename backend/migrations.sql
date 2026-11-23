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

-- One row per subscription, written when it is first granted and kept after
-- its gold_subscription row is revoked or expires. Lets experiments count
-- sign-ups rather than subscriptions that happen to be live right now.
CREATE TABLE IF NOT EXISTS gold_subscription_start (
    provider gold_subscription_provider NOT NULL,
    provider_subscription_id TEXT NOT NULL,
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx__gold_subscription_start__person_id
    ON gold_subscription_start(person_id);

-- Backfill the subscriptions that are still live. Expired and revoked ones
-- were already deleted, so they can't be recovered. started_at is the
-- migration time for these rows, not when they really started.
INSERT INTO gold_subscription_start (
    provider,
    provider_subscription_id,
    person_id
)
SELECT
    provider,
    provider_subscription_id,
    person_id
FROM
    gold_subscription
ON CONFLICT DO NOTHING;
