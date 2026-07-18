from dataclasses import dataclass
from PIL import Image, ImageOps
import numpy

# How a photo's square renditions relate to the original they were cut from.
# Lives here rather than in `person` so the crop backfill
# (`service/cron/photocrop`) can share the definition without importing the API.

@dataclass
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

# Progressively finer widths (px) for `find_crop`: a coarse scan of the whole
# range, then narrow windows around the previous winner, so the cost stays flat
# as the photo gets bigger.
MATCH_SCALES = (64, 256, 1024)

def _greyscale(image: Image.Image, size: tuple[int, int]) -> numpy.ndarray:
    resized = image.convert('L').resize(size, Image.Resampling.BILINEAR)
    return numpy.asarray(resized, dtype=numpy.float32)

def _difference(
    original: numpy.ndarray,
    square: numpy.ndarray,
    offset: int,
    horizontal: bool,
) -> float | None:
    size = square.shape[0]

    window = (
        original[:, offset:offset + size]
        if horizontal
        else original[offset:offset + size, :]
    )

    if window.shape != square.shape:
        return None

    return float(numpy.abs(window - square).mean())

# The inverse of `photo_geometry`, for photos uploaded before the crop was
# recorded. Returns the geometry and the mean per-pixel difference (0-255) it
# achieved, which callers should check before trusting the result. The square
# can only slide along the longer axis, so the search is one-dimensional.
def find_crop(
    original: Image.Image,
    square: Image.Image,
) -> tuple[PhotoGeometry, float]:
    width, height = original.size

    min_dim = min(width, height)
    span = max(width, height) - min_dim

    horizontal = width > height

    def geometry_at(offset: int) -> PhotoGeometry:
        return PhotoGeometry(
            width=width,
            height=height,
            crop_top=0 if horizontal else offset,
            crop_left=offset if horizontal else 0,
        )

    if span == 0:
        return geometry_at(0), 0.0

    lo, hi = 0, span
    best_offset = 0
    best_difference = float('inf')

    for scale_size in MATCH_SCALES:
        size = min(scale_size, min_dim)
        scale = size / min_dim

        scaled = (
            max(size, round(width * scale)),
            max(size, round(height * scale)),
        )

        original_pixels = _greyscale(original, scaled)
        square_pixels = _greyscale(square, (size, size))

        limit = (scaled[0] if horizontal else scaled[1]) - size

        # Don't sample the range more finely than the pixels can distinguish.
        stride = max(1, int(1 / scale))

        best_offset = lo
        best_difference = float('inf')

        for offset in range(lo, hi + 1, stride):
            difference = _difference(
                original_pixels,
                square_pixels,
                min(limit, max(0, round(offset * scale))),
                horizontal,
            )

            if difference is not None and difference < best_difference:
                best_offset = offset
                best_difference = difference

        lo = max(0, best_offset - stride)
        hi = min(span, best_offset + stride)

    return geometry_at(best_offset), best_difference
