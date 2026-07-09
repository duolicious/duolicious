from duoaudio import (
    put_audio_in_object_store,
    transcode_and_trim_audio_from_base64,
)
from chatprotocol.message import AudioMessage
import asyncio
import secrets
import traceback

async def transcode_and_put(
    uuid: str,
    audio_base64: str
) -> bool:
    # ffmpeg transcode is CPU-bound and shells out to a subprocess; offload it
    # so it doesn't block the chat event loop.
    response = await asyncio.to_thread(
        transcode_and_trim_audio_from_base64, audio_base64=audio_base64)

    if isinstance(response, ValueError):
        return False

    _, transcoded = response

    try:
        await put_audio_in_object_store(uuid=uuid, audio_file_bytes=transcoded)
    except:
        print(traceback.format_exc())
        return False

    return True
