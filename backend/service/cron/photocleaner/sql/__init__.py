Q_UNUSED_PHOTOS = """
SELECT
    uuid,
    moderated_by,
    moderated_by IS NOT NULL AND NOT EXISTS (
        SELECT
            1
        FROM
            moderated_photo_embedding
        WHERE
            moderated_photo_embedding.uuid = undeleted_photo.uuid
    ) AS needs_embedding
FROM
    undeleted_photo
"""

Q_INSERT_MODERATED_PHOTO_EMBEDDING = """
INSERT INTO moderated_photo_embedding (
    uuid,
    moderated_by,
    embedding
) VALUES (
    %(uuid)s,
    %(moderated_by)s,
    %(embedding)s
)
ON CONFLICT DO NOTHING
"""
