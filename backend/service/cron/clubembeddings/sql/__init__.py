from serviceshared.constants import MIN_CLUB_OVERLAP_SEARCH_SHARED

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

Q_STAMP_CLUB_EMBEDDING_REFRESH = """
UPDATE
    club_embedding_refresh
SET
    completed_at = NOW()
WHERE
    id = 1
"""

Q_CLUB_OVERLAP_SEARCH_DELETE = """
DELETE FROM club_overlap_search
"""

Q_CLUB_OVERLAP_SEARCH_REBUILD = f"""
INSERT INTO club_overlap_search (club_a, club_b, weight)
WITH counts AS (
    SELECT
        club_name,
        count(*) AS n
    FROM
        person_club
    GROUP BY
        club_name
)
SELECT
    a.club_name,
    b.club_name,
    power(count(*)::FLOAT8 / MAX(counts.n), 2)::REAL
FROM
    person_club a
JOIN
    person_club b
ON
    b.person_id = a.person_id
AND
    b.club_name <> a.club_name
JOIN
    counts
ON
    counts.club_name = b.club_name
GROUP BY
    a.club_name,
    b.club_name
HAVING
    count(*) >= {MIN_CLUB_OVERLAP_SEARCH_SHARED}
"""
