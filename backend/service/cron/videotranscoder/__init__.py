import asyncio
import hashlib
import io
import logging
import os
import random
import secrets
from dataclasses import dataclass
from pathlib import Path

import boto3
from PIL import Image

from service.cron.cronutil import MAX_RANDOM_START_DELAY, log_stacktrace
from service.cron.videotranscoder.sql import *
from serviceshared import asyncboto
from serviceshared.antiabuse.bannedphoto import is_banned_photo
from serviceshared.commonsql import Q_PATCH_PHOTO, Q_UPDATE_VERIFICATION_LEVEL
from serviceshared.constants import MAX_VIDEO_UPLOAD_BYTES
from serviceshared.database import api_tx, row_int, row_str
from serviceshared.duoenv.cron import VIDEO_CONCURRENCY
from serviceshared.duoenv.shared import (
    BOTO_ENDPOINT_URL,
    R2_ACCESS_KEY_ID,
    R2_ACCESS_KEY_SECRET,
    R2_VIDEO_UPLOAD_BUCKET_NAME,
)
from serviceshared.duophoto import (
    CropSize,
    bucket,
    compute_blurhash,
    photo_geometry,
    photo_geometry_params,
    put_image_in_object_store,
)
from serviceshared.ffmpeg import (
    FfmpegError,
    Probe,
    ProbeStream,
    ffmpeg,
    ffprobe,
    workdir,
)

logger = logging.getLogger(__name__)

VIDEO_FORMATS = 'mov,matroska'

V_NOT_A_VIDEO = "That file isn't a video we can use"
V_TOO_BIG = 'Videos can be at most 4K at 60 frames per second'
V_RULES = 'That video breaks the rules'
V_WENT_WRONG = 'Something went wrong processing your video'

SCALE = (
    "scale='if(lte(iw,ih),trunc(min(720,iw)/2)*2,-2)'"
    ":'if(lte(iw,ih),-2,trunc(min(720,ih)/2)*2)'"
)

TONE_MAP = (
    'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,'
    'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv'
)

s3 = boto3.client(
    's3',
    endpoint_url=BOTO_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_ACCESS_KEY_SECRET,
)


class Rejection(Exception):
    pass


@dataclass(frozen=True)
class Job:
    uuid: str
    person_id: int
    position: int
    photo_uuid: str


def frame_rate(stream: ProbeStream) -> float:
    numerator, denominator = map(int, (stream.avg_frame_rate or '0/0').split('/'))
    return numerator / denominator if denominator else 0.0


def usable_video_stream(probe: Probe) -> ProbeStream:
    stream = next(
        (
            s for s in probe.streams
            if s.codec_type == 'video'
            and s.codec_name in ('h264', 'hevc', 'vp8', 'vp9', 'av1')
        ),
        None,
    )

    if stream is None:
        raise Rejection(V_NOT_A_VIDEO)

    width, height = stream.width or 0, stream.height or 0

    if min(width, height) < 50:
        raise Rejection(V_NOT_A_VIDEO)

    if (
        max(width, height) > 4096 or
        width * height * frame_rate(stream) > 3840 * 2160 * 60
    ):
        raise Rejection(V_TOO_BIG)

    return stream


def filter_graph(
    stream: ProbeStream,
    duration: float,
    stills_offset: float,
) -> str:
    chain = [
        'setpts=PTS-STARTPTS',
        *(['fps=30'] if frame_rate(stream) > 30 else []),
        SCALE,
        *([TONE_MAP] if stream.color_transfer in ('smpte2084', 'arib-std-b67') else []),
        'format=yuv420p',
    ]

    poster_seconds = 1 if duration >= 2 else 0

    return (
        f'[0:{stream.index}]{",".join(chain)},split=3[video][poster][stills];'
        f'[poster]trim=start={poster_seconds},trim=end_frame=1[poster_frame];'
        f"[stills]select='gte(t,{stills_offset:.3f})*"
        "(isnan(prev_selected_t)+gte(t-prev_selected_t,6))'[still_frames]"
    )


def file_md5(path: Path) -> str:
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'md5').hexdigest()


def score_frames(work: Path) -> float:
    from serviceshared.antiabuse.antiporn import predict_nsfw

    return max(predict_nsfw([
        io.BytesIO(path.read_bytes())
        for path in [work / 'poster.png', *sorted(work.glob('still-*.png'))]
    ]))


async def publish_video(job: Job, work: Path, cpu: int) -> None:
    source = work / 'source'

    await asyncio.to_thread(
        s3.download_file, R2_VIDEO_UPLOAD_BUCKET_NAME, job.uuid, str(source))

    if source.stat().st_size > MAX_VIDEO_UPLOAD_BYTES:
        raise Rejection('Videos must be smaller than 100 MB')

    md5 = await asyncio.to_thread(file_md5, source)

    if await is_banned_photo(md5):
        raise Rejection(V_RULES)

    probe = await ffprobe(source, VIDEO_FORMATS)

    stream = usable_video_stream(probe)

    duration = stream.duration or probe.format.duration or 0.0

    await ffmpeg(
        [
            '-threads', '1',
            '-max_pixels', str(4096 * 2304),
            '-t', '30',
            '-i', str(source),
            '-filter_complex_threads', '1',
            '-filter_complex', filter_graph(
                stream, duration, random.uniform(0, min(6, duration / 2))),
            '-map', '[video]',
            '-map', '0:a:0?',
            '-map_metadata', '-1',
            '-map_chapters', '-1',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-threads', '1',
            '-crf', '26',
            '-maxrate', '2200k',
            '-bufsize', '4400k',
            '-profile:v', 'high',
            '-c:a', 'aac',
            '-b:a', '96k',
            '-ac', '2',
            '-ar', '48000',
            '-movflags', '+faststart',
            str(work / 'video.mp4'),
            '-map', '[poster_frame]',
            '-frames:v', '1',
            '-threads', '1',
            str(work / 'poster.png'),
            '-map', '[still_frames]',
            '-threads', '1',
            '-fps_mode', 'passthrough',
            str(work / 'still-%02d.png'),
        ],
        formats=VIDEO_FORMATS,
        cpu_seconds=240,
        timeout_seconds=600,
        cpu=cpu,
    )

    video = (work / 'video.mp4').read_bytes()

    if len(video) > 10_000_000:
        raise Exception(f'The transcoded video is {len(video)} bytes')

    nsfw_score = await asyncio.to_thread(score_frames, work)

    if nsfw_score > 0.8:
        raise Rejection(V_RULES)

    poster = await asyncio.to_thread(
        lambda: Image.open(work / 'poster.png').convert('RGB'))
    geometry = photo_geometry(*poster.size)
    crop_size = CropSize(top=geometry.crop_top, left=geometry.crop_left)
    blurhash = await asyncio.to_thread(compute_blurhash, poster, crop_size)

    await put_image_in_object_store(job.photo_uuid, poster, crop_size)
    await asyncboto.put_object(
        bucket,
        Key=f'{job.photo_uuid}.mp4',
        Body=video,
        ContentType='video/mp4',
        CacheControl='public, max-age=31536000, immutable',
    )

    params = dict(
        job_uuid=job.uuid,
        person_id=job.person_id,
        position=job.position,
        uuid=job.photo_uuid,
        blurhash=blurhash,
        extra_exts=['mp4'],
        hash=md5,
        nsfw_score=nsfw_score,
        **photo_geometry_params(geometry),
    )

    async with api_tx() as tx:
        await tx.execute(Q_SUCCEED_VIDEO_JOB, params)
        if not tx.rowcount:
            raise Rejection(V_WENT_WRONG)
        await tx.execute(Q_PATCH_PHOTO, params)
        await tx.execute(Q_UPDATE_VERIFICATION_LEVEL, params)


async def fail(job: Job, message: str) -> None:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_FAIL_VIDEO_JOB, dict(
            job_uuid=job.uuid,
            uuid=job.photo_uuid,
            message=message,
        ))


async def transcode_video(job: Job, cpu: int) -> None:
    try:
        with workdir() as work:
            await publish_video(job, work, cpu)
    except Rejection as e:
        await fail(job, str(e))
    except FfmpegError:
        logger.exception(f'Transcoding video {job.uuid} failed')
        await fail(job, V_NOT_A_VIDEO)
    except Exception:
        logger.exception(f'Publishing video {job.uuid} failed')
        await fail(job, V_WENT_WRONG)
    finally:
        await asyncio.to_thread(
            s3.delete_object, Bucket=R2_VIDEO_UPLOAD_BUCKET_NAME, Key=job.uuid)


async def claim() -> Job | None:
    photo_uuid = secrets.token_hex(32)

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_REQUEUE_STALE_VIDEO_JOBS, dict(message=V_WENT_WRONG))
        row = await (await tx.execute(
            Q_CLAIM_VIDEO_JOB, dict(photo_uuid=photo_uuid))).fetchone()

    return None if row is None else Job(
        uuid=row_str(row, 'uuid'),
        person_id=row_int(row, 'person_id'),
        position=row_int(row, 'position'),
        photo_uuid=photo_uuid,
    )


async def transcode_queued_videos(cpu: int) -> None:
    while job := await claim():
        await transcode_video(job, cpu)


async def transcode_forever(cpu: int) -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while R2_VIDEO_UPLOAD_BUCKET_NAME is not None:
        await log_stacktrace(lambda: transcode_queued_videos(cpu))
        await asyncio.sleep(1)


async def transcode_videos_forever() -> None:
    cpus = sorted(os.sched_getaffinity(0))
    await asyncio.gather(*[
        transcode_forever(cpus[-(i % len(cpus)) - 1])
        for i in range(VIDEO_CONCURRENCY)
    ])
