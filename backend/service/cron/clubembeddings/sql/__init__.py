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

Q_NULL_CLUB_EMBEDDINGS = """
UPDATE
    club
SET
    embedding = NULL
WHERE
    name = ANY(%(names)s::TEXT[])
AND
    embedding IS NOT NULL
"""

Q_STAMP_CLUB_EMBEDDING_REFRESH = """
UPDATE
    club_embedding_refresh
SET
    completed_at = NOW()
WHERE
    id = 1
"""
