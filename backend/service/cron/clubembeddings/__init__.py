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
    Q_STAMP_CLUB_EMBEDDING_REFRESH,
    Q_UPDATE_CLUB_EMBEDDINGS,
)
from serviceshared.duoenv.cron import (
    CLUB_EMBEDDINGS_COMPUTE_TIMEOUT_SECONDS,
    CLUB_EMBEDDINGS_POLL_SECONDS,
    CLUB_EMBEDDINGS_WRITE_BATCH_SIZE,
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

    logger.info('storing embeddings in db: started')
    names = sorted(changed)
    for i in range(0, len(names), CLUB_EMBEDDINGS_WRITE_BATCH_SIZE):
        batch = names[i:i + CLUB_EMBEDDINGS_WRITE_BATCH_SIZE]

        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_UPDATE_CLUB_EMBEDDINGS, dict(
                names=batch,
                embeddings=[changed[name] for name in batch],
            ))
        logger.info(f'storing embeddings in db: batch {i}')
    logger.info('storing embeddings in db: finished')

    if names:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_STAMP_CLUB_EMBEDDING_REFRESH)
        logger.info(f'refreshed {len(names)} embeddings')

    logger.info('re-pooling people: started')
    for i in itertools.count(1):
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_REFRESH_STALE_CLUB_VECTORS_BATCH, dict(
                batch_size=CLUB_EMBEDDINGS_WRITE_BATCH_SIZE,
            ))
            batch_swept = tx.rowcount
        if i % 10 == 0:
            logger.info(f're-pooling people: {i * CLUB_EMBEDDINGS_WRITE_BATCH_SIZE} people so far')
        if batch_swept < CLUB_EMBEDDINGS_WRITE_BATCH_SIZE:
            break

    logger.info(f're-pooling people: finished after {i} batches')


async def refresh_club_embeddings_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_club_embeddings_once)
        await asyncio.sleep(CLUB_EMBEDDINGS_POLL_SECONDS)
