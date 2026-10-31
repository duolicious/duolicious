from serviceshared.database import api_tx
from service.cron.photocleaner.sql import *
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    delete_images_from_object_store,
    download_450_images,
    log_stacktrace,
)
from collections.abc import Mapping
from pgvector import HalfVector
import asyncio
import random
import logging

from serviceshared.duoenv.cron import (
    PHOTO_CLEANER_DRY_RUN as DRY_RUN,
    PHOTO_CLEANER_POLL_SECONDS,
)

logger = logging.getLogger(__name__)

logger.info('Hello from cron module')

async def store_banned_photo_embeddings(
    rows: list[Mapping[str, str | None]],
) -> None:
    from serviceshared.antiabuse.clipnsfw.predict import embed_clip_nsfw

    image_data_seq = await download_450_images([str(r['uuid']) for r in rows])

    embeddings = await asyncio.to_thread(lambda: [
        embed_clip_nsfw(image_data) if image_data else None
        for image_data in image_data_seq
    ])

    params_seq = [
        dict(hash=r['unembedded_banned_hash'], embedding=HalfVector(embedding))
        for r, embedding in zip(rows, embeddings)
        if embedding is not None
    ]

    async with api_tx() as tx:
        await tx.executemany(Q_SET_BANNED_PHOTO_EMBEDDING, params_seq)

async def clean_photos_once() -> None:
    params = dict(polling_interval_seconds=PHOTO_CLEANER_POLL_SECONDS)

    async with api_tx() as tx:
        cur_unused_photos = await tx.execute(Q_UNUSED_PHOTOS, params)
        rows_unused_photos = await cur_unused_photos.fetchall()

    await store_banned_photo_embeddings(
        [r for r in rows_unused_photos if r['unembedded_banned_hash']])

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
