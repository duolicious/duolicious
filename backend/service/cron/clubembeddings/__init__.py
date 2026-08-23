import asyncio
import logging
import random

from psycopg.errors import DeadlockDetected, QueryCanceled
from serviceshared.database import api_tx
from serviceshared.util import is_offpeak
from serviceshared.util.timeout import run_in_subprocess
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from service.cron.clubembeddings.snapshot import compute_club_embeddings
from service.cron.clubembeddings.sql import (
    Q_QUEUE_MEMBER_CLUB_VECTOR_REFRESHES,
    Q_REFRESH_QUEUED_CLUB_VECTORS,
    Q_UPDATE_CLUB_EMBEDDINGS,
)
from serviceshared.duoenv.cron import (
    CLUB_EMBEDDINGS_POLL_SECONDS,
    CLUB_EMBEDDINGS_WRITE_BATCH_SIZE,
    CLUB_VECTOR_REPOOL_BATCH_SIZE,
    CLUB_VECTOR_REPOOL_POLL_SECONDS,
    OFFPEAK_MAX_LOAD_PCT,
)

logger = logging.getLogger(__name__)


async def refresh_club_embeddings_once() -> None:
    if not is_offpeak(
            OFFPEAK_MAX_LOAD_PCT, 'refresh_club_embeddings_once'):
        return

    logger.info('computing embeddings: started')

    computed = await asyncio.to_thread(
        run_in_subprocess,
        None,
        compute_club_embeddings,
    )
    changed = computed.changed
    logger.info(
        f'computing embeddings: finished; '
        f'embedded {computed.embedded_count} clubs '
        f'from {computed.membership_count} memberships; '
        f'{len(changed)} changed materially')

    names = sorted(changed)
    queued = 0
    logger.info(f'storing embeddings: started ({len(names)} to store)')
    i = 0
    while i < len(names):
        batch = names[i:i + CLUB_EMBEDDINGS_WRITE_BATCH_SIZE]

        try:
            async with api_tx('READ COMMITTED') as tx:
                await tx.execute(Q_UPDATE_CLUB_EMBEDDINGS, dict(
                    names=batch,
                    embeddings=[changed[name] for name in batch],
                ))
                await tx.execute(
                    Q_QUEUE_MEMBER_CLUB_VECTOR_REFRESHES, dict(
                        names=batch,
                    ))
                batch_queued = tx.rowcount
        except (DeadlockDetected, QueryCanceled):
            logger.warning(
                'storing embeddings: batch lost a lock contest; retrying')
            continue

        queued += batch_queued
        i += len(batch)
        logger.info(
            f'storing embeddings: {i} of {len(names)} stored; '
            f'{queued} members queued for re-pooling')

    logger.info(
        f'wrote {len(names)} embeddings; '
        f'queued {queued} members for re-pooling')


async def repool_queued_club_vectors_once() -> None:
    repooled = 0
    while True:
        try:
            async with api_tx('READ COMMITTED') as tx:
                await tx.execute(Q_REFRESH_QUEUED_CLUB_VECTORS, dict(
                    batch_size=CLUB_VECTOR_REPOOL_BATCH_SIZE,
                ))
                batch_repooled = tx.rowcount
        except (DeadlockDetected, QueryCanceled):
            logger.warning(
                're-pooling: batch lost a lock contest; retrying')
            continue
        if batch_repooled:
            repooled += batch_repooled
            logger.info(f're-pooling: {repooled} people so far')
        if batch_repooled < CLUB_VECTOR_REPOOL_BATCH_SIZE:
            break

    if repooled:
        logger.info(
            f're-pooling: finished; '
            f'{repooled} people re-pooled from the refresh queue')


async def refresh_club_embeddings_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_club_embeddings_once)
        await asyncio.sleep(CLUB_EMBEDDINGS_POLL_SECONDS)


async def repool_queued_club_vectors_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(repool_queued_club_vectors_once)
        await asyncio.sleep(CLUB_VECTOR_REPOOL_POLL_SECONDS)
