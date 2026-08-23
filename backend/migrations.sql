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


CREATE SEQUENCE IF NOT EXISTS club_id_seq;

ALTER TABLE club ADD COLUMN IF NOT EXISTS id INT;

-- Deterministic ids for pre-existing clubs; new clubs take the sequence.
UPDATE club
SET id = numbered.numbered_id
FROM (
    SELECT name, ROW_NUMBER() OVER (ORDER BY name) AS numbered_id
    FROM club
) AS numbered
WHERE club.id IS NULL AND club.name = numbered.name;

SELECT setval('club_id_seq', COALESCE((SELECT MAX(id) FROM club), 0) + 1, false);

ALTER TABLE club ALTER COLUMN id SET DEFAULT nextval('club_id_seq');
ALTER TABLE club ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS club_id_idx ON club (id);

ALTER TABLE person
    ADD COLUMN IF NOT EXISTS club_sparse SPARSEVEC(1000000) NOT NULL
    DEFAULT '{}/1000000';

CREATE TABLE IF NOT EXISTS club_overlap_search (
    club_a TEXT NOT NULL,
    club_b TEXT NOT NULL,
    weight REAL NOT NULL,
    PRIMARY KEY (club_a, club_b)
);

CREATE INDEX IF NOT EXISTS club_overlap_search_a_weight_idx
    ON club_overlap_search (club_a, weight DESC);
