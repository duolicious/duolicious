# One statement, one snapshot: deltas committed after it starts aren't
# visible to the DELETE and survive for the next fold.
Q_FOLD_CLUB_COUNT_DELTAS = """
WITH consumed AS (
    DELETE FROM club_count_delta
    RETURNING club_name, delta
), agg AS (
    SELECT
        club_name,
        SUM(delta) AS total
    FROM consumed
    GROUP BY club_name
)
UPDATE
    club
SET
    count_members = count_members + agg.total
FROM
    agg
WHERE
    club.name = agg.club_name
"""
