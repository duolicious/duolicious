import asyncio
import io
from typing import Literal

import blurhash
import boto3
import numpy
from PIL import Image
from starlette.concurrency import run_in_threadpool

import service.api.duotypes as t
from service.api.person.duophoto import CropSize, orient_image, photo_geometry
from serviceshared import asyncboto
from serviceshared.duoenv.shared import (
    BOTO_ENDPOINT_URL,
    R2_ACCESS_KEY_ID,
    R2_ACCESS_KEY_SECRET,
    R2_BUCKET_NAME,
)

s3 = boto3.resource(
    's3',
    endpoint_url=BOTO_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_ACCESS_KEY_SECRET,
)

bucket = s3.Bucket(R2_BUCKET_NAME)

def process_image_as_image(
    image: Image.Image,
    output_size: int | None = None,
    crop_size: CropSize | None = None,
) -> Image.Image:
    image = orient_image(image)

    if output_size is None:
        return image.convert('RGB')

    g = photo_geometry(*image.size, crop_size)

    min_dim = min(g.width, g.height)

    image = image.crop((
        g.crop_left,
        g.crop_top,
        g.crop_left + min_dim,
        g.crop_top + min_dim,
    ))

    if output_size != min_dim:
        image = image.resize((output_size, output_size))

    return image.convert('RGB')

def process_image_as_bytes(
    base64_file: t.Base64File,
    format: Literal['raw', 'jpeg'],
    output_size: int | None = None,
    crop_size: CropSize | None = None,
) -> io.BytesIO:
    if format == 'raw':
        return io.BytesIO(base64_file.bytes)

    output_bytes = io.BytesIO()

    image = process_image_as_image(base64_file.image, output_size, crop_size)

    image.save(
        output_bytes,
        format=format,
        quality=85,
        subsampling=2,
        progressive=True,
        optimize=True,
    )

    output_bytes.seek(0)

    return output_bytes

def compute_blurhash(image: Image.Image, crop_size: CropSize | None = None) -> object:
    image = process_image_as_image(image, output_size=32, crop_size=crop_size)

    return blurhash.encode(numpy.array(image.convert("RGB")))

async def put_image_in_object_store(
    uuid: str,
    base64_file: t.Base64File,
    crop_size: CropSize,
    sizes: list[Literal[None, 900, 450]] = [None, 900, 450],
) -> None:
    def process() -> list[tuple[str, io.BytesIO]]:
        key_img = [
            (
                f'{size if size else "original"}-{uuid}.jpg',
                process_image_as_bytes(
                    base64_file=base64_file,
                    format='jpeg',
                    output_size=size,
                    crop_size=None if size is None else crop_size
                )
            )
            for size in sizes
        ]

        if base64_file.image.format == 'GIF' and None in sizes:
            key_img.append((
                f'{uuid}.gif',
                process_image_as_bytes(base64_file=base64_file, format='raw')
            ))

        return key_img

    # Image processing is CPU-bound, so keep it off the event loop.
    key_img = await run_in_threadpool(process)

    await asyncio.gather(*[
        asyncboto.put_object(bucket, Key=key, Body=img)
        for key, img in key_img
    ])
