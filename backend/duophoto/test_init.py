from duophoto import (
    CropSize,
    PhotoGeometry,
    find_crop,
    orient_image,
    photo_geometry,
)
from PIL import Image, ImageDraw
import io
import random
import unittest

def _photo(width: int, height: int, seed: int) -> Image.Image:
    # Busy and non-repeating: a flat or tiled image would leave the crop offset
    # genuinely ambiguous, which is a property of the photo, not the search.
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

def _jpeg(image: Image.Image) -> Image.Image:
    buffer = io.BytesIO()
    image.save(buffer, format='jpeg', quality=85, subsampling=2)
    buffer.seek(0)
    return Image.open(buffer)

# What the upload path leaves in the object store for a given crop.
def _renditions(
    original: Image.Image,
    crop_left: int,
    crop_top: int,
) -> tuple[Image.Image, Image.Image]:
    min_dim = min(original.size)
    square = original.crop((
        crop_left,
        crop_top,
        crop_left + min_dim,
        crop_top + min_dim,
    )).resize((450, 450))

    return _jpeg(original), _jpeg(square)

class TestPhotoGeometry(unittest.TestCase):
    def test_centres_the_crop_when_none_is_given(self) -> None:
        # 500x500 out of the middle of a 1000x500.
        self.assertEqual(
            photo_geometry(1000, 500),
            PhotoGeometry(width=1000, height=500, crop_top=0, crop_left=250),
        )

    def test_clamps_a_crop_that_runs_off_the_edge(self) -> None:
        # The only freedom is along the longer axis, and only as far as the
        # square still fits.
        self.assertEqual(
            photo_geometry(1000, 500, CropSize(top=99, left=9999)).crop_left,
            500,
        )
        self.assertEqual(
            photo_geometry(1000, 500, CropSize(top=99, left=-50)).crop_left,
            0,
        )
        self.assertEqual(
            photo_geometry(1000, 500, CropSize(top=99, left=100)).crop_top,
            0,
        )

    def test_leaves_a_square_photo_uncropped(self) -> None:
        geometry = photo_geometry(600, 600, CropSize(top=10, left=10))
        self.assertEqual((geometry.crop_top, geometry.crop_left), (0, 0))

class TestFindCrop(unittest.TestCase):
    # Recovering the offset to within a pixel or two is plenty: a couple of
    # pixels of a multi-thousand-pixel photo is a fraction of a screen pixel
    # once the preview is drawn.
    TOLERANCE_PX = 2

    def assert_recovers(
        self,
        width: int,
        height: int,
        crop_left: int,
        crop_top: int,
    ) -> None:
        original = _photo(width, height, seed=width * 7 + height + crop_left)
        original_jpeg, square_jpeg = _renditions(original, crop_left, crop_top)

        geometry, difference = find_crop(original_jpeg, square_jpeg)

        self.assertEqual((geometry.width, geometry.height), (width, height))
        self.assertLessEqual(abs(geometry.crop_left - crop_left), self.TOLERANCE_PX)
        self.assertLessEqual(abs(geometry.crop_top - crop_top), self.TOLERANCE_PX)
        self.assertLess(difference, 24.0)

    def test_recovers_a_centred_landscape_crop(self) -> None:
        self.assert_recovers(1200, 800, crop_left=200, crop_top=0)

    def test_recovers_a_crop_dragged_to_either_edge(self) -> None:
        self.assert_recovers(1200, 800, crop_left=0, crop_top=0)
        self.assert_recovers(1200, 800, crop_left=400, crop_top=0)

    def test_recovers_an_arbitrary_landscape_crop(self) -> None:
        self.assert_recovers(1200, 800, crop_left=137, crop_top=0)

    def test_recovers_portrait_crops_which_slide_vertically(self) -> None:
        self.assert_recovers(800, 1200, crop_left=0, crop_top=0)
        self.assert_recovers(800, 1200, crop_left=0, crop_top=213)
        self.assert_recovers(800, 1200, crop_left=0, crop_top=400)

    def test_recovers_a_crop_from_a_large_photo(self) -> None:
        self.assert_recovers(3000, 2000, crop_left=731, crop_top=0)

    def test_reports_a_square_photo_as_uncropped(self) -> None:
        original = _photo(900, 900, seed=1)
        original_jpeg, square_jpeg = _renditions(original, 0, 0)

        geometry, difference = find_crop(original_jpeg, square_jpeg)

        self.assertEqual((geometry.crop_top, geometry.crop_left), (0, 0))
        self.assertEqual(difference, 0.0)

    def test_agrees_with_the_geometry_the_upload_path_would_have_recorded(self) -> None:
        # The forward and backward directions have to describe the same crop,
        # otherwise backfilled photos would animate differently to new ones.
        crop = CropSize(top=0, left=317)
        original = _photo(1400, 900, seed=99)

        expected = photo_geometry(*orient_image(original).size, crop)

        original_jpeg, square_jpeg = _renditions(original, crop.left, crop.top)
        recovered, _ = find_crop(original_jpeg, square_jpeg)

        self.assertEqual(recovered.width, expected.width)
        self.assertEqual(recovered.height, expected.height)
        self.assertLessEqual(
            abs(recovered.crop_left - expected.crop_left),
            self.TOLERANCE_PX,
        )

    def test_reports_a_bad_match_rather_than_guessing(self) -> None:
        # A square that isn't from this photo at all. The reported difference is
        # what stops the backfill recording a crop that would make the photo
        # jump when expanded.
        original = _jpeg(_photo(1200, 800, seed=1))
        unrelated = _jpeg(_photo(800, 800, seed=2).resize((450, 450)))

        _, difference = find_crop(original, unrelated)

        self.assertGreater(difference, 24.0)

if __name__ == '__main__':
    unittest.main()
