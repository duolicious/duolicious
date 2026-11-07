import asyncio
import base64
import binascii
from serviceshared import constants
from serviceshared.ffmpeg import FfmpegError, ffmpeg, workdir
from serviceshared.util import human_readable_size_metric
import logging
from serviceshared import asyncboto
import boto3

from serviceshared.duoenv.shared import (
    BOTO_ENDPOINT_URL,
    R2_ACCESS_KEY_ID,
    R2_ACCESS_KEY_SECRET,
    R2_ACCT_ID,
    R2_AUDIO_BUCKET_NAME,
)

logger = logging.getLogger(__name__)

s3 = boto3.resource(
    's3',
    endpoint_url=BOTO_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_ACCESS_KEY_SECRET,
)

audio_bucket = s3.Bucket(R2_AUDIO_BUCKET_NAME)

async def put_audio_in_object_store(
    uuid: str,
    audio_file_bytes: bytes,
) -> None:
    await asyncboto.put_object(
        audio_bucket,
        Key=f'{uuid}.aac',
        Body=audio_file_bytes,
    )

async def transcode_and_trim_audio(audio_bytes: bytes) -> bytes | ValueError:
    try:
        with workdir() as work:
            (work / 'input').write_bytes(audio_bytes)
            await ffmpeg(
                [
                    '-i', str(work / 'input'),
                    '-t', str(constants.MAX_AUDIO_SECONDS),
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-ar', '44100',
                    '-ac', '1',
                    '-f', 'adts',
                    str(work / 'output.aac'),
                ],
                formats='mov,matroska,ogg,wav,mp3,aac',
                cpu_seconds=20,
                timeout_seconds=20,
            )
            transcoded = (work / 'output.aac').read_bytes()
    except FfmpegError:
        logger.exception('Processing audio failed')
        return ValueError('Error while processing audio')

    return transcoded or ValueError('Error while processing audio')


def decode_base64_audio(audio_base64: str) -> bytes | ValueError:
    try:
        base64_value = audio_base64.split(',')[-1]
    except:
        return ValueError('Field base64 must be a valid base64 string')

    try:
        decoded_bytes = base64.b64decode(base64_value)
    except binascii.Error as e:
        return ValueError(f'Field base64 must be a valid base64 string')

    if len(decoded_bytes) > constants.MAX_AUDIO_BYTES:
        return ValueError(
            f'Decoded file must be smaller than '
            f'{human_readable_size_metric(constants.MAX_AUDIO_BYTES)}')

    return decoded_bytes


async def transcode_and_trim_audio_from_base64(
    audio_base64: str
) -> bytes | ValueError:
    decoded_bytes = await asyncio.to_thread(decode_base64_audio, audio_base64)

    if isinstance(decoded_bytes, ValueError):
        return decoded_bytes

    return await transcode_and_trim_audio(decoded_bytes)
