import asyncio
import os
import pwd
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from pydantic import BaseModel

from serviceshared.duoenv.shared import FFMPEG_USER

_USER = None if FFMPEG_USER is None else pwd.getpwnam(FFMPEG_USER)


class FfmpegError(Exception):
    pass


class ProbeStream(BaseModel):
    index: int
    codec_type: str
    codec_name: str | None = None
    width: int | None = None
    height: int | None = None
    avg_frame_rate: str | None = None
    color_transfer: str | None = None
    duration: float | None = None


class ProbeFormat(BaseModel):
    duration: float | None = None


class Probe(BaseModel):
    streams: list[ProbeStream]
    format: ProbeFormat


@contextmanager
def workdir() -> Iterator[Path]:
    with tempfile.TemporaryDirectory() as path:
        if _USER is not None:
            os.chown(path, _USER.pw_uid, _USER.pw_gid)
        yield Path(path)


async def _run(
    command: list[str],
    formats: str,
    cpu_seconds: int,
    timeout_seconds: float,
    cpu: int | None,
) -> bytes:
    process = await asyncio.create_subprocess_exec(
        'prlimit', f'--cpu={cpu_seconds}', '--',
        *([] if cpu is None else ['taskset', '-c', str(cpu)]),
        command[0],
        '-protocol_whitelist', 'file',
        '-format_whitelist', formats,
        *command[1:],
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={'PATH': os.environ.get('PATH', os.defpath)},
        user=None if _USER is None else _USER.pw_uid,
        group=None if _USER is None else _USER.pw_gid,
        extra_groups=None if _USER is None else [],
    )

    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(), timeout_seconds)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise FfmpegError(f'{command[0]} timed out')

    if process.returncode:
        raise FfmpegError(stderr.decode(errors='replace'))

    return stdout


async def ffprobe(path: Path, formats: str) -> Probe:
    stdout = await _run(
        [
            'ffprobe', '-v', 'error',
            '-show_entries',
            'format=duration:stream=index,codec_type,codec_name,width,height,'
            'avg_frame_rate,color_transfer,duration',
            '-of', 'json',
            str(path),
        ],
        formats=formats,
        cpu_seconds=10,
        timeout_seconds=30,
        cpu=None,
    )

    return Probe.model_validate_json(stdout)


async def ffmpeg(
    args: list[str],
    formats: str,
    cpu_seconds: int,
    timeout_seconds: float,
    cpu: int | None = None,
) -> None:
    await _run(
        ['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', *args],
        formats=formats,
        cpu_seconds=cpu_seconds,
        timeout_seconds=timeout_seconds,
        cpu=cpu,
    )
