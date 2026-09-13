from collections.abc import Iterable

from serviceshared.database import Tx, row_int_list_or_none
from serviceshared.gold.sql import Q_SYNC_GOLD


async def sync_gold(tx: Tx, person_ids: Iterable[int]) -> None:
    row = await tx.require_one(Q_SYNC_GOLD, dict(person_ids=list(person_ids)))
    tx.attribute(row_int_list_or_none(row, 'evicted_person_ids') or [])
