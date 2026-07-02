from typing import List
from dataclasses import dataclass
from database import Tx
from functools import lru_cache

Q_SET_MESSAGED = """
INSERT INTO messaged (
    subject_person_id,
    object_person_id
) VALUES (
    %(from_id)s,
    %(to_id)s
) ON CONFLICT DO NOTHING
"""


@dataclass(frozen=True)
class SetMessagedJob:
    from_id: int
    to_id: int


async def process_set_messaged_batch(tx: Tx, batch: List[SetMessagedJob]) -> None:
    distinct_messaged = set(batch)

    params_seq = [
            dict(from_id=m.from_id, to_id=m.to_id)
            for m in distinct_messaged]

    await tx.executemany(Q_SET_MESSAGED, params_seq)
