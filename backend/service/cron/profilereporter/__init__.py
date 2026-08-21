from serviceshared.database import api_tx
from service.cron.profilereporter.sql import (
    Q_DELETE_UNMODERATED_PERSON,
    Q_SELECT_UNMODERATED_PERSON_ABOUT,
)
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    log_stacktrace,
)
import asyncio
import random
from serviceshared.antiabuse.childsafety import potential_minor
from serviceshared.antiabuse.lodgereport import skip_by_uuid
import logging

from serviceshared.duoenv.cron import PROFILE_REPORTER_POLL_SECONDS

logger = logging.getLogger(__name__)

logger.info('Hello from cron module')

async def report_profiles_once() -> None:
    async with api_tx() as tx:
        await tx.execute(Q_SELECT_UNMODERATED_PERSON_ABOUT)
        rows = await tx.fetchall()


    for row in rows:
        if potential_minor(row['about']):
            logger.info(f"{row['object_uuid']} reported")
            await skip_by_uuid(
                subject_uuid=row['subject_uuid'],
                object_uuid=row['object_uuid'],
                reason='Automatically lodged report: Child safety'
            )
        else:
            logger.info(f"{row['object_uuid']} not reported")

    params_seq = [dict(uuid=row['object_uuid']) for row in rows]
    async with api_tx() as tx:
        await tx.executemany(Q_DELETE_UNMODERATED_PERSON, params_seq)


async def report_profiles_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(report_profiles_once)
        await asyncio.sleep(PROFILE_REPORTER_POLL_SECONDS)
