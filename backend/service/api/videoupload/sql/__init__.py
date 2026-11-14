Q_VIDEO_UPLOAD_STATE = """
SELECT
    EXISTS (
        SELECT
            1
        FROM
            video_job
        WHERE
            person_id = %(person_id)s
        AND
            status IN ('queued', 'running')
    ) AS busy,
    (
        SELECT
            count(*)
        FROM
            video_job
        WHERE
            status = 'queued'
    ) AS count_queued
"""

Q_INSERT_VIDEO_JOB = """
WITH abandoned_upload AS (
    DELETE FROM
        video_job
    WHERE
        person_id = %(person_id)s
    AND
        status = 'uploading'
)
INSERT INTO video_job (
    uuid,
    person_id,
    position,
    byte_size
) VALUES (
    %(uuid)s,
    %(person_id)s,
    %(position)s,
    %(byte_size)s
)
"""

Q_SELECT_VIDEO_JOB = """
SELECT
    video_job.status,
    video_job.message,
    video_job.byte_size,
    CASE WHEN video_job.status = 'success' THEN video_job.photo_uuid END AS photo_uuid,
    photo.duration_seconds
FROM
    video_job
LEFT JOIN
    photo
ON
    video_job.status = 'success'
AND
    photo.uuid = video_job.photo_uuid
WHERE
    video_job.uuid = %(uuid)s
AND
    video_job.person_id = %(person_id)s
"""

Q_QUEUE_VIDEO_JOB = """
UPDATE
    video_job
SET
    status = 'queued'
WHERE
    uuid = %(uuid)s
AND
    person_id = %(person_id)s
AND
    status = 'uploading'
"""
