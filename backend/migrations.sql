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
