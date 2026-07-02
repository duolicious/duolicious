from antiabuse.antiporn import predict_nsfw
from database import api_tx
from service.cron.nsfwphotorunner.sql import *
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    download_450_images,
    print_stacktrace,
)
import asyncio
import os
import random

NSFW_PHOTO_RUNNER_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_NSFW_PHOTO_RUNNER_POLL_SECONDS',
    str(1), # 1 second
))

print(f'Hello from cron module: {__name__}')

async def predict_nsfw_photos_once() -> None:
    async with api_tx() as tx:
        cur = await tx.execute(Q_50_UNCHECKED_PHOTOS)
        rows = await cur.fetchall()

    uuids = [r['uuid'] for r in rows]

    image_data_seq = await download_450_images(uuids)

    missing_uuids, missing_image_data_seq = [], []
    present_uuids, present_image_data_seq = [], []

    for uuid, image_data in zip(uuids, image_data_seq):
        if image_data:
            present_uuids.append(uuid)
            present_image_data_seq.append(image_data)
        else:
            missing_uuids.append(uuid)
            missing_image_data_seq.append(image_data)

    missing_nsfw_scores = [
        -1.0 for _ in missing_image_data_seq]
    present_nsfw_scores = await asyncio.to_thread(
        predict_nsfw, present_image_data_seq)

    uuids_ = (
        missing_uuids + present_uuids)
    nsfw_scores_ = (
        missing_nsfw_scores + present_nsfw_scores)

    params_seq = [
        dict(uuid=uuid, nsfw_score=nsfw_score)
        for uuid, nsfw_score in zip(uuids_, nsfw_scores_)
    ]

    async with api_tx() as tx:
        await tx.executemany(Q_SET_NSFW_SCORE, params_seq)

async def predict_nsfw_photos_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(predict_nsfw_photos_once)
        await asyncio.sleep(NSFW_PHOTO_RUNNER_POLL_SECONDS)
