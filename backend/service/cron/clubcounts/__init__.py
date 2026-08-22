import asyncio
import logging
import random

from serviceshared.database import api_tx
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from service.cron.clubcounts.sql import Q_FOLD_CLUB_COUNT_DELTAS
from serviceshared.duoenv.cron import CLUB_COUNT_POLL_SECONDS

logger = logging.getLogger(__name__)


async def fold_club_count_deltas_once() -> None:
    # READ COMMITTED so a collision with another background `club`-row writer
    # (the boot-time repair) blocks briefly rather than aborting. No retry
    # wrapper: the poll loop is already a retry with a tick of spacing, which
    # is the contention-friendly kind -- a failed fold just leaves the deltas
    # for the next tick.
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_FOLD_CLUB_COUNT_DELTAS)
        folded = tx.rowcount

    if folded:
        logger.info(f'club_count_delta: folded deltas into {folded} clubs')


async def fold_club_count_deltas_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(fold_club_count_deltas_once)
        await asyncio.sleep(CLUB_COUNT_POLL_SECONDS)
