from dataclasses import dataclass
from PIL import Image, ImageOps
import numpy

# How a photo's square renditions relate to the original they were cut from.
# Lives here rather than in `person` so the crop backfill
# (`service/cron/photocrop`) can share the definition without importing the API.

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

# Progressively finer widths (px) for `find_crop`: a coarse scan of the whole
# range, then narrow windows around the previous winner, so the cost stays flat
# as the photo gets bigger. Capped at the square's own resolution in
# `find_crop`: comparing above it compares interpolation rather than content.
MATCH_SCALES = (64, 256, 1024)

# Mismatch (0-100, an anti-correlation) above which `find_crop`'s best offset
# isn't believable. Callers that act on the result should treat anything worse
# as "no match" rather than record a crop that would make the photo jump when
# expanded. Over 130 photos the backfill had skipped, correct offsets scored a
# median of 17 and never worse than 75; a square belonging to a different photo
# never scored better than 81, so the two populations don't overlap.
DEFAULT_MAX_MATCH_DIFFERENCE = 75.0

def _greyscale(image: Image.Image, size: tuple[int, int]) -> numpy.ndarray:
    resized = image.convert('L').resize(size, Image.Resampling.BILINEAR)
    return numpy.asarray(resized, dtype=numpy.float32)

# Renditions of the same photo agree about where its edges are and disagree
# about almost everything else. Brightness drifts between encodes; a transparent
# upload's renditions were flattened onto whatever colour happened to sit under
# the alpha, so the same frame comes back white in one and black, grey or orange
# in another. Matching edges rather than pixels sidesteps all of it: a flat matte
# has no edges to contribute whatever its colour, and the subject's silhouette
# against it is an edge in both.
#
# Sobel rather than a bare difference of neighbours: the smoothing the operator
# carries is what keeps JPEG ringing and single-pixel texture - which the two
# renditions were never going to agree about - from swamping the real edges.
def _blur(pixels: numpy.ndarray, axis: int) -> numpy.ndarray:
    shifted = numpy.moveaxis(pixels, axis, 0)
    blurred = shifted.copy()
    blurred[1:-1] = (shifted[:-2] + 2 * shifted[1:-1] + shifted[2:]) / 4.0

    return numpy.moveaxis(blurred, 0, axis)

def _slope(pixels: numpy.ndarray, axis: int) -> numpy.ndarray:
    shifted = numpy.moveaxis(pixels, axis, 0)
    sloped = numpy.zeros_like(shifted)
    sloped[1:-1] = shifted[2:] - shifted[:-2]

    return numpy.moveaxis(sloped, 0, axis)

def _edges(pixels: numpy.ndarray) -> numpy.ndarray:
    return numpy.hypot(
        _slope(_blur(pixels, axis=0), axis=1),
        _slope(_blur(pixels, axis=1), axis=0),
    )

# Correlation rather than a mean absolute difference, because the two renditions
# are never the same picture pixel for pixel: the square has been through a
# smaller JPEG, so its edges are softer and shorter than the original's even
# where they're in exactly the right place. An absolute difference reads that
# softening as disagreement and grows with the resolution it's measured at,
# which made the score depend on how big the photo was rather than on whether
# the crop was right. Both arguments are `_edges` output.
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

    ours = window - window.mean()
    theirs = square - square.mean()

    norm = numpy.sqrt(float((ours * ours).sum()) * float((theirs * theirs).sum()))

    # One of the two is a flat expanse with no edges at all, so there's nothing
    # to line up and no offset is more believable than any other.
    if norm <= 0.0:
        return None

    return (1.0 - float((ours * theirs).sum()) / norm) * 100.0

# The scan quantises offsets to the match resolution, so above the finest
# `MATCH_SCALES` entry the winner is only exact to `1 / scale` original px.
# Fitting a parabola through the difference at the winning scaled offset and
# its neighbours places the minimum between scaled pixels, taking the error
# back down to about a pixel however big the photo is.
def _refined_offset(
    original: numpy.ndarray,
    square: numpy.ndarray,
    scale: float,
    limit: int,
    horizontal: bool,
    best_offset: int,
    span: int,
) -> int:
    if scale >= 1:
        return best_offset

    scaled = min(limit, max(0, round(best_offset * scale)))

    if scaled <= 0 or scaled >= limit:
        return best_offset

    below = _difference(original, square, scaled - 1, horizontal)
    at = _difference(original, square, scaled, horizontal)
    above = _difference(original, square, scaled + 1, horizontal)

    if below is None or at is None or above is None:
        return best_offset

    curvature = below - 2 * at + above

    if curvature <= 0:
        return best_offset

    vertex = min(1.0, max(-1.0, 0.5 * (below - above) / curvature))

    return min(span, max(0, round((scaled + vertex) / scale)))

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
        size = min(scale_size, min_dim, min(square.size))
        scale = size / min_dim

        scaled = (
            max(size, round(width * scale)),
            max(size, round(height * scale)),
        )

        original_pixels = _edges(_greyscale(original, scaled))
        square_pixels = _edges(_greyscale(square, (size, size)))

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

    best_offset = _refined_offset(
        original_pixels,
        square_pixels,
        scale,
        limit,
        horizontal,
        best_offset,
        span,
    )

    return geometry_at(best_offset), best_difference
