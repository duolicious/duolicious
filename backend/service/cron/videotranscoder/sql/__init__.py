Q_REQUEUE_STALE_VIDEO_JOBS = """
WITH stale_job AS (
    UPDATE
        video_job
    SET
        status = CASE WHEN attempts < 2 THEN 'queued' ELSE 'failure' END,
        message = CASE WHEN attempts < 2 THEN '' ELSE %(message)s END
    WHERE
        status = 'running'
    AND
        claimed_at < NOW() - INTERVAL '15 minutes'
    RETURNING
        photo_uuid
)
INSERT INTO undeleted_photo (
    uuid
)
SELECT
    photo_uuid
FROM
    stale_job
WHERE
    NOT EXISTS (SELECT 1 FROM photo WHERE photo.uuid = stale_job.photo_uuid)
ON CONFLICT DO NOTHING
"""

Q_CLAIM_VIDEO_JOB = """
UPDATE
    video_job
SET
    status = 'running',
    claimed_at = NOW(),
    attempts = attempts + 1,
    photo_uuid = %(photo_uuid)s
WHERE
    uuid = (
        SELECT
            uuid
        FROM
            video_job
        WHERE
            status = 'queued'
        ORDER BY
            created_at
        LIMIT
            1
        FOR UPDATE SKIP LOCKED
    )
RETURNING
    uuid,
    person_id,
    position
"""

Q_SUCCEED_VIDEO_JOB = """
UPDATE
    video_job
SET
    status = 'success'
WHERE
    uuid = %(job_uuid)s
AND
    status = 'running'
AND
    photo_uuid = %(uuid)s
"""

Q_FAIL_VIDEO_JOB = """
WITH failed_job AS (
    UPDATE
        video_job
    SET
        status = 'failure',
        message = %(message)s
    WHERE
        uuid = %(job_uuid)s
    AND
        status = 'running'
    AND
        photo_uuid = %(uuid)s
)
INSERT INTO undeleted_photo (
    uuid
)
SELECT
    %(uuid)s
WHERE
    NOT EXISTS (SELECT 1 FROM photo WHERE uuid = %(uuid)s)
ON CONFLICT DO NOTHING
"""
