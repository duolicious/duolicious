from database import api_tx
from service.cron.audiocleaner.sql import *
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    delete_audio_from_object_store,
    print_stacktrace,
)
import asyncio
import random

from duoenv.cron import (
    AUDIO_CLEANER_DRY_RUN as DRY_RUN,
    AUDIO_CLEANER_POLL_SECONDS,
)

print(f'Hello from cron module: {__name__}')

async def clean_audio_once() -> None:
    params = dict(polling_interval_seconds=AUDIO_CLEANER_POLL_SECONDS)

    async with api_tx() as tx:
        cur_unused_audio = await tx.execute(Q_UNUSED_AUDIO, params)
        rows_unused_audio = await cur_unused_audio.fetchall()

    uuids = [r['uuid'] for r in rows_unused_audio]
    await delete_audio_from_object_store(
        uuids=uuids,
        dry_run=DRY_RUN,
        dry_run_env_var_name='DUO_CRON_AUDIO_CLEANER_DRY_RUN',
    )

async def clean_audio_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(clean_audio_once)
        await asyncio.sleep(AUDIO_CLEANER_POLL_SECONDS)
