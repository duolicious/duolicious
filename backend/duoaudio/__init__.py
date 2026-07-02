import os
import io
import subprocess
import tempfile
from pathlib import Path
import base64
import binascii
import constants
from util import human_readable_size_metric
import traceback
import asyncboto
import boto3

R2_AUDIO_BUCKET_NAME = os.environ['DUO_R2_AUDIO_BUCKET_NAME']
R2_ACCT_ID = os.environ['DUO_R2_ACCT_ID']
R2_ACCESS_KEY_ID = os.environ['DUO_R2_ACCESS_KEY_ID']
R2_ACCESS_KEY_SECRET = os.environ['DUO_R2_ACCESS_KEY_SECRET']

BOTO_ENDPOINT_URL = os.getenv(
    'DUO_BOTO_ENDPOINT_URL',
    f'https://{R2_ACCT_ID}.r2.cloudflarestorage.com'
)

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

def transcode_and_trim_audio(
    input_audio: io.BytesIO,
    max_duration_or_none: int | None = None
) -> io.BytesIO:
    max_duration = (
            constants.MAX_AUDIO_SECONDS
            if max_duration_or_none is None
            else max_duration_or_none)

    # Ensure input audio is not empty
    if input_audio.getbuffer().nbytes == 0:
        raise ValueError("Input audio buffer is empty.")

    # Prepare the output buffer for the transcoded and trimmed audio
    output_audio = io.BytesIO()

    # Create a temporary directory to store input and output files
    with tempfile.TemporaryDirectory() as temp_dir:
        # Convert the temporary directory path to a Path object
        temp_dir_path = Path(temp_dir)

        # Define file paths for the temporary input and output files
        temp_input_file_path = temp_dir_path / 'input_audio'
        temp_output_file_path = temp_dir_path / 'output_audio.aac'

        # Write the input audio data to the temporary input file
        with temp_input_file_path.open('wb') as temp_input_file:
            temp_input_file.write(input_audio.getvalue())

        # FFmpeg command to transcode audio with settings optimized for voice data
        ffmpeg_cmd = [
            'ffmpeg',
            '-i',   str(temp_input_file_path),  # Read from temporary input file
            '-t',   str(max_duration),          # Set max_duration
            '-c:a', 'aac',                      # Use AAC codec
            '-b:a', '128k',                     # Bitrate
            '-ar',  '44100',                    # Sample rate
            '-ac',  '1',                        # Set audio to mono
            '-f',   'adts',                     # Set format to AAC
            str(temp_output_file_path)          # Output to temporary output file
        ]

        # Run FFmpeg as a subprocess
        process = subprocess.run(
            ffmpeg_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # Check if the transcoding was successful
        if process.returncode != 0:
            raise RuntimeError(f"FFmpeg error: {process.stderr.decode()}")

        # Check for empty output
        if not temp_output_file_path.exists() or temp_output_file_path.stat().st_size == 0:
            raise RuntimeError(
                "FFmpeg produced an empty output file.\n"
                f"stderr was {process.stderr.decode()}"
            )

        # Read the transcoded audio from the output file into the output buffer
        with temp_output_file_path.open('rb') as temp_output_file:
            output_audio.write(temp_output_file.read())

    # Reset buffer position to the start
    output_audio.seek(0)

    return output_audio


def transcode_and_trim_audio_from_base64(
    audio_base64: str,
    max_duration: int | None = None
) -> tuple[bytes, bytes] | ValueError:
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

    try:
        transcoded = transcode_and_trim_audio(
            io.BytesIO(decoded_bytes),
            max_duration,
        ).getvalue()
    except:
        print(traceback.format_exc())
        print('base64 input was: ' + audio_base64)
        return ValueError('Error while processing audio')

    return decoded_bytes, transcoded
