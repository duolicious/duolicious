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


CREATE OR REPLACE FUNCTION
    maintain_club_count_members()
RETURNS TRIGGER AS $$
DECLARE
    name_ TEXT := COALESCE(NEW.club_name, OLD.club_name);
    delta_ SMALLINT;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.activated THEN
        delta_ := 1;
    ELSIF TG_OP = 'UPDATE' AND NEW.activated AND NOT OLD.activated THEN
        delta_ := 1;
    ELSIF TG_OP = 'UPDATE' AND OLD.activated AND NOT NEW.activated THEN
        delta_ := -1;
    ELSIF TG_OP = 'DELETE' AND OLD.activated THEN
        delta_ := -1;
    ELSE
        RETURN COALESCE(NEW, OLD);
    END IF;

    INSERT INTO club_count_delta (club_name, delta)
    SELECT name_, delta_
    WHERE EXISTS (SELECT 1 FROM club WHERE name = name_);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER
    trigger_maintain_club_count_members
AFTER INSERT OR DELETE OR UPDATE OF activated ON
    person_club
FOR EACH ROW EXECUTE FUNCTION
    maintain_club_count_members();

-- Repair the drift in the counts. Idempotent because a synced count
-- doesn't match the WHERE clause. No init-api.sql counterpart: this fixes
-- data, not schema.
WITH cleared AS (
    DELETE FROM club_count_delta
)
UPDATE club
SET count_members = actual.cnt
FROM (
    SELECT
        club.name,
        COALESCE(pc.cnt, 0) AS cnt
    FROM club
    LEFT JOIN (
        SELECT club_name, count(*) AS cnt
        FROM person_club
        WHERE activated
        GROUP BY club_name
    ) pc ON pc.club_name = club.name
) actual
WHERE club.name = actual.name
AND club.count_members IS DISTINCT FROM actual.cnt;

CREATE TABLE IF NOT EXISTS sort_by (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

SELECT setval('sort_by_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM sort_by), FALSE);
INSERT INTO sort_by (name) VALUES ('Match percentage') ON CONFLICT (name) DO NOTHING;
INSERT INTO sort_by (name) VALUES ('Similar clubs') ON CONFLICT (name) DO NOTHING;

ALTER TABLE club
    ADD COLUMN IF NOT EXISTS embedding VECTOR(64) NOT NULL
    DEFAULT array_full(64, 0);

CREATE TABLE IF NOT EXISTS club_embedding_refresh (
    id SMALLINT PRIMARY KEY,

    completed_at TIMESTAMP NOT NULL DEFAULT to_timestamp(0),

    CONSTRAINT id CHECK (id = 1)
);

INSERT INTO club_embedding_refresh (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE person
    ADD COLUMN IF NOT EXISTS club_vector VECTOR(64) NOT NULL
    DEFAULT array_full(64, 0);
ALTER TABLE person
    ADD COLUMN IF NOT EXISTS club_vector_computed_at TIMESTAMP NOT NULL
    DEFAULT to_timestamp(0);

ALTER TABLE search_preference
    ADD COLUMN IF NOT EXISTS sort_by_id SMALLINT NOT NULL DEFAULT 1
    REFERENCES sort_by(id) ON DELETE CASCADE;

ALTER TABLE search_cache
    ADD COLUMN IF NOT EXISTS club_distance REAL NOT NULL DEFAULT 0;
