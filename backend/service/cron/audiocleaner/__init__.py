from database import api_tx
from service.cron.audiocleaner.sql import *
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    delete_audio_from_object_store,
    print_stacktrace,
)
import asyncio
import os
import random

DRY_RUN = os.environ.get(
    'DUO_CRON_AUDIO_CLEANER_DRY_RUN',
    'true',
).lower() not in ['false', 'f', '0', 'no']

AUDIO_CLEANER_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_AUDIO_CLEANER_POLL_SECONDS',
    str(60), # 1 minute
))

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
