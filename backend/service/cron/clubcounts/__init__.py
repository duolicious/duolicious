import asyncio
import logging
import random

from serviceshared.database import api_tx, row_int
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from service.cron.clubcounts.sql import Q_FOLD_CLUB_COUNT_DELTAS
from serviceshared.duoenv.cron import CLUB_COUNT_POLL_SECONDS

logger = logging.getLogger(__name__)


async def fold_club_count_deltas_once() -> None:
    async with api_tx('READ COMMITTED') as tx:
        row = await tx.require_one(Q_FOLD_CLUB_COUNT_DELTAS)
        folded = row_int(row, 'folded')

    if folded:
        logger.info(f'club_count_delta: folded deltas into {folded} clubs')


async def fold_club_count_deltas_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(fold_club_count_deltas_once)
        await asyncio.sleep(CLUB_COUNT_POLL_SECONDS)
