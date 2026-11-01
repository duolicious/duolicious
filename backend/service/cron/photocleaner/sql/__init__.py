Q_UNUSED_PHOTOS = """
SELECT
    undeleted_photo.uuid,
    banned_photo_hash.hash AS unembedded_banned_hash
FROM
    undeleted_photo
LEFT JOIN
    banned_photo_hash
ON
    banned_photo_hash.photo_uuid = undeleted_photo.uuid
AND
    banned_photo_hash.embedding IS NULL
"""

Q_SET_BANNED_PHOTO_EMBEDDING = """
UPDATE
    banned_photo_hash
SET
    embedding = %(embedding)s,
    photo_uuid = NULL
WHERE
    hash = %(hash)s
"""
