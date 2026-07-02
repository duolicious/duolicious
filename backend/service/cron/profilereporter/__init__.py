from database import api_tx
from service.cron.profilereporter.sql import (
    Q_DELETE_UNMODERATED_PERSON,
    Q_SELECT_UNMODERATED_PERSON_ABOUT,
)
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    print_stacktrace,
)
import asyncio
import os
import random
from antiabuse.childsafety import potential_minor
from antiabuse.lodgereport import skip_by_uuid

PROFILE_REPORTER_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_PROFILE_REPORTER_POLL_SECONDS',
    str(10 * 60), # 10 minutes
))

print(f'Hello from cron module: {__name__}')

async def report_profiles_once() -> None:
    async with api_tx() as tx:
        await tx.execute(Q_SELECT_UNMODERATED_PERSON_ABOUT)
        rows = await tx.fetchall()


    for row in rows:
        if potential_minor(row['about']):
            print(f'{__name__} -', row['object_uuid'], 'reported')
            await skip_by_uuid(
                subject_uuid=row['subject_uuid'],
                object_uuid=row['object_uuid'],
                reason='Automatically lodged report: Child safety'
            )
        else:
            print(f'{__name__} -', row['object_uuid'], 'not reported')

    params_seq = [dict(uuid=row['object_uuid']) for row in rows]
    async with api_tx() as tx:
        await tx.executemany(Q_DELETE_UNMODERATED_PERSON, params_seq)


async def report_profiles_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(report_profiles_once)
        await asyncio.sleep(PROFILE_REPORTER_POLL_SECONDS)
