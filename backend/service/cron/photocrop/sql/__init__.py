# `crop_attempted_at` is what drains this queue. A photo whose crop can't be
# recovered - a missing rendition, or renditions that don't match - would
# otherwise stay `width IS NULL` and be re-fetched on every pass, and since the
# batch isn't offset, a batch of them would sit at the head forever and the
# backlog would never move.
Q_PHOTOS_WITHOUT_GEOMETRY = """
SELECT
    uuid
FROM
    photo
WHERE
    width IS NULL
AND
    crop_attempted_at IS NULL
LIMIT
    %(limit)s
"""

Q_SET_PHOTO_GEOMETRY = """
UPDATE
    photo
SET
    width = %(width)s,
    height = %(height)s,
    crop_top = %(crop_top)s,
    crop_left = %(crop_left)s,
    crop_attempted_at = now()
WHERE
    uuid = %(uuid)s
"""

Q_MARK_PHOTO_CROP_ATTEMPTED = """
UPDATE
    photo
SET
    crop_attempted_at = now()
WHERE
    uuid = ANY(%(uuids)s::TEXT[])
"""
