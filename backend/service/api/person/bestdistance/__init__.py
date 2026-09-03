from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from serviceshared.util.round import round_half_up

TARGET_CANDIDATES = 2000
CANDIDATE_LIMIT = TARGET_CANDIDATES * 2

_ITERATIONS = 5
_SEARCH_CEILING_KM = 10000.0
_UNREACHABLE_CANDIDATES = 10 ** 9
_MIN_CANDIDATES = 500
_MAX_PREFERENCE_KM = 8000


@dataclass(frozen=True)
class Candidates:
    distance_km: float
    count: int


async def best_distance(
    count_within: Callable[[float], Awaitable[int]],
) -> Candidates:
    points = [
        Candidates(0.0, 0),
        Candidates(_SEARCH_CEILING_KM, _UNREACHABLE_CANDIDATES),
    ]
    midpoint = points[-1]

    for _ in range(_ITERATIONS):
        nearest = sorted(
            points,
            key=lambda p: (abs(p.count - TARGET_CANDIDATES), p.distance_km),
        )[:2]

        distance_km = sum(p.distance_km for p in nearest) / 2
        midpoint = Candidates(distance_km, await count_within(distance_km))
        points = nearest + [midpoint]

    return midpoint


def distance_preference(
    candidates: Candidates,
    is_joining_club: bool,
) -> int | None:
    if candidates.count < _MIN_CANDIDATES:
        return None
    if candidates.distance_km > _MAX_PREFERENCE_KM:
        return _MAX_PREFERENCE_KM
    if is_joining_club:
        return None
    return round_half_up(candidates.distance_km)
