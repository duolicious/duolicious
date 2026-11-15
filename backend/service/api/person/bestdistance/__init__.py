from collections.abc import Awaitable, Callable
from dataclasses import dataclass

_ITERATIONS = 5
_SEARCH_CEILING_KM = 10000.0
_UNREACHABLE_CANDIDATES = 10 ** 9
_MAX_PREFERENCE_KM = 8000


@dataclass(frozen=True)
class Target:
    candidates: int
    nearest_tried: bool

    @property
    def limit(self) -> int:
        return self.candidates * 2

    @property
    def minimum(self) -> int:
        return self.candidates // 2


CONTROL_TARGET = Target(candidates=1000, nearest_tried=False)
TREATED_TARGET = Target(candidates=500, nearest_tried=True)


@dataclass(frozen=True)
class Candidates:
    distance_km: float
    count: int


async def best_distance(
    count_within: Callable[[float], Awaitable[int]],
    target: Target,
) -> Candidates:
    def closeness(candidates: Candidates) -> tuple[int, float]:
        return abs(candidates.count - target.candidates), candidates.distance_km

    points = [
        Candidates(0.0, 0),
        Candidates(_SEARCH_CEILING_KM, _UNREACHABLE_CANDIDATES),
    ]
    tried: list[Candidates] = []

    for _ in range(_ITERATIONS):
        nearest = sorted(points, key=closeness)[:2]

        distance_km = sum(p.distance_km for p in nearest) / 2
        midpoint = Candidates(distance_km, await count_within(distance_km))
        tried.append(midpoint)
        points = nearest + [midpoint]

    return min(tried, key=closeness) if target.nearest_tried else tried[-1]


async def best_country_and_distance(
    count_within: Callable[[float, bool], Awaitable[int]],
    target: Target,
) -> tuple[bool, Candidates]:
    for same_country_only in (True, False):
        candidates = await best_distance(
            lambda distance_km: count_within(distance_km, same_country_only),
            target,
        )
        if candidates.count >= target.minimum:
            return same_country_only, candidates
    return False, candidates


def distance_preference(
    candidates: Candidates,
    target: Target,
    is_joining_club: bool,
) -> float | None:
    if candidates.count < target.minimum:
        return None
    if candidates.distance_km > _MAX_PREFERENCE_KM:
        return _MAX_PREFERENCE_KM
    if is_joining_club:
        return None
    return candidates.distance_km
