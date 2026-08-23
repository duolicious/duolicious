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


CREATE TABLE IF NOT EXISTS club_vector_refresh_queue (
    person_id INT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS
    idx__person_club__club_name__person_id
    ON person_club (club_name, person_id);

DROP INDEX IF EXISTS idx__person_club__activated__club_name__person_id;

DROP TABLE IF EXISTS club_embedding_refresh;
