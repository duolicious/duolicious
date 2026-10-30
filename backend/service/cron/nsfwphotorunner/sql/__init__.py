Q_50_UNCHECKED_PHOTOS = """
SELECT
    uuid
FROM
    photo
WHERE
    nsfw_score IS NULL
LIMIT
    50
"""

Q_SET_NSFW_SCORE = """
UPDATE
    photo
SET
    nsfw_score = %(nsfw_score)s
WHERE
    uuid = %(uuid)s
"""

Q_50_UNSCORED_CLIP_PHOTOS = """
SELECT
    uuid
FROM
    photo
WHERE
    clip_nsfw_score IS NULL
LIMIT
    50
"""

Q_SET_CLIP_NSFW_SCORE = """
UPDATE
    photo
SET
    clip_nsfw_score = %(clip_nsfw_score)s
WHERE
    uuid = %(uuid)s
"""
