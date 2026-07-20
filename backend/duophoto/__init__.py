from dataclasses import dataclass
from PIL import Image, ImageOps

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
