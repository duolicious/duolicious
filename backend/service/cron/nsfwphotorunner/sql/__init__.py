Q_50_UNSCORED_V2_PHOTOS = """
SELECT
    uuid
FROM
    photo
WHERE
    nsfw_score_v2 IS NULL
LIMIT
    50
"""

Q_SET_NSFW_SCORE_V2 = """
UPDATE
    photo
SET
    nsfw_score_v2 = %(nsfw_score_v2)s
WHERE
    uuid = %(uuid)s
"""
