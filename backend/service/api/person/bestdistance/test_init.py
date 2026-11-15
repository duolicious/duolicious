import asyncio
import unittest
from service.api.person.bestdistance import (
    CONTROL_TARGET,
    TREATED_TARGET,
    Candidates,
    Target,
    best_country_and_distance,
    best_distance,
    distance_preference,
)


async def count_within(distance_km: float) -> int:
    return min(2000, round(distance_km * 1.7))


class TestBestDistance(unittest.TestCase):
    def test_treated_returns_nearest_bracket(self) -> None:
        for is_treated, expected in [
            (False, Candidates(312.5, 531)),
            (True, Candidates(625.0, 1062)),
        ]:
            with self.subTest(is_treated=is_treated):
                self.assertEqual(
                    asyncio.run(best_distance(
                        count_within,
                        Target(candidates=1000, is_treated=is_treated),
                    )),
                    expected,
                )

    def test_treated_skips_distance_below_minimum(self) -> None:
        async def count_within(distance_km: float) -> int:
            return 100 if distance_km < 400 else 1000

        self.assertEqual(
            asyncio.run(best_distance(count_within, TREATED_TARGET)),
            Candidates(625.0, 1000),
        )

    def test_falls_back_to_any_country(self) -> None:
        async def count_within(distance_km: float, same_country_only: bool) -> int:
            return 0 if same_country_only else round(distance_km)

        for target, expected in [
            (CONTROL_TARGET, (False, Candidates(937.5, 938))),
            (TREATED_TARGET, (False, Candidates(625.0, 625))),
        ]:
            with self.subTest(target=target):
                self.assertEqual(
                    asyncio.run(best_country_and_distance(count_within, target)),
                    expected,
                )

    def test_treated_has_no_limit_past_max(self) -> None:
        candidates = Candidates(9000.0, 2000)
        for target, expected in [
            (CONTROL_TARGET, 8000),
            (TREATED_TARGET, None),
        ]:
            with self.subTest(target=target):
                self.assertEqual(
                    distance_preference(candidates, target, is_joining_club=False),
                    expected,
                )


if __name__ == '__main__':
    unittest.main()
