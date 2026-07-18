from PIL import Image, ImageDraw
import io
import random

# Synthetic photos for the crop tests. Busy and non-repeating, so the crop
# offset is unambiguous - a flat or tiled image would leave it genuinely
# ambiguous, which is a property of the photo, not the search.

def photo(width: int, height: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    image = Image.new('RGB', (width, height), (12, 12, 30))
    draw = ImageDraw.Draw(image)

    for _ in range(160):
        x, y = rng.randint(0, width), rng.randint(0, height)
        draw.ellipse(
            [x, y, x + rng.randint(15, 90), y + rng.randint(15, 90)],
            fill=(rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255)),
        )

    return image

def jpeg(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format='jpeg', quality=85, subsampling=2)
    return buffer.getvalue()

# The original and its 450 square crop, as the object store holds them.
def renditions(
    original: Image.Image,
    crop_left: int,
    crop_top: int,
) -> tuple[bytes, bytes]:
    min_dim = min(original.size)
    square = original.crop((
        crop_left,
        crop_top,
        crop_left + min_dim,
        crop_top + min_dim,
    )).resize((450, 450))

    return jpeg(original), jpeg(square)
