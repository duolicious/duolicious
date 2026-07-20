from duophoto import CropSize, PhotoGeometry, photo_geometry
import unittest

class TestPhotoGeometry(unittest.TestCase):
    def test_centres_the_crop_when_none_is_given(self) -> None:
        self.assertEqual(
            photo_geometry(1000, 500),
            PhotoGeometry(width=1000, height=500, crop_top=0, crop_left=250),
        )

    def test_clamps_a_crop_that_runs_off_the_edge(self) -> None:
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

if __name__ == '__main__':
    unittest.main()
