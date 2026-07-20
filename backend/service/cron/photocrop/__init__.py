from database import api_tx
from duophoto import (
    DEFAULT_MAX_MATCH_DIFFERENCE,
    PhotoGeometry,
    find_crop,
    is_crop_believable,
    photo_geometry_params,
)
from service.cron.photocrop.sql import *
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    download_images,
    print_stacktrace,
)
from PIL import Image
import asyncio
import io
import os
import random

# Recovers the geometry of photos uploaded before `photo.width` and friends
# existed, by finding where the square rendition sits inside the original. New
# uploads record their geometry directly, so this only has the backlog to get
# through.

DRY_RUN = os.environ.get(
    'DUO_CRON_PHOTO_CROP_DRY_RUN',
    'true',
).lower() not in ['false', 'f', '0', 'no']

PHOTO_CROP_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_PHOTO_CROP_POLL_SECONDS',
    str(60), # 1 minute
))

PHOTO_CROP_BATCH_SIZE = int(os.environ.get(
    'DUO_CRON_PHOTO_CROP_BATCH_SIZE',
    str(50),
))

# How many photos' renditions are downloaded and held in memory at once. The
# originals are full-size uploads, so a whole batch of them at once is easily
# hundreds of megabytes.
PHOTO_CROP_DOWNLOAD_CHUNK = int(os.environ.get(
    'DUO_CRON_PHOTO_CROP_DOWNLOAD_CHUNK',
    str(5),
))

MAX_MATCH_DIFFERENCE = float(os.environ.get(
    'DUO_CRON_PHOTO_CROP_MAX_MATCH_DIFFERENCE',
    str(DEFAULT_MAX_MATCH_DIFFERENCE),
))

print(f'Hello from cron module: {__name__}')

def _geometry_of(
    uuid: str,
    original_bytes: io.BytesIO | None,
    square_bytes: io.BytesIO | None,
) -> PhotoGeometry | None:
    if original_bytes is None or square_bytes is None:
        print(f'photocrop: {uuid} is missing a rendition; skipping')
        return None

    # A photo that can't be decoded must still count as attempted, or the
    # batch it sits in would be re-selected on every pass and stall the
    # backlog.
    try:
        geometry, difference = find_crop(
            Image.open(original_bytes),
            Image.open(square_bytes),
        )
    except Exception as e:
        print(f'photocrop: {uuid} could not be matched:', e)
        return None

    if not is_crop_believable(geometry, difference, MAX_MATCH_DIFFERENCE):
        print(f'photocrop: {uuid} matched too poorly ({difference:.1f}); skipping')
        return None

    return geometry

async def _backfill(uuids: list[str]) -> None:
    def compute(
        chunk: list[str],
        originals: list[io.BytesIO | None],
        squares: list[io.BytesIO | None],
    ) -> list[dict[str, str | int]]:
        params: list[dict[str, str | int]] = []

        for uuid, original, square in zip(chunk, originals, squares):
            geometry = _geometry_of(uuid, original, square)

            if geometry is None:
                continue

            params.append(dict(uuid=uuid, **photo_geometry_params(geometry)))

        return params

    params_seq: list[dict[str, str | int]] = []

    for start in range(0, len(uuids), PHOTO_CROP_DOWNLOAD_CHUNK):
        chunk = uuids[start:start + PHOTO_CROP_DOWNLOAD_CHUNK]

        # `original-` is the uncropped upload; `450-` is the same square crop
        # as `900-` at a quarter of the pixels.
        originals, squares = await asyncio.gather(
            download_images(chunk, 'original-'),
            download_images(chunk, '450-'),
        )

        # Decoding and matching is CPU-bound; keep it off the event loop.
        params_seq += await asyncio.to_thread(compute, chunk, originals, squares)

    if DRY_RUN:
        print(
            'DUO_CRON_PHOTO_CROP_DRY_RUN env var prevented geometry update:',
            params_seq,
        )
        return

    # Mark the whole batch, not just the photos that worked, so the ones that
    # didn't stop coming back.
    async with api_tx() as tx:
        await tx.execute(Q_MARK_PHOTO_CROP_ATTEMPTED, dict(uuids=uuids))
        if params_seq:
            await tx.executemany(Q_SET_PHOTO_GEOMETRY, params_seq)

    print(
        f'photocrop: recorded geometry for {len(params_seq)} '
        f'of {len(uuids)} photos'
    )

async def backfill_photo_crops_once(after: str = '') -> str:
    async with api_tx() as tx:
        cur = await tx.execute(
            Q_PHOTOS_WITHOUT_GEOMETRY,
            dict(after=after, limit=PHOTO_CROP_BATCH_SIZE),
        )
        rows = await cur.fetchall()

    uuids = [row['uuid'] for row in rows]

    if not uuids:
        return after

    await _backfill(uuids)

    return uuids[-1]

async def backfill_photo_crops_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))

    # The cursor only ever advances: a wet run drains the queue via
    # `crop_attempted_at` anyway, and a dry run - which writes nothing - would
    # otherwise re-download the same batch every poll. Restart to re-walk.
    after = ''

    while True:
        async def advance() -> None:
            nonlocal after
            after = await backfill_photo_crops_once(after)

        await print_stacktrace(advance)
        await asyncio.sleep(PHOTO_CROP_POLL_SECONDS)
