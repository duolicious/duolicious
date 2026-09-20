import unittest
from service.api.location import snap_to_grid


class TestSnapToGrid(unittest.TestCase):
    def test_snapping_is_idempotent(self) -> None:
        snapped = snap_to_grid(-33.87, 151.21)
        self.assertEqual(snap_to_grid(**snapped), snapped)

    def test_snapped_point_is_within_half_a_cell(self) -> None:
        snapped = snap_to_grid(-33.87, 151.21)
        self.assertLess(abs(snapped['lat'] + 33.87), 0.0225)
        self.assertLess(abs(snapped['lon'] - 151.21), 0.0275)

    def test_poles_stay_in_range(self) -> None:
        self.assertEqual(snap_to_grid(90, 45), dict(lat=90, lon=0))
        self.assertEqual(snap_to_grid(-90, -45), dict(lat=-90, lon=0))


if __name__ == '__main__':
    unittest.main()
