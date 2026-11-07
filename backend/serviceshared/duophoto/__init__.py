import asyncio
import io
from dataclasses import dataclass
from typing import Literal

import blurhash
import boto3
import numpy
from PIL import Image, ImageOps

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

# How a photo's square renditions relate to the original they were cut from.

@dataclass(frozen=True)
class CropSize:
    top: int
    left: int

# Where the square renditions were cut out of the oriented original, in that
# image's coordinates. The crop is always `min(width, height)` on a side.
@dataclass(frozen=True)
class PhotoGeometry:
    width: int
    height: int
    crop_top: int
    crop_left: int

def orient_image(image: Image.Image) -> Image.Image:
    return ImageOps.exif_transpose(image) or image

# The renditions are cut with this and it's persisted alongside them, so the
# two can't drift. `width` and `height` must be `orient_image(...).size`.
def photo_geometry(
    width: int,
    height: int,
    crop_size: CropSize | None = None,
) -> PhotoGeometry:
    min_dim = min(width, height)

    if crop_size is None:
        top = (height - min_dim) // 2
        left = (width - min_dim) // 2
    else:
        top = min(height - min_dim, max(0, crop_size.top))
        left = min(width - min_dim, max(0, crop_size.left))

    return PhotoGeometry(width=width, height=height, crop_top=top, crop_left=left)

# The only way to turn a geometry into query params, so the four columns are
# always written together: a row can have all of them or none.
def photo_geometry_params(geometry: PhotoGeometry) -> dict[str, int]:
    return dict(
        width=geometry.width,
        height=geometry.height,
        crop_top=geometry.crop_top,
        crop_left=geometry.crop_left,
    )

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
    image: Image.Image,
    output_size: int | None = None,
    crop_size: CropSize | None = None,
) -> io.BytesIO:
    output_bytes = io.BytesIO()

    process_image_as_image(image, output_size, crop_size).save(
        output_bytes,
        format='jpeg',
        quality=85,
        subsampling=2,
        progressive=True,
        optimize=True,
    )

    output_bytes.seek(0)

    return output_bytes

def compute_blurhash(image: Image.Image, crop_size: CropSize | None = None) -> str:
    image = process_image_as_image(image, output_size=32, crop_size=crop_size)

    return blurhash.encode(numpy.array(image.convert("RGB")))

async def put_image_in_object_store(
    uuid: str,
    image: Image.Image,
    crop_size: CropSize,
    sizes: list[Literal[None, 900, 450]] = [None, 900, 450],
    raw_gif: bytes | None = None,
) -> None:
    def process() -> list[tuple[str, io.BytesIO]]:
        return [
            (
                f'{size if size else "original"}-{uuid}.jpg',
                process_image_as_bytes(
                    image=image,
                    output_size=size,
                    crop_size=None if size is None else crop_size
                )
            )
            for size in sizes
        ] + ([] if raw_gif is None else [(f'{uuid}.gif', io.BytesIO(raw_gif))])

    # Image processing is CPU-bound, so keep it off the event loop.
    key_img = await asyncio.to_thread(process)

    results = await asyncio.gather(
        *[
            asyncboto.put_object(bucket, Key=key, Body=img)
            for key, img in key_img
        ],
        return_exceptions=True,
    )

    for result in results:
        if isinstance(result, BaseException):
            raise result
