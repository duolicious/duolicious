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

-- Can run in a transaction block since Postgres 12, though later statements
-- in the same transaction can't use the new value.
ALTER TYPE person_event ADD VALUE IF NOT EXISTS 'answered-question' AFTER 'joined-club';

-- Blocks writes to `answer` while it builds (~75 s against a copy of the
-- production DB). To avoid that, build it with CONCURRENTLY by hand before
-- deploying and this becomes a no-op. That is:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx__answer__question_id_public_answer
--    ON answer(question_id, public_, answer, person_id);
CREATE INDEX IF NOT EXISTS idx__answer__question_id_public_answer
    ON answer(question_id, public_, answer, person_id);

-- A strict prefix of idx__answer__question_id_public_answer, so it only adds
-- write amplification on a hot table now
DROP INDEX IF EXISTS idx__answer__question_id;

ALTER TABLE mam_message
    ADD COLUMN IF NOT EXISTS question_id SMALLINT;

-- A browser Web Push subscription (endpoint + p256dh/auth keys) as returned by
-- `PushSubscription.toJSON()`. Only web sessions ever set this; mobile sessions
-- use `push_token` instead. NULL means the session can't receive a web push.
ALTER TABLE duo_session
    ADD COLUMN IF NOT EXISTS web_push_subscription JSONB;

-- The "Last online:" search filter (replaces automatic deactivation). The
-- lookup table maps each option to the window, in seconds, a prospect's
-- last_online_time must fall within; 'All time' is a ~100-year sentinel so the
-- search's interval arithmetic needs no NULL/OR special case. The two windows
-- the application also reads are substituted from `constants` (see
-- `service.api.bootstrap`) rather than spelled twice.
CREATE TABLE IF NOT EXISTS last_online (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    seconds BIGINT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS search_preference_last_online (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    last_online_id SMALLINT REFERENCES last_online(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id)
);

INSERT INTO last_online (name, seconds) VALUES ('Now',    {{LAST_ONLINE_NOW_SECONDS}}) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('A day ago',              86400) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('A week ago',            604800) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('A month ago', {{LAST_ONLINE_DEFAULT_SECONDS}}) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('All time',          3153600000) ON CONFLICT (name) DO NOTHING;

-- Backfill the default preference for persons who predate this filter. New
-- persons get it at signup; a person's row is created once here and thereafter
-- only changes when they pick a different window.
INSERT INTO search_preference_last_online (person_id, last_online_id)
SELECT person.id, last_online.id
FROM person, last_online
WHERE last_online.name = 'A month ago'
ON CONFLICT (person_id) DO NOTHING;

-- Blocks writes to `person` while it builds, and `person` takes a write on every
-- refresh of a signed-in user's `last_online_time`. To avoid that, build it with
-- CONCURRENTLY by hand before deploying and this becomes a no-op. That is:
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx__person__personality
--     ON person USING ivfflat (personality vector_ip_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS
    idx__person__personality
    ON person
    USING ivfflat (personality vector_ip_ops)
    WITH (lists = 100);
