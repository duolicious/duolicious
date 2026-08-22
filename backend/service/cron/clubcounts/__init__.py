import asyncio
import logging
import random

from serviceshared.database import Tx, api_tx_with_retry
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from service.cron.clubcounts.sql import Q_FOLD_CLUB_COUNT_DELTAS
from serviceshared.duoenv.cron import CLUB_COUNT_POLL_SECONDS

logger = logging.getLogger(__name__)


async def fold_club_count_deltas_once() -> None:
    # This is the one writer of `club.count_members`, so its only contention
    # is with the other background `club`-row writers (the clubembeddings
    # batches, the boot-time repair), which the retry absorbs.
    async def work(tx: Tx) -> int:
        await tx.execute(Q_FOLD_CLUB_COUNT_DELTAS)
        return tx.rowcount

    folded = await api_tx_with_retry(work)

    if folded:
        logger.info(f'club_count_delta: folded deltas into {folded} clubs')


async def fold_club_count_deltas_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(fold_club_count_deltas_once)
        await asyncio.sleep(CLUB_COUNT_POLL_SECONDS)
