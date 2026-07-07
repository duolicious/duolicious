Q_DEACTIVATE = """
WITH to_deactivate AS (
    SELECT
        id,
        uuid::TEXT AS uuid,
        email
    FROM
        person
    WHERE
        last_online_time < NOW() - INTERVAL '30 days'
    AND
        last_online_time > NOW() - INTERVAL '50 days'
    AND
        activated
    AND
        sign_in_time < NOW() - INTERVAL '10 minutes'
), updated_person AS (
    UPDATE
        person
    SET
        activated = FALSE
    FROM
        to_deactivate
    WHERE
        to_deactivate.id = person.id
    AND
        NOT %(dry_run)s
    RETURNING
        person.id
), decrement_club AS (
    UPDATE
        club
    SET
        count_members = GREATEST(0, count_members - 1)
    FROM
        person_club
    WHERE
        person_club.club_name = club.name
    AND
        person_club.person_id IN (SELECT id FROM updated_person)
), deleted_duo_session AS (
    DELETE FROM
        duo_session
    USING
        updated_person
    WHERE
        duo_session.person_id = updated_person.id
    RETURNING
        duo_session.person_id,
        duo_session.session_token_hash
), deleted_session_hashes AS (
    SELECT
        person_id,
        array_agg(session_token_hash) AS hashes
    FROM
        deleted_duo_session
    GROUP BY
        person_id
), push_token_summary AS (
    -- Read push tokens from the live `duo_session` rows rather than the
    -- just-deleted ones so they're available on a dry run too (when nothing is
    -- deleted), mirroring how `email` is always sourced from `to_deactivate`.
    -- A data-modifying CTE's deletes aren't visible to sibling CTEs, so a real
    -- run still reads the pre-deletion rows here.
    SELECT
        duo_session.person_id,
        array_agg(DISTINCT duo_session.push_token)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS push_tokens
    FROM
        duo_session
    JOIN
        to_deactivate
    ON
        to_deactivate.id = duo_session.person_id
    GROUP BY
        duo_session.person_id
)
-- Each person row carries only its own just-deleted session token hashes so the
-- caller can evict those cached sessions. The LEFT JOIN yields an empty array
-- for persons with no deleted sessions, including every row on a dry run (when
-- `updated_person`, and thus the cascade, is empty).
SELECT
    to_deactivate.id,
    to_deactivate.uuid,
    to_deactivate.email,
    COALESCE(deleted_session_hashes.hashes, ARRAY[]::TEXT[])
        AS session_token_hashes,
    COALESCE(push_token_summary.push_tokens, ARRAY[]::TEXT[])
        AS push_tokens
FROM
    to_deactivate
LEFT JOIN
    deleted_session_hashes
ON
    deleted_session_hashes.person_id = to_deactivate.id
LEFT JOIN
    push_token_summary
ON
    push_token_summary.person_id = to_deactivate.id
"""
