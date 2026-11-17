from collections.abc import Awaitable, Callable
from dataclasses import dataclass

CONTROL_TARGET = 500
TREATED_TARGET = CONTROL_TARGET // 2

_ITERATIONS = 5
_SEARCH_CEILING_KM = 10000.0
_UNREACHABLE_CANDIDATES = 10 ** 9
_MAX_PREFERENCE_KM = 8000


@dataclass(frozen=True)
class Candidates:
    distance_km: float
    count: int


NO_CANDIDATES = Candidates(0.0, 0)


def candidate_limit(target: int) -> int:
    return target * 2


def _minimum(target: int) -> int:
    return target // 2


async def best_distance(
    count_within: Callable[[float], Awaitable[int]],
    target: int,
) -> Candidates:
    below = NO_CANDIDATES
    above = Candidates(_SEARCH_CEILING_KM, _UNREACHABLE_CANDIDATES)
    tried: list[Candidates] = []

    for _ in range(_ITERATIONS):
        distance_km = (below.distance_km + above.distance_km) / 2
        midpoint = Candidates(distance_km, await count_within(distance_km))
        tried.append(midpoint)
        if midpoint.count < target:
            below = midpoint
        else:
            above = midpoint

    return min(
        (p for p in (below, above) if p in tried),
        key=lambda p: (
            p.count < _minimum(target),
            abs(p.count - target),
            p.distance_km,
        ),
    )


async def best_country_and_distance(
    count_within: Callable[[float, bool], Awaitable[int]],
    target: int,
) -> tuple[bool, Candidates]:
    for same_country_only in (True, False):
        candidates = await best_distance(
            lambda distance_km: count_within(distance_km, same_country_only),
            target,
        )
        if candidates.count >= _minimum(target):
            return same_country_only, candidates
    return False, candidates


def distance_preference(
    candidates: Candidates,
    target: int,
    is_joining_club: bool,
) -> float | None:
    if candidates.count < _minimum(target):
        return None
    if candidates.distance_km > _MAX_PREFERENCE_KM:
        return None
    if is_joining_club:
        return None
    return candidates.distance_km
