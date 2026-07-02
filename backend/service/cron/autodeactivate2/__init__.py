from database import api_tx, row_str, row_str_list
from service.cron.autodeactivate2.sql import *
from service.cron.autodeactivate2.template import emailtemplate
from service.cron.cronutil import print_stacktrace, MAX_RANDOM_START_DELAY
from smtp import aws_smtp
import asyncio
import notify
import os
import random
import sessioncache
from collections.abc import Iterable

DRY_RUN = os.environ.get(
    'DUO_CRON_AUTODEACTIVATE2_DRY_RUN',
    'true',
).lower() not in ['false', 'f', '0', 'no']

AUTODEACTIVATE2_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_AUTODEACTIVATE2_POLL_SECONDS',
    str(60 * 10), # 10 minutes
))

print(f'Hello from cron module: {__name__}')

async def maybe_send_email(email: str) -> None:
    if email.lower().endswith('@example.com'):
        return

    subject = "Your profile is invisible 👻"
    body = emailtemplate()

    print('autodeactivate2: sending deactivation email to', email)
    # smtp.send is blocking; keep it off the event loop.
    await asyncio.to_thread(
        aws_smtp.send,
        subject=subject,
        body=body,
        to_addr=email,
    )


def send_mobile_notifications(push_tokens: Iterable[str]) -> None:
    for token in push_tokens:
        print('autodeactivate2: sending deactivation push notification to', token)
        notify.enqueue_mobile_notification(
            token=token,
            title="Your profile is invisible 👻",
            body=(
                "Because we only show active members, your profile was hidden. "
                "Open Duolicious to become visible again."
            ),
        )


async def autodeactivate2_once() -> None:
    params = dict(
        dry_run=DRY_RUN,
    )

    async with api_tx() as tx:
        cur_deactivated = await tx.execute(Q_DEACTIVATE, params)
        rows_deactivated = await cur_deactivated.fetchall()

    for p in rows_deactivated:
        for session_token_hash in row_str_list(p, 'session_token_hashes'):
            await sessioncache.delete_session(session_token_hash)

    for p in rows_deactivated:
        person = dict(id=p['id'], email=row_str(p, 'email'))
        if DRY_RUN:
            print(
                f'  - autodeactive2: DUO_CRON_AUTODEACTIVATE2_DRY_RUN env '
                f'var prevented deactivation of {person}'
            )
        else:
            print(f'  - autodeactive2: deactivated {person}')

    for p in rows_deactivated:
        await maybe_send_email(row_str(p, 'email'))
        send_mobile_notifications(row_str_list(p, 'push_tokens'))

async def autodeactivate2_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(autodeactivate2_once)
        await asyncio.sleep(AUTODEACTIVATE2_POLL_SECONDS)
