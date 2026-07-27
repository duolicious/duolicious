from database import api_tx
from dataclasses import dataclass
from service.cron.visitornotifications.sql import (
    Q_PENDING_VISITOR_NOTIFICATIONS,
)
from service.cron.visitornotifications.template import (
    VISITOR_BIG_PART,
    VISITOR_SUBJECT,
    visitor_emailtemplate,
)
from service.cron.cronutil import (
    DISABLE_MOBILE_NOTIFICATIONS_FILE,
    MAX_RANDOM_START_DELAY,
    disable_mobile_notifications,
    print_stacktrace,
)
from commonsql import (
    Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
)
from unseennotificationcount import increment_unseen_notification_count
import asyncio
from smtp import make_aws_smtp
import os
import random
import notify

VISITOR_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_EMAIL_POLL_SECONDS',
    str(10), # 10 seconds
))

print(f'Hello from cron module: {__name__}')

@dataclass
class VisitorNotification:
    person_uuid: str
    last_visitor_notification_seconds: int
    last_visitor_seconds: int
    name: str
    email: str
    visitors_drift_seconds: int
    token: str | None

def do_send_notification(row: VisitorNotification) -> bool:
    return (
        row.visitors_drift_seconds >= 0 and
        row.last_visitor_notification_seconds + row.visitors_drift_seconds <
            row.last_visitor_seconds
    )

def do_send_email_notification(row: VisitorNotification) -> bool:
    is_example = row.email.lower().endswith('@example.com')

    return do_send_notification(row) and not is_example

async def send_email_notification(row: VisitorNotification) -> None:
    if not do_send_email_notification(row):
        print('Email notification failed because it ends with @example.com')
        return

    subject = VISITOR_SUBJECT
    body = visitor_emailtemplate(email=row.email)
    to_addr = row.email

    aws_smtp = make_aws_smtp()
    def send() -> None:
        aws_smtp.send(subject=subject, body=body, to_addr=to_addr)

    await asyncio.to_thread(send)

def send_mobile_notification(
    row: VisitorNotification,
    badge: int | None,
) -> None:
    if disable_mobile_notifications():
        print(
            'File prevented mobile notifications',
            str(DISABLE_MOBILE_NOTIFICATIONS_FILE.absolute())
        )
    else:
        notify.enqueue_mobile_notification(
            token=row.token,
            title=VISITOR_SUBJECT,
            body=VISITOR_BIG_PART,
            data={'screen': 'Home', 'params': {'screen': 'Visitors'}},
            badge=badge,
        )

async def compute_badges(
    visitor_notifications: list[VisitorNotification],
) -> dict[str, int | None]:
    """
    Q_PENDING_VISITOR_NOTIFICATIONS fans a person out into one row per push
    token, but the unseen-notification count (the app-icon badge) must
    increment once per person, not once per device, so every device shows the
    same badge. The conditions here mirror the ones under which
    `maybe_send_notification` sends a push rather than an email or nothing.
    """
    badges: dict[str, int | None] = {}

    for row in visitor_notifications:
        if not row.token:
            continue
        if not do_send_notification(row):
            continue
        if row.person_uuid in badges:
            continue

        badges[row.person_uuid] = await increment_unseen_notification_count(
                username=row.person_uuid)

    return badges

async def send_notification(
    row: VisitorNotification,
    badge: int | None,
) -> None:
    if not row.token:
        print('Sending visitor email notification:', str(row))
        return await send_email_notification(row)

    print('Sending visitor mobile notification:', str(row))
    send_mobile_notification(row, badge=badge)

async def update_last_notification_time(row: VisitorNotification) -> None:
    params = dict(username=row.person_uuid)

    async with api_tx('read committed') as tx:
        await tx.execute(Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME, params)

async def maybe_send_notification(
    row: VisitorNotification,
    badge: int | None,
) -> None:
    if not do_send_notification(row):
        return

    await send_notification(row, badge)
    await update_last_notification_time(row)

async def send_visitor_notifications_once() -> None:
    async with api_tx('read committed') as tx:
        await tx.execute('SET LOCAL statement_timeout = 15000') # 15 seconds
        cur = await tx.execute(Q_PENDING_VISITOR_NOTIFICATIONS)
        rows = await cur.fetchall()

    visitor_notifications = [VisitorNotification(**j) for j in rows]

    badges = await compute_badges(visitor_notifications)

    for row in visitor_notifications:
        await maybe_send_notification(row, badges.get(row.person_uuid))

async def send_visitor_notifications_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(send_visitor_notifications_once)
        await asyncio.sleep(VISITOR_POLL_SECONDS)
