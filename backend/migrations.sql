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

CREATE INDEX IF NOT EXISTS idx__search_preference_age__person_id__bounds
    ON search_preference_age(person_id) INCLUDE (min_age, max_age);

CREATE INDEX IF NOT EXISTS idx__search_preference_distance__person_id__distance
    ON search_preference_distance(person_id) INCLUDE (distance);

CREATE INDEX IF NOT EXISTS idx__search_preference_height_cm__person_id__bounds
    ON search_preference_height_cm(person_id) INCLUDE (min_height_cm, max_height_cm);

ALTER TABLE person
    ADD COLUMN IF NOT EXISTS visitor_pending_seconds BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx__person__visitor_pending_seconds
    ON person(visitor_pending_seconds)
    WHERE visitor_pending_seconds > 0;

CREATE OR REPLACE FUNCTION immediacy_drift_seconds(immediacy_name TEXT)
  RETURNS BIGINT
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN immediacy_name = 'Immediately'  THEN 0
        WHEN immediacy_name = 'Daily'        THEN 86400
        WHEN immediacy_name = 'Every 3 days' THEN 259200
        WHEN immediacy_name = 'Weekly'       THEN 604800
        WHEN immediacy_name = 'Never'        THEN -1
        ELSE                                      604800
    END
$$;

CREATE OR REPLACE FUNCTION
    stamp_visitor_pending()
RETURNS TRIGGER AS $$
DECLARE
    visit_seconds BIGINT := EXTRACT(EPOCH FROM NEW.updated_at)::bigint;
    drift_seconds BIGINT;
    notified_seconds BIGINT;
BEGIN
    IF NEW.invisible THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT
            1
        FROM
            person AS visitor
        WHERE
            visitor.id = NEW.subject_person_id
        AND
            visitor.activated
        AND
            visitor.shadow_banned_at IS NULL
    ) THEN
        RETURN NEW;
    END IF;

    SELECT
        immediacy_drift_seconds(immediacy.name),
        COALESCE(person.visitor_seconds, 0)
    INTO
        drift_seconds,
        notified_seconds
    FROM
        person
    LEFT JOIN
        immediacy
    ON
        immediacy.id = person.visitors_notification
    WHERE
        person.id = NEW.object_person_id;

    IF drift_seconds < 0 OR visit_seconds <= notified_seconds + drift_seconds
    THEN
        RETURN NEW;
    END IF;

    UPDATE
        person
    SET
        visitor_pending_seconds = GREATEST(
            visitor_pending_seconds, visit_seconds)
    WHERE
        id = NEW.object_person_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER
    trigger_stamp_visitor_pending
AFTER INSERT OR UPDATE ON
    visited
FOR EACH ROW EXECUTE FUNCTION
    stamp_visitor_pending();

DROP INDEX IF EXISTS idx__visited__updated_at__object__subject;
