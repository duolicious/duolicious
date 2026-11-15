from collections.abc import Awaitable, Callable
from dataclasses import dataclass

_ITERATIONS = 5
_SEARCH_CEILING_KM = 10000.0
_UNREACHABLE_CANDIDATES = 10 ** 9
_MAX_PREFERENCE_KM = 8000


@dataclass(frozen=True)
class Target:
    candidates: int
    is_treated: bool

    @property
    def limit(self) -> int:
        return self.candidates * 2

    @property
    def minimum(self) -> int:
        return self.candidates // 2


CONTROL_TARGET = Target(candidates=1000, is_treated=False)
TREATED_TARGET = Target(candidates=500, is_treated=True)


@dataclass(frozen=True)
class Candidates:
    distance_km: float
    count: int


def _closeness(candidates: Candidates, target: Target) -> tuple[int, float]:
    return abs(candidates.count - target.candidates), candidates.distance_km


async def _nearest_pair_search(
    count_within: Callable[[float], Awaitable[int]],
    target: Target,
) -> Candidates:
    points = [
        Candidates(0.0, 0),
        Candidates(_SEARCH_CEILING_KM, _UNREACHABLE_CANDIDATES),
    ]
    midpoint = points[-1]

    for _ in range(_ITERATIONS):
        nearest = sorted(points, key=lambda p: _closeness(p, target))[:2]

        distance_km = sum(p.distance_km for p in nearest) / 2
        midpoint = Candidates(distance_km, await count_within(distance_km))
        points = nearest + [midpoint]

    return midpoint


async def _binary_search(
    count_within: Callable[[float], Awaitable[int]],
    target: Target,
) -> Candidates:
    below = Candidates(0.0, 0)
    above = Candidates(_SEARCH_CEILING_KM, _UNREACHABLE_CANDIDATES)
    tried: list[Candidates] = []

    for _ in range(_ITERATIONS):
        distance_km = (below.distance_km + above.distance_km) / 2
        midpoint = Candidates(distance_km, await count_within(distance_km))
        tried.append(midpoint)
        if midpoint.count < target.candidates:
            below = midpoint
        else:
            above = midpoint

    return min(
        (p for p in (below, above) if p in tried),
        key=lambda p: _closeness(p, target),
    )


async def best_distance(
    count_within: Callable[[float], Awaitable[int]],
    target: Target,
) -> Candidates:
    search = _binary_search if target.is_treated else _nearest_pair_search
    return await search(count_within, target)


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
    if candidates.distance_km > _MAX_PREFERENCE_KM and target.is_treated:
        return None
    if candidates.distance_km > _MAX_PREFERENCE_KM:
        return _MAX_PREFERENCE_KM
    if is_joining_club:
        return None
    return candidates.distance_km
