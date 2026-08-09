from database import api_tx
from service.cron.photocleaner.sql import *
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    delete_images_from_object_store,
    log_stacktrace,
)
import asyncio
import random
import logging

from duoenv.cron import (
    PHOTO_CLEANER_DRY_RUN as DRY_RUN,
    PHOTO_CLEANER_POLL_SECONDS,
)

logger = logging.getLogger(__name__)

logger.info('Hello from cron module')

async def clean_photos_once() -> None:
    params = dict(polling_interval_seconds=PHOTO_CLEANER_POLL_SECONDS)

    async with api_tx() as tx:
        cur_unused_photos = await tx.execute(Q_UNUSED_PHOTOS, params)
        rows_unused_photos = await cur_unused_photos.fetchall()

    uuids = [r['uuid'] for r in rows_unused_photos]
    await delete_images_from_object_store(
        uuids=uuids,
        dry_run=DRY_RUN,
        dry_run_env_var_name='DUO_CRON_PHOTO_CLEANER_DRY_RUN',
    )

async def clean_photos_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(clean_photos_once)
        await asyncio.sleep(PHOTO_CLEANER_POLL_SECONDS)
