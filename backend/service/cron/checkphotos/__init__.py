# Remove unused imports
from database import api_tx, row_str
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    delete_images_from_object_store,
    download_450_images,
    print_stacktrace,
)
import asyncio
import boto3
import os
import random
import io
import blurhash
import numpy
from PIL import Image
from collections.abc import Iterator

DRY_RUN = os.environ.get(
    'DUO_CRON_CHECK_PHOTOS_DRY_RUN',
    'true',
).lower() not in ['false', 'f', '0', 'no']

CHECK_PHOTOS_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_CHECK_PHOTOS_POLL_SECONDS',
    str(1), # 1 second
))

R2_ACCT_ID           = os.environ['DUO_R2_ACCT_ID']
R2_ACCESS_KEY_ID     = os.environ['DUO_R2_ACCESS_KEY_ID']
R2_ACCESS_KEY_SECRET = os.environ['DUO_R2_ACCESS_KEY_SECRET']
R2_BUCKET_NAME       = os.environ['DUO_R2_BUCKET_NAME']

BOTO_ENDPOINT_URL = os.getenv(
    'DUO_BOTO_ENDPOINT_URL',
    f'https://{R2_ACCT_ID}.r2.cloudflarestorage.com'
)

print(f'Hello from cron module: {__name__}')

s3_client = boto3.client(
    's3',
    endpoint_url=BOTO_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_ACCESS_KEY_SECRET,
)

async def update_blurhashes(uuids: list[str]) -> None:
    images = [_require_image(image) for image in await download_450_images(uuids)]
    blurhashes = compute_blurhashes(images)

    params_seq = [
        dict(uuid=uuid, blurhash=blurhash)
        for uuid, blurhash in zip(uuids, blurhashes)
    ]

    q = "update photo set blurhash = %(blurhash)s where uuid = %(uuid)s"

    if DRY_RUN:
        print(
            'DUO_CHECK_PHOTOS_DRY_RUN env var prevented blurhash update:',
            params_seq
        )
        return

    async with api_tx() as tx:
        await tx.executemany(q, params_seq)

    print('checkphotos: updated blurhashes', params_seq)

def list_images_in_object_store() -> Iterator[list[str]]:
    print(f'checkphotos: listing images in object store')
    paginator = s3_client.get_paginator('list_objects_v2')

    count = 0

    # Iterate over the pages of the results
    for page in paginator.paginate(
            Bucket=R2_BUCKET_NAME, Prefix='450-', MaxKeys=300):
        # Check if 'Contents' key is in the page (it's not if the bucket is empty)
        if 'Contents' in page:
            keys = [obj['Key'] for obj in page['Contents']]

            count += len(keys)

            print(f'checkphotos: fetched {count} keys')

            yield keys

    print(f'checkphotos: fetched {count} keys in total')

def list_uuids_in_object_store() -> Iterator[list[str]]:
    for chunk in list_images_in_object_store():
        yield [key[4:-4] for key in chunk]


def _require_image(image: io.BytesIO | None) -> io.BytesIO:
    if image is None:
        raise RuntimeError('expected image to exist')
    return image


async def resolve_uuids(uuids: list[str]) -> tuple[list[str], list[str]]:
    q_to_update = """
        SELECT uuid
        FROM photo
        WHERE
            uuid = ANY(%(uuids)s::TEXT[])
        AND
            blurhash = ''
    """
    q_to_delete = """
        SELECT unn.uuid
        FROM unnest(%(uuids)s::TEXT[]) AS unn(uuid)
        LEFT JOIN photo p ON unn.uuid = p.uuid
        LEFT JOIN onboardee_photo op ON unn.uuid = op.uuid
        WHERE p.uuid IS NULL AND op.uuid IS NULL
    """
    params = dict(uuids=uuids)

    async with api_tx() as tx:
        cur = await tx.execute(q_to_update, params)
        rows_to_update = await cur.fetchall()

    async with api_tx() as tx:
        cur = await tx.execute(q_to_delete, params)
        rows_to_delete = await cur.fetchall()

    to_update = [row_str(x, 'uuid') for x in rows_to_update]
    to_delete = [row_str(x, 'uuid') for x in rows_to_delete]

    return to_update, to_delete

def compute_blurhash(image_bytes: io.BytesIO) -> str:
    image = Image.open(image_bytes)
    image = image.resize((16, 16), resample=Image.Resampling.NEAREST)
    return blurhash.encode(numpy.array(image.convert("RGB")))

def compute_blurhashes(images: list[io.BytesIO]) -> list[str]:
    print('checkphotos: computing blurhashes')

    blurhashes = [compute_blurhash(i) for i in images]

    print('checkphotos: computing blurhashes complete')

    return blurhashes

async def check_photos_once() -> None:
    # `list_uuids_in_object_store` is a blocking generator (each step makes a
    # synchronous S3 pagination request), so pull each page in a worker thread
    # to avoid blocking the event loop.
    chunks = list_uuids_in_object_store()
    while True:
        chunk = await asyncio.to_thread(lambda: next(chunks, None))
        if chunk is None:
            break

        uuids_to_update, uuids_to_delete = await resolve_uuids(chunk)

        await update_blurhashes(uuids_to_update)
        await delete_images_from_object_store(uuids_to_delete)

async def check_photos_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(check_photos_once)
        await asyncio.sleep(CHECK_PHOTOS_POLL_SECONDS)
