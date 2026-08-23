import asyncio
import itertools
import logging
import random

from serviceshared.commonsql import Q_REFRESH_STALE_CLUB_VECTORS_BATCH
from serviceshared.database import api_tx
from serviceshared.util import is_offpeak
from serviceshared.util.timeout import run_with_timeout
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from service.cron.clubembeddings.snapshot import compute_club_embeddings
from service.cron.clubembeddings.sql import (
    Q_CLUB_OVERLAP_SEARCH_DELETE,
    Q_CLUB_OVERLAP_SEARCH_REBUILD,
    Q_STAMP_CLUB_EMBEDDING_REFRESH,
    Q_UPDATE_CLUB_EMBEDDINGS,
)
from serviceshared.duoenv.cron import (
    CLUB_EMBEDDINGS_COMPUTE_TIMEOUT_SECONDS,
    CLUB_EMBEDDINGS_POLL_SECONDS,
    CLUB_EMBEDDINGS_WRITE_BATCH_SIZE,
    CLUB_OVERLAP_SEARCH_POLL_SECONDS,
    CLUB_VECTOR_REPOOL_POLL_SECONDS,
    OFFPEAK_MAX_LOAD_PCT,
)

logger = logging.getLogger(__name__)


async def refresh_club_embeddings_once() -> None:
    if not is_offpeak(
            OFFPEAK_MAX_LOAD_PCT, 'refresh_club_embeddings_once'):
        return

    logger.info(
        f'computing embeddings: started '
        f'(timeout {CLUB_EMBEDDINGS_COMPUTE_TIMEOUT_SECONDS}s)')

    computed = await asyncio.to_thread(
        run_with_timeout,
        CLUB_EMBEDDINGS_COMPUTE_TIMEOUT_SECONDS,
        compute_club_embeddings,
    )
    changed = computed.changed
    logger.info(
        f'computing embeddings: finished; '
        f'embedded {computed.embedded_count} clubs '
        f'from {computed.membership_count} memberships; '
        f'{len(changed)} changed materially')

    names = sorted(changed)
    for i in range(0, len(names), CLUB_EMBEDDINGS_WRITE_BATCH_SIZE):
        batch = names[i:i + CLUB_EMBEDDINGS_WRITE_BATCH_SIZE]

        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_UPDATE_CLUB_EMBEDDINGS, dict(
                names=batch,
                embeddings=[changed[name] for name in batch],
            ))

    if names:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_STAMP_CLUB_EMBEDDING_REFRESH)
        logger.info(f'wrote {len(names)} embeddings')


async def repool_club_vectors_once() -> None:
    swept = 0
    for i in itertools.count(1):
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_REFRESH_STALE_CLUB_VECTORS_BATCH, dict(
                batch_size=CLUB_EMBEDDINGS_WRITE_BATCH_SIZE,
            ))
            batch_swept = tx.rowcount
        swept += batch_swept
        if i % 1000 == 0:
            logger.info(f're-pooling people: {i} batches so far')
        if batch_swept < CLUB_EMBEDDINGS_WRITE_BATCH_SIZE:
            break

    if swept:
        logger.info(
            f're-pooling people: finished; '
            f'{swept} re-pooled in {i} batches')


async def refresh_club_overlap_search_once() -> None:
    if not is_offpeak(
            OFFPEAK_MAX_LOAD_PCT, 'refresh_club_overlap_search_once'):
        return

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 600000')
        await tx.execute("SET LOCAL work_mem = '256MB'")
        await tx.execute(Q_CLUB_OVERLAP_SEARCH_DELETE)
        await tx.execute(Q_CLUB_OVERLAP_SEARCH_REBUILD)
        rebuilt = tx.rowcount
    logger.info(f'club_overlap_search: rebuilt {rebuilt} pairs')


async def refresh_club_embeddings_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_club_embeddings_once)
        await asyncio.sleep(CLUB_EMBEDDINGS_POLL_SECONDS)


async def repool_club_vectors_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(repool_club_vectors_once)
        await asyncio.sleep(CLUB_VECTOR_REPOOL_POLL_SECONDS)


async def refresh_club_overlap_search_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_club_overlap_search_once)
        await asyncio.sleep(CLUB_OVERLAP_SEARCH_POLL_SECONDS)
