import asyncio
import secrets

import boto3
from botocore.exceptions import ClientError
from psycopg.errors import UniqueViolation
from starlette.requests import Request

import service.api.duotypes as t
from service.api.ratelimit import check_ip_and_account, video_upload_rate_limit
from service.api.videoupload.sql import *
from serviceshared.database import (
    api_tx,
    row_bool,
    row_int,
    row_str,
    row_str_or_none,
)
from serviceshared.duoenv.api import (
    R2_PRESIGN_ENDPOINT_URL,
    VIDEO_MAX_QUEUED_JOBS,
)
from serviceshared.duoenv.shared import (
    BOTO_ENDPOINT_URL,
    R2_ACCESS_KEY_ID,
    R2_ACCESS_KEY_SECRET,
    R2_VIDEO_UPLOAD_BUCKET_NAME,
)

V_BUSY = 'Your last video is still processing'

presigner = boto3.client(
    's3',
    endpoint_url=R2_PRESIGN_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_ACCESS_KEY_SECRET,
    region_name='auto',
)

s3 = boto3.client(
    's3',
    endpoint_url=BOTO_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_ACCESS_KEY_SECRET,
)


async def _uploaded_size(key: str) -> int | None:
    try:
        head = await asyncio.to_thread(
            s3.head_object, Bucket=R2_VIDEO_UPLOAD_BUCKET_NAME, Key=key)
    except ClientError:
        return None

    return int(head['ContentLength'])


async def post_video_upload(
    request: Request,
    req: t.PostVideoUpload,
    s: t.SessionInfo,
) -> dict[str, str] | tuple[str, int]:
    async with api_tx() as tx:
        state = await tx.require_one(
            Q_VIDEO_UPLOAD_STATE, dict(person_id=s.person_id))

    if row_bool(state, 'busy'):
        return V_BUSY, 409

    if (
        R2_VIDEO_UPLOAD_BUCKET_NAME is None or
        row_int(state, 'count_queued') >= VIDEO_MAX_QUEUED_JOBS
    ):
        return 'Video uploads are busy. Try again in a few minutes', 503

    await check_ip_and_account(
        request, video_upload_rate_limit, scope='video_upload')

    uuid = secrets.token_hex(32)

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_INSERT_VIDEO_JOB, dict(
            uuid=uuid,
            person_id=s.person_id,
            position=req.position,
            byte_size=req.byte_size,
        ))

    return dict(
        uuid=uuid,
        upload_url=presigner.generate_presigned_url(
            'put_object',
            Params=dict(
                Bucket=R2_VIDEO_UPLOAD_BUCKET_NAME,
                Key=uuid,
                ContentLength=req.byte_size,
                ContentType=req.content_type,
            ),
            ExpiresIn=60 * 60,
        ),
    )


async def post_video_upload_done(
    uuid: str,
    s: t.SessionInfo,
) -> tuple[str, int] | None:
    params = dict(uuid=uuid, person_id=s.person_id)

    async with api_tx() as tx:
        job = await (await tx.execute(Q_SELECT_VIDEO_JOB, params)).fetchone()

    if job is None:
        return '', 404

    if row_str(job, 'status') != 'uploading':
        return None

    if await _uploaded_size(uuid) != row_int(job, 'byte_size'):
        return "Your video didn't finish uploading. Please try again", 400

    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_QUEUE_VIDEO_JOB, params)
    except UniqueViolation:
        return V_BUSY, 409

    return None


async def get_video_upload(
    uuid: str,
    s: t.SessionInfo,
) -> dict[str, str | None] | tuple[str, int]:
    async with api_tx() as tx:
        job = await (await tx.execute(
            Q_SELECT_VIDEO_JOB, dict(uuid=uuid, person_id=s.person_id))
        ).fetchone()

    if job is None:
        return '', 404

    return dict(
        status=row_str(job, 'status'),
        message=row_str(job, 'message'),
        photo_uuid=row_str_or_none(job, 'photo_uuid'),
    )
