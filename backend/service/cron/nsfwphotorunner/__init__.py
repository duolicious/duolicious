from serviceshared.database import api_tx
from service.cron.nsfwphotorunner.sql import *
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    download_450_images,
    log_stacktrace,
)
import asyncio
import random
import logging

from serviceshared.duoenv.cron import NSFW_V2_PHOTO_RUNNER_POLL_SECONDS

logger = logging.getLogger(__name__)

logger.info('Hello from cron module')

async def predict_nsfw_v2_photos_once() -> None:
    from serviceshared.antiabuse.clipnsfw.predict import predict_clip_nsfw

    async with api_tx() as tx:
        cur = await tx.execute(Q_50_UNSCORED_V2_PHOTOS)
        uuids = [r['uuid'] for r in await cur.fetchall()]

    image_data_seq = await download_450_images(uuids)

    present = {
        uuid: image_data
        for uuid, image_data in zip(uuids, image_data_seq)
        if image_data
    }

    scores = dict(zip(
        present,
        await asyncio.to_thread(predict_clip_nsfw, list(present.values())),
    ))

    params_seq = [
        dict(uuid=uuid, nsfw_score_v2=scores.get(uuid, -1.0))
        for uuid in uuids
    ]

    async with api_tx() as tx:
        await tx.executemany(Q_SET_NSFW_SCORE_V2, params_seq)

async def predict_nsfw_v2_photos_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(predict_nsfw_v2_photos_once)
        await asyncio.sleep(NSFW_V2_PHOTO_RUNNER_POLL_SECONDS)
