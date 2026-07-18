# Recently-online people first, so the photos most likely to be seen get their
# geometry soonest. `crop_attempted_at` drains the queue: photos whose crop
# can't be recovered would otherwise stay `width IS NULL` and be re-fetched on
# every pass. The keyset cursor (`after_*`) does the same for dry runs, which
# never mark anything. Served by the partial index
# idx__photo__crop_backlog__person_id.
Q_PHOTOS_WITHOUT_GEOMETRY = """
SELECT
    photo.uuid,
    person.last_online_time
FROM
    photo
JOIN
    person
ON
    person.id = photo.person_id
WHERE
    photo.width IS NULL
AND
    photo.crop_attempted_at IS NULL
AND (
    %(after_uuid)s::TEXT IS NULL
OR
    (person.last_online_time, photo.uuid)
    <
    (%(after_last_online)s::TIMESTAMP, %(after_uuid)s::TEXT)
)
ORDER BY
    person.last_online_time DESC,
    photo.uuid DESC
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
