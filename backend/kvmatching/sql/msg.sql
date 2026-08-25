CREATE SCHEMA IF NOT EXISTS scratch_kv;

DROP TABLE IF EXISTS scratch_kv.jid;
CREATE UNLOGGED TABLE scratch_kv.jid AS
SELECT uuid::text AS jid, id AS pid FROM person
UNION ALL
SELECT id::text AS jid, id AS pid FROM person;
CREATE UNIQUE INDEX ON scratch_kv.jid (jid);
ANALYZE scratch_kv.jid;

DROP TABLE IF EXISTS scratch_kv.msg;
CREATE UNLOGGED TABLE scratch_kv.msg AS
SELECT DISTINCT ON (s, r, mid)
    s, r, mid,
    to_timestamp((mid >> 8) / 1e6)::timestamp AS ts
FROM (
    SELECT
        m.person_id AS s,
        j.pid AS r,
        m.id AS mid
    FROM mam_message m
    JOIN scratch_kv.jid j ON j.jid = m.remote_bare_jid
    WHERE m.direction = 'O'
    UNION ALL
    SELECT
        j.pid AS s,
        m.person_id AS r,
        m.id AS mid
    FROM mam_message m
    JOIN scratch_kv.jid j ON j.jid = m.remote_bare_jid
    WHERE m.direction = 'I'
) t
ORDER BY s, r, mid;
CREATE INDEX ON scratch_kv.msg (s, r);
ANALYZE scratch_kv.msg
