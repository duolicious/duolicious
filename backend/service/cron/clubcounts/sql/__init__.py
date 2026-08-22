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
), updated AS (
    UPDATE
        club
    SET
        count_members = count_members + agg.total
    FROM
        agg
    WHERE
        club.name = agg.club_name
    RETURNING
        club.name
), marked AS (
    INSERT INTO club_stats_dirty (
        club_name
    )
    SELECT
        name
    FROM
        updated
    ON CONFLICT (club_name) DO NOTHING
)
SELECT
    COUNT(*) AS folded
FROM
    updated
"""
