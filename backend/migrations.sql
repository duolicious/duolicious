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


DROP TABLE IF EXISTS club_overlap;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'person'::regclass
        AND attname = 'count_intros_sent'
        AND NOT attisdropped
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE person
        ADD COLUMN count_intros_received INT NOT NULL DEFAULT 0,
        ADD COLUMN count_intros_received_with_reply INT NOT NULL DEFAULT 0,
        ADD COLUMN count_intros_sent INT NOT NULL DEFAULT 0,
        ADD COLUMN count_intros_sent_with_reply INT NOT NULL DEFAULT 0;

    WITH m AS (
        SELECT
            subject_person_id AS s,
            object_person_id AS o,
            EXISTS (
                SELECT 1 FROM messaged r
                WHERE r.subject_person_id = m0.object_person_id
                AND r.object_person_id = m0.subject_person_id
                AND r.created_at < m0.created_at
            ) AS is_reply
        FROM messaged m0
    ), counts AS (
        SELECT
            pid,
            count(*) FILTER (WHERE NOT is_subject AND NOT is_reply)::INT
                AS received,
            count(*) FILTER (WHERE is_subject AND is_reply)::INT
                AS received_with_reply,
            count(*) FILTER (WHERE is_subject AND NOT is_reply)::INT
                AS sent,
            count(*) FILTER (WHERE NOT is_subject AND is_reply)::INT
                AS sent_with_reply
        FROM (
            SELECT s AS pid, TRUE AS is_subject, is_reply FROM m
            UNION ALL
            SELECT o AS pid, FALSE AS is_subject, is_reply FROM m
        ) AS side
        GROUP BY pid
    )
    UPDATE person SET
        count_intros_received = counts.received,
        count_intros_received_with_reply = counts.received_with_reply,
        count_intros_sent = counts.sent,
        count_intros_sent_with_reply = counts.sent_with_reply
    FROM counts
    WHERE person.id = counts.pid;
END $$;


DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'person'::regclass
        AND attname = 'count_messages_received'
        AND NOT attisdropped
    ) THEN
        RETURN;
    END IF;

    ALTER TABLE person
        ADD COLUMN count_messages_received INT NOT NULL DEFAULT 0;

    WITH counts AS (
        SELECT person_id, count(*)::INT AS n
        FROM mam_message
        WHERE direction = 'I'
        GROUP BY person_id
    )
    UPDATE person SET
        count_messages_received = counts.n
    FROM counts
    WHERE person.id = counts.person_id;
END $$;
