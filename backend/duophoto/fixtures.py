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

# Fine detail rather than broad shapes: hair, foliage, fabric weave. The 450
# square can't hold it, so the two renditions of the same frame genuinely differ
# pixel for pixel however well the crop is aligned.
def detailed_photo(width: int, height: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    image = photo(width, height, seed)
    draw = ImageDraw.Draw(image)

    for _ in range(45000):
        x, y = rng.randint(0, width), rng.randint(0, height)
        draw.line(
            [x, y, x + rng.randint(-14, 14), y + rng.randint(-14, 14)],
            fill=(rng.randint(0, 255), rng.randint(0, 255), rng.randint(0, 255)),
            width=2,
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

# A transparent upload: a subject over an alpha-0 background, which JPEG can't
# hold, so each rendition flattens it onto some matte colour.
def transparent_photo(width: int, height: int, seed: int) -> Image.Image:
    rng = random.Random(seed)
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    for _ in range(120):
        x = rng.randint(width // 6, 5 * width // 6)
        y = rng.randint(height // 6, 5 * height // 6)
        draw.ellipse(
            [x, y, x + rng.randint(15, 90), y + rng.randint(15, 90)],
            fill=(rng.randint(30, 220), rng.randint(30, 220), rng.randint(30, 220), 255),
        )

    return image

def flatten(image: Image.Image, matte: tuple[int, int, int]) -> Image.Image:
    canvas = Image.new('RGB', image.size, matte)
    canvas.paste(image, mask=image.getchannel('A'))
    return canvas

# Renditions as the historical pipeline left them for transparent uploads: the
# original matted onto one colour, the square crop onto another. The colours
# aren't fixed in prod - whatever RGB sat under the alpha channel is what the
# rendition kept - so they're a parameter here too.
def mismatched_matte_renditions(
    original: Image.Image,
    crop_left: int,
    crop_top: int,
    original_matte: tuple[int, int, int] = (255, 255, 255),
    square_matte: tuple[int, int, int] = (0, 0, 0),
) -> tuple[bytes, bytes]:
    min_dim = min(original.size)
    square = flatten(original, square_matte).crop((
        crop_left,
        crop_top,
        crop_left + min_dim,
        crop_top + min_dim,
    )).resize((450, 450))

    return jpeg(flatten(original, original_matte)), jpeg(square)
