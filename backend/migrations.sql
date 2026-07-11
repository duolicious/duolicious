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
