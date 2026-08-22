import asyncio
import logging
import random

from serviceshared.database import api_tx
from serviceshared.util import is_offpeak
from serviceshared.util.timeout import run_with_timeout
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from service.cron.clubembeddings.snapshot import compute_club_embeddings
from service.cron.clubembeddings.sql import (
    Q_NULL_CLUB_EMBEDDINGS,
    Q_STAMP_CLUB_EMBEDDING_REFRESH,
    Q_UPDATE_CLUB_EMBEDDINGS,
)
from serviceshared.duoenv.cron import (
    CLUB_EMBEDDINGS_COMPUTE_TIMEOUT_SECONDS,
    CLUB_EMBEDDINGS_MAX_LOAD_PCT,
    CLUB_EMBEDDINGS_POLL_SECONDS,
)

logger = logging.getLogger(__name__)

_WRITE_BATCH_SIZE = 500


async def refresh_club_embeddings_once() -> None:
    if not is_offpeak(
            CLUB_EMBEDDINGS_MAX_LOAD_PCT, 'refresh_club_embeddings_once'):
        return

    changed, removed = await asyncio.to_thread(
        run_with_timeout,
        CLUB_EMBEDDINGS_COMPUTE_TIMEOUT_SECONDS,
        compute_club_embeddings,
    )

    names = sorted(changed)
    for i in range(0, len(names), _WRITE_BATCH_SIZE):
        batch = names[i:i + _WRITE_BATCH_SIZE]

        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_UPDATE_CLUB_EMBEDDINGS, dict(
                names=batch,
                embeddings=[changed[name] for name in batch],
            ))

    for i in range(0, len(removed), _WRITE_BATCH_SIZE):
        batch = removed[i:i + _WRITE_BATCH_SIZE]

        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_NULL_CLUB_EMBEDDINGS, dict(names=batch))

    if not names and not removed:
        return

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_STAMP_CLUB_EMBEDDING_REFRESH)

    logger.info(
        f'club_embeddings: wrote {len(names)}, cleared {len(removed)}'
    )


async def refresh_club_embeddings_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_club_embeddings_once)
        await asyncio.sleep(CLUB_EMBEDDINGS_POLL_SECONDS)
