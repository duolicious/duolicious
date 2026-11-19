import asyncio
import unittest
from service.api.person.bestdistance import (
    Candidates,
    best_country_and_distance,
    best_distance,
    distance_preference,
)


class TestBestDistance(unittest.TestCase):
    def test_returns_nearest_bracket(self) -> None:
        async def count_within(distance_km: float) -> int:
            return min(1000, round(distance_km * 0.85))

        self.assertEqual(
            asyncio.run(best_distance(count_within)),
            Candidates(625.0, 531),
        )

    def test_skips_distance_below_minimum(self) -> None:
        async def count_within(distance_km: float) -> int:
            return 100 if distance_km < 400 else 1000

        self.assertEqual(
            asyncio.run(best_distance(count_within)),
            Candidates(625.0, 1000),
        )

    def test_falls_back_to_any_country(self) -> None:
        async def count_within(distance_km: float, same_country_only: bool) -> int:
            return 0 if same_country_only else round(distance_km)

        self.assertEqual(
            asyncio.run(best_country_and_distance(count_within)),
            (False, Candidates(625.0, 625)),
        )

    def test_has_no_limit_past_max(self) -> None:
        self.assertIsNone(distance_preference(
            Candidates(9000.0, 1000),
            is_joining_club=False,
        ))


if __name__ == '__main__':
    unittest.main()
