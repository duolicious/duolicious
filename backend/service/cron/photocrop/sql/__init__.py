# `crop_attempted_at` drains the queue: photos whose crop can't be recovered
# would otherwise stay `width IS NULL` and be re-fetched on every pass. The
# keyset cursor (`after`) does the same for dry runs, which never mark
# anything. Served by the partial index idx__photo__crop_backlog.
Q_PHOTOS_WITHOUT_GEOMETRY = """
SELECT
    uuid
FROM
    photo
WHERE
    width IS NULL
AND
    crop_attempted_at IS NULL
AND
    uuid > %(after)s
ORDER BY
    uuid
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
    crop_left = %(crop_left)s
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
