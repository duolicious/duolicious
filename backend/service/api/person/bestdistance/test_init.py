import asyncio
import unittest
from service.api.person.bestdistance import (
    Candidates,
    Target,
    best_distance,
)


async def count_within(distance_km: float) -> int:
    return min(2000, round(distance_km * 1.7))


class TestBestDistance(unittest.TestCase):
    def test_returns_nearest_tried_point(self) -> None:
        for nearest_tried, expected in [
            (False, Candidates(312.5, 531)),
            (True, Candidates(625.0, 1062)),
        ]:
            with self.subTest(nearest_tried=nearest_tried):
                self.assertEqual(
                    asyncio.run(best_distance(
                        count_within,
                        Target(candidates=1000, nearest_tried=nearest_tried),
                    )),
                    expected,
                )


if __name__ == '__main__':
    unittest.main()
