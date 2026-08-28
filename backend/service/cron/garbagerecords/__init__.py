from serviceshared.database import api_tx
from serviceshared.kvmatching.refresh import refresh_vectors
from service.cron.garbagerecords.sql import *
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
import asyncio
import random
import logging

from serviceshared.duoenv.cron import GARBAGE_RECORDS_POLL_SECONDS

logger = logging.getLogger(__name__)

logger.info('Hello from cron module')

async def delete_garbage_records_once() -> None:
    async with api_tx() as tx:
        cur = await tx.execute(Q_DELETE_GARBAGE_RECORDS)
        rows = await cur.fetchall()
        # Deleting a moderated photo moves its owner's photo count and
        # verification level, both matching-model inputs
        for person_id in rows[0]['photo_person_ids'] or []:
            await refresh_vectors(tx, int(person_id))

    try:
        count = rows[0]['count']
    except:
        count = 0

    if count:
        logger.info(f'Deleted {count} garbage record(s)')

async def delete_garbage_records_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(delete_garbage_records_once)
        await asyncio.sleep(GARBAGE_RECORDS_POLL_SECONDS)
