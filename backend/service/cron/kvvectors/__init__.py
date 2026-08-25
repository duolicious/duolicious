"""Backfill matching vectors for people the application has not refreshed.

Profile changes refresh a person's vectors immediately (see
serviceshared.kvmatching), so this exists for the cases nothing else covers:
a newly deployed weight artifact, which invalidates everyone, and any person
whose vectors were somehow missed. It walks the table oldest-computed-first,
so new people -- whose kv_vector_computed_at is still the epoch -- sort to
the front.
"""
import asyncio
import logging
import random

from psycopg.errors import DeadlockDetected, QueryCanceled

from serviceshared.database import api_tx
from serviceshared.duoenv.cron import (
    KV_VECTORS_BATCH_SIZE,
    KV_VECTORS_POLL_SECONDS,
    KV_VECTORS_WRITE_TIMEOUT_MS,
)
from serviceshared.kvmatching import refresh_vectors
from serviceshared.kvmatching.sql import Q_STALE_PEOPLE
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY

logger = logging.getLogger(__name__)


async def refresh_kv_vectors_once() -> None:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_STALE_PEOPLE, dict(batch_size=KV_VECTORS_BATCH_SIZE))
        person_ids = [int(row['id']) for row in await tx.fetchall()]

    if not person_ids:
        return

    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(
                f'SET LOCAL statement_timeout = {KV_VECTORS_WRITE_TIMEOUT_MS}')
            written = await refresh_vectors(tx, person_ids)
    except (DeadlockDetected, QueryCanceled):
        logger.warning('backfilling kv vectors: batch timed out or deadlocked')
        return

    logger.info(f'backfilled {written} kv vectors')


async def refresh_kv_vectors_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_kv_vectors_once)
        await asyncio.sleep(KV_VECTORS_POLL_SECONDS)
