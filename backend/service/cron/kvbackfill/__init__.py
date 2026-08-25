"""One-off backfill of person.kv_vector and its cached preactivations.

People who change anything about their profile get their vectors filled in
as they go (see serviceshared.kvmatching.refresh), so this exists only to
catch up everyone who existed before that started. It finds them by their
NULL kv_who_pre, and refreshes each person in their own transaction so a
batch never holds locks that block a concurrent forward-fill; a person
whose transaction conflicts anyway is simply picked up again on a later
pass.

Delete this once it has run to completion in production. It is also how to
re-vectorise everyone after deploying new model weights: revert the
deletion and NULL the kv_who_pre/kv_look_pre columns.
"""
import asyncio
import logging

from psycopg.errors import DeadlockDetected, QueryCanceled, SerializationFailure

from serviceshared.database import api_tx, row_int
from serviceshared.duoenv.cron import (
    KV_BACKFILL_BATCH_SIZE,
    KV_BACKFILL_POLL_SECONDS,
    KV_BACKFILL_WRITE_TIMEOUT_MS,
)
from serviceshared.kvmatching.refresh import build_vectors
from service.cron.cronutil import log_stacktrace
from service.cron.kvbackfill.sql import Q_UNCOMPUTED_COUNT, Q_UNCOMPUTED_PEOPLE

logger = logging.getLogger(__name__)


async def _count_uncomputed() -> int:
    async with api_tx('READ COMMITTED') as tx:
        return row_int(await tx.require_one(Q_UNCOMPUTED_COUNT), 'n')


async def _log_backlog() -> None:
    logger.info(f'{await _count_uncomputed()} people to backfill')


async def backfill_kv_vectors_once(total: int) -> int:
    """Backfill one batch and return the updated running total."""
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(
            Q_UNCOMPUTED_PEOPLE, dict(batch_size=KV_BACKFILL_BATCH_SIZE))
        person_ids = [int(row['id']) for row in await tx.fetchall()]

    if not person_ids:
        return total

    remaining = await _count_uncomputed()

    written = 0
    conflicted = 0
    for person_id in person_ids:
        try:
            async with api_tx() as tx:
                await tx.execute(
                    f'SET LOCAL statement_timeout = {KV_BACKFILL_WRITE_TIMEOUT_MS}')
                await build_vectors(tx, person_id)
            written += 1
        except (DeadlockDetected, QueryCanceled, SerializationFailure):
            conflicted += 1
            logger.warning(f'person {person_id} conflicted; will retry')

    total += written
    conflicts = f' ({conflicted} conflicted)' if conflicted else ''
    logger.info(
        f'backfilled {written} of {len(person_ids)} in this batch{conflicts}; '
        f'{total} since start, about {remaining - written} to go')
    return total


async def backfill_kv_vectors_forever() -> None:
    # Says something at every stage of life -- freshly booted, working, and
    # already finished -- so silence always means misconfigured, not idle.
    logger.info(
        f'started; polling every {KV_BACKFILL_POLL_SECONDS}s '
        f'in batches of up to {KV_BACKFILL_BATCH_SIZE}')
    await log_stacktrace(_log_backlog)

    total = 0

    async def next_batch() -> None:
        nonlocal total
        total = await backfill_kv_vectors_once(total)

    while True:
        await log_stacktrace(next_batch)
        await asyncio.sleep(KV_BACKFILL_POLL_SECONDS)
