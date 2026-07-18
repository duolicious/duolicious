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

INSERT INTO last_online (name, seconds) VALUES ('Now', {{LAST_ONLINE_NOW_SECONDS}}) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('A day ago', 86400) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('A week ago', 604800) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('{{LAST_ONLINE_DEFAULT_NAME}}', {{LAST_ONLINE_DEFAULT_SECONDS}}) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('All time', 3153600000) ON CONFLICT (name) DO NOTHING;

INSERT INTO search_preference_last_online (person_id, last_online_id)
SELECT person.id, last_online.id
FROM person, last_online
WHERE last_online.name = '{{LAST_ONLINE_DEFAULT_NAME}}'
ON CONFLICT (person_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS
    idx__person__personality
    ON person
    USING ivfflat (personality vector_ip_ops)
    WITH (lists = 100);

-- How the square renditions were cut out of `original-{uuid}.jpg`, in that
-- image's (post-EXIF-rotation) coordinates. Lets clients expand a cropped
-- preview into the uncropped original. NULL until `service/cron/photocrop`
-- backfills photos uploaded before these columns existed; `crop_attempted_at`
-- records that it tried, so photos it can't recover don't get retried forever.
ALTER TABLE photo
    ADD COLUMN IF NOT EXISTS width INT,
    ADD COLUMN IF NOT EXISTS height INT,
    ADD COLUMN IF NOT EXISTS crop_top INT,
    ADD COLUMN IF NOT EXISTS crop_left INT,
    ADD COLUMN IF NOT EXISTS crop_attempted_at TIMESTAMP;

-- The photocrop backfill's queue: tiny, and empties as the backlog drains.
CREATE INDEX IF NOT EXISTS idx__photo__crop_backlog
    ON photo(uuid)
    WHERE width IS NULL AND crop_attempted_at IS NULL;

-- The geometry JSON is now shaped in the application (`commonsql.PHOTO_GEOMETRY`)
-- rather than by a database function; drop the function this migration used to
-- create so already-migrated databases shed it too.
DROP FUNCTION IF EXISTS photo_geometry(photo);
