from collections.abc import Mapping, Sequence
from itertools import zip_longest

import numpy as np
import numpy.typing as npt

from serviceshared.database import Row, row_int, row_str, row_str_or_none, row_vector
from serviceshared.database.tx import Tx
from service.api.person.sql import (
    MAX_SUGGESTED_CLUBS,
    Q_COUNT_JOINED_CLUBS,
    Q_JOINED_CLUB_EMBEDDINGS,
    Q_SUGGESTED_CLUB_CANDIDATES,
)

GROUP_CUTOFF = 0.3

MIN_CLUBS_TO_REFRESH = 10


def club_groups(embeddings: npt.NDArray[np.float64]) -> list[list[int]]:
    unit = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
    similarity = unit @ unit.T
    total = similarity.copy()
    groups = [[i] for i in range(len(unit))]

    while len(groups) > 1:
        sizes = np.array([len(g) for g in groups])
        distance = 1 - total / np.outer(sizes, sizes)
        np.fill_diagonal(distance, np.inf)
        i, j = sorted(np.unravel_index(np.argmin(distance), distance.shape))
        if distance[i, j] >= GROUP_CUTOFF:
            break
        total[i] += total[j]
        total[:, i] += total[:, j]
        total = np.delete(np.delete(total, j, 0), j, 1)
        groups[i] += groups.pop(j)

    return [sorted(g, key=lambda m: -similarity[m, g].mean()) for g in groups]


def slot_quotas(sizes: Sequence[int], slots: int) -> list[int]:
    if len(sizes) >= slots:
        return [1] * slots + [0] * (len(sizes) - slots)
    exact = np.array(sizes) * slots / sum(sizes)
    quotas = np.floor(exact).astype(int)
    remainders = np.argsort(quotas - exact, kind='stable')
    quotas[remainders[:slots - quotas.sum()]] += 1
    return [int(q) for q in quotas]


def take_turns(nearest: Sequence[Sequence[str]], quota: int, taken: set[str]) -> list[str]:
    picks: list[str] = []
    remaining = [iter(names) for names in nearest]
    while remaining and len(picks) < quota:
        for names in list(remaining):
            name = next((n for n in names if n not in taken), None)
            if name is None:
                remaining.remove(names)
                continue
            picks.append(name)
            taken.add(name)
            if len(picks) == quota:
                break
    return picks


Source = tuple[list[str], int]


def suggestion_sources(
    embeddings: Mapping[str, npt.NDArray[np.float32]],
    slots: int,
) -> list[Source]:
    names = list(embeddings)
    groups = club_groups(np.array(list(embeddings.values()))) if names else []
    groups.sort(key=len, reverse=True)
    quotas = slot_quotas([len(g) for g in groups], slots)
    return [([names[m] for m in g[:q]], q) for g, q in zip(groups, quotas) if q]


def pick_suggestions(
    sources: Sequence[Source],
    nearest: Mapping[str, Sequence[str]],
    popular: Sequence[str],
    slots: int,
) -> list[str]:
    taken: set[str] = set()
    per_group = [
        take_turns([nearest.get(s, []) for s in group], quota, taken)
        for group, quota in sources
    ]
    picks = [p for turn in zip_longest(*per_group) for p in turn if p is not None]
    return picks + take_turns([popular], slots - len(picks), taken)


async def suggested_clubs(tx: Tx, person_id: int) -> list[Row]:
    joined = await (await tx.execute(
        Q_JOINED_CLUB_EMBEDDINGS, dict(person_id=person_id))).fetchall()
    sources = suggestion_sources(
        {row_str(r, 'name'): row_vector(r, 'embedding').to_numpy() for r in joined},
        MAX_SUGGESTED_CLUBS,
    )

    rows = await (await tx.execute(
        Q_SUGGESTED_CLUB_CANDIDATES,
        dict(person_id=person_id, sources=[s for g, _ in sources for s in g]),
    )).fetchall()

    nearest: dict[str, list[str]] = {}
    popular: list[str] = []
    count_members: dict[str, int] = {}
    for row in rows:
        source = row_str_or_none(row, 'source')
        name = row_str(row, 'name')
        count_members[name] = row_int(row, 'count_members')
        (popular if source is None else nearest.setdefault(source, [])).append(name)

    return [
        dict(name=n, count_members=count_members[n])
        for n in pick_suggestions(sources, nearest, popular, MAX_SUGGESTED_CLUBS)
    ]


async def refreshed_suggested_clubs(tx: Tx, person_id: int) -> list[Row] | None:
    row = await tx.require_one(Q_COUNT_JOINED_CLUBS, dict(person_id=person_id))
    if row_int(row, 'count') < MIN_CLUBS_TO_REFRESH:
        return None
    return await suggested_clubs(tx, person_id)
