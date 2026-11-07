from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal
from serviceshared.batcher import Batcher
from serviceshared.commonsql import notification_due_sql
from serviceshared.database import api_tx
from serviceshared.duoenv.api import NOTIFICATION_DUE_FLUSH_SECONDS

_EVENTS = """
SELECT * FROM unnest(%(person_ids)s::INT[], %(event_ats)s::TIMESTAMPTZ[])
"""


@dataclass
class NotificationDue:
    person_id: int
    kind: Literal['intro', 'chat', 'visitor']
    event_at: datetime


async def _process_batch(batch: list[NotificationDue]) -> None:
    try:
        async with api_tx('read committed') as tx:
            for kind in sorted({n.kind for n in batch}):
                due = [n for n in batch if n.kind == kind]
                await tx.execute(notification_due_sql(kind, _EVENTS), dict(
                    person_ids=[n.person_id for n in due],
                    event_ats=[n.event_at for n in due],
                ))
    except Exception:
        for n in batch:
            _batcher.enqueue(n)
        raise


_batcher = Batcher[NotificationDue](
    process_fn=_process_batch,
    flush_interval=NOTIFICATION_DUE_FLUSH_SECONDS,
    max_batch_size=10_000,
)


def enqueue_notification_due(
    person_id: int,
    kind: Literal['intro', 'chat', 'visitor'],
) -> None:
    _batcher.enqueue(NotificationDue(
        person_id=person_id,
        kind=kind,
        event_at=datetime.now(timezone.utc),
    ))
