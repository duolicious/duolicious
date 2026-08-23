from serviceshared.commonsql import CLUB_VECTOR_ASSIGNMENT

Q_UPDATE_CLUB_EMBEDDINGS = """
UPDATE
    club
SET
    embedding = t.embedding::VECTOR(64)
FROM
    unnest(
        %(names)s::TEXT[],
        %(embeddings)s::TEXT[]
    ) AS t(name, embedding)
WHERE
    club.name = t.name
"""

Q_QUEUE_MEMBER_CLUB_VECTOR_REFRESHES = """
INSERT INTO club_vector_refresh_queue (
    person_id
)
SELECT DISTINCT
    person_id
FROM
    person_club
WHERE
    club_name = ANY(%(names)s::TEXT[])
ON CONFLICT (person_id) DO UPDATE SET
    person_id = EXCLUDED.person_id
"""

Q_REFRESH_QUEUED_CLUB_VECTORS = f"""
WITH consumed AS (
    DELETE FROM
        club_vector_refresh_queue
    WHERE
        person_id IN (
            SELECT
                person_id
            FROM
                club_vector_refresh_queue
            ORDER BY
                person_id
            LIMIT
                %(batch_size)s
            FOR UPDATE SKIP LOCKED
        )
    RETURNING
        person_id
)
UPDATE
    person
SET
{CLUB_VECTOR_ASSIGNMENT}
FROM
    consumed
WHERE
    person.id = consumed.person_id
"""
