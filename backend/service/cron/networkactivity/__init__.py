import asyncio
import random

from serviceshared.antiabuse.networkactivity import Q_FOLD_NETWORK_ACTIVITY
from serviceshared.database import api_tx
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from serviceshared.duoenv.cron import NETWORK_ACTIVITY_POLL_SECONDS


async def fold_network_activity_once() -> None:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_FOLD_NETWORK_ACTIVITY)


async def fold_network_activity_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(fold_network_activity_once)
        await asyncio.sleep(NETWORK_ACTIVITY_POLL_SECONDS)
