import asyncio
import unittest
from service.api.person.bestdistance import (
    CONTROL_TARGET,
    TREATED_TARGET,
    Candidates,
    Target,
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
