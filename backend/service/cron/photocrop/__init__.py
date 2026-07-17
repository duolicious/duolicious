from database import api_tx
from duophoto import PhotoGeometry, find_crop
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
# existed. The crop offset the uploader chose wasn't recorded at the time, but
# both renditions are still in the object store, so `find_crop` can work out
# where the square one sits inside the original.
#
# New uploads record their geometry directly (see `duophoto.photo_geometry`), so
# this only has the backlog to get through, and stops finding work once it has.

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

# Mean per-pixel difference (0-255) above which the best offset found isn't
# believable - the renditions probably aren't of the same photo. Recording a
# wrong crop would make the photo visibly jump when expanded, which is worse
# than not animating it at all, so those are left alone.
MAX_MATCH_DIFFERENCE = float(os.environ.get(
    'DUO_CRON_PHOTO_CROP_MAX_MATCH_DIFFERENCE',
    str(24.0),
))

print(f'Hello from cron module: {__name__}')

def _open(image_bytes: io.BytesIO | None) -> Image.Image | None:
    if image_bytes is None:
        return None
    try:
        return Image.open(image_bytes)
    except Exception as e:
        print('photocrop: could not open image:', e)
        return None

def _geometry_of(
    uuid: str,
    original_bytes: io.BytesIO | None,
    square_bytes: io.BytesIO | None,
) -> PhotoGeometry | None:
    original = _open(original_bytes)
    square = _open(square_bytes)

    if original is None or square is None:
        print(f'photocrop: {uuid} is missing a rendition; skipping')
        return None

    geometry, difference = find_crop(original, square)

    if difference > MAX_MATCH_DIFFERENCE:
        print(f'photocrop: {uuid} matched too poorly ({difference:.1f}); skipping')
        return None

    return geometry

async def _backfill(uuids: list[str]) -> None:
    # `original-` is the uncropped upload; `450-` is the same square crop as
    # `900-`, and a quarter of the pixels to fetch.
    originals, squares = await asyncio.gather(
        download_images(uuids, 'original-'),
        download_images(uuids, '450-'),
    )

    def compute() -> list[dict[str, object]]:
        return [
            dict(
                uuid=uuid,
                width=geometry.width,
                height=geometry.height,
                crop_top=geometry.crop_top,
                crop_left=geometry.crop_left,
            )
            for uuid, original, square in zip(uuids, originals, squares)
            for geometry in [_geometry_of(uuid, original, square)]
            if geometry is not None
        ]

    # Decoding and matching is CPU-bound; keep it off the event loop.
    params_seq = await asyncio.to_thread(compute)

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

async def backfill_photo_crops_once() -> None:
    async with api_tx() as tx:
        cur = await tx.execute(
            Q_PHOTOS_WITHOUT_GEOMETRY,
            dict(limit=PHOTO_CROP_BATCH_SIZE),
        )
        rows = await cur.fetchall()

    uuids = [row['uuid'] for row in rows]

    if not uuids:
        return

    await _backfill(uuids)

async def backfill_photo_crops_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(backfill_photo_crops_once)
        await asyncio.sleep(PHOTO_CROP_POLL_SECONDS)
