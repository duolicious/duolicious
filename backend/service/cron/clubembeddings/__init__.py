import asyncio
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

_SWEEP_LOG_INTERVAL = 10_000


async def refresh_club_embeddings_once() -> None:
    if not is_offpeak(
            OFFPEAK_MAX_LOAD_PCT, 'refresh_club_embeddings_once'):
        return

    changed = await asyncio.to_thread(
        run_with_timeout,
        CLUB_EMBEDDINGS_COMPUTE_TIMEOUT_SECONDS,
        compute_club_embeddings,
    )

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
        logger.info(f'club_embeddings: wrote {len(names)}')

    swept = 0
    logged = 0
    while True:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_REFRESH_STALE_CLUB_VECTORS_BATCH, dict(
                batch_size=CLUB_EMBEDDINGS_WRITE_BATCH_SIZE,
            ))
            batch_swept = tx.rowcount
        swept += batch_swept
        if swept - logged >= _SWEEP_LOG_INTERVAL:
            logger.info(f'club_embeddings: re-pooled {swept} people so far')
            logged = swept
        if batch_swept < CLUB_EMBEDDINGS_WRITE_BATCH_SIZE:
            break

    if swept:
        logger.info(f'club_embeddings: re-pooled {swept} people')


async def refresh_club_embeddings_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_club_embeddings_once)
        await asyncio.sleep(CLUB_EMBEDDINGS_POLL_SECONDS)
