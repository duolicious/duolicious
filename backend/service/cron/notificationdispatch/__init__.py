from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from serviceshared.database import api_tx
from service.cron.cronutil import (
    DISABLE_MOBILE_NOTIFICATIONS_FILE,
    MAX_RANDOM_START_DELAY,
    disable_mobile_notifications,
    log_stacktrace,
)
from service.cron.notificationdispatch.sql import (
    Q_DELETE_SENT_NOTIFICATION,
    due_notifications_sql,
)
from serviceshared.batcher import track
from serviceshared.duoenv.cron import EMAIL_POLL_SECONDS
from serviceshared.smtp import make_aws_smtp
from serviceshared.unsubscribe import unsubscribe_url
from typing import Literal
from serviceshared.unseennotificationcount import increment_unseen_notification_count
from serviceshared.util import Json
import asyncio
import logging
from serviceshared import notify
import random

logger = logging.getLogger(__name__)

@dataclass
class Notification:
    person_id: int
    person_uuid: str
    event_at: datetime
    name: str
    email: str
    unseen_count: int
    token: str | None

@dataclass(frozen=True)
class NotificationKind:
    name: Literal['intro', 'chat', 'visitor']
    unseen_count: str
    stamp: str
    subject: Callable[[Notification], str]
    screen: Json
    push_body: Callable[[Notification], str]
    email_body: Callable[[Notification], str]

def do_send_email_notification(row: Notification) -> bool:
    return not row.email.lower().endswith('@example.com')

async def send_email_notification(kind: NotificationKind, row: Notification) -> None:
    if not do_send_email_notification(row):
        logger.info('Email notification failed because it ends with @example.com')
        return

    subject = kind.subject(row)
    body = kind.email_body(row)
    to_addr = row.email

    aws_smtp = make_aws_smtp()
    def send() -> None:
        aws_smtp.send(
            subject=subject,
            body=body,
            to_addr=to_addr,
            unsubscribe_url=unsubscribe_url(row.person_uuid),
        )

    await asyncio.to_thread(send)

def send_mobile_notification(
    kind: NotificationKind,
    row: Notification,
    badge: int | None,
) -> None:
    if disable_mobile_notifications():
        logger.info(
            'File prevented mobile notifications: '
            f'{DISABLE_MOBILE_NOTIFICATIONS_FILE.absolute()}'
        )
    else:
        notify.enqueue_mobile_notification(
            token=row.token,
            title=kind.subject(row),
            body=kind.push_body(row),
            data=kind.screen,
            badge=badge,
        )

async def compute_badges(rows: list[Notification]) -> dict[str, int | None]:
    """
    A due-notifications query fans a person out into one row per push token,
    but the unseen-notification count (the app-icon badge) must increment once
    per person, not once per device, so every device shows the same badge.
    """
    badges: dict[str, int | None] = {}

    for row in rows:
        if not row.token:
            continue
        if row.person_uuid in badges:
            continue

        badges[row.person_uuid] = await increment_unseen_notification_count(
                username=row.person_uuid)

    return badges

async def send_notification(
    kind: NotificationKind,
    row: Notification,
    badge: int | None,
) -> None:
    if not row.token:
        logger.info(f'Sending {kind.name} email notification: {row}')
        return await send_email_notification(kind, row)

    logger.info(f'Sending {kind.name} mobile notification: {row}')
    send_mobile_notification(kind, row, badge=badge)

async def update_last_notification_time(
    kind: NotificationKind,
    row: Notification,
) -> None:
    async with api_tx('read committed') as tx:
        await tx.execute(kind.stamp, dict(username=row.person_uuid))
        await tx.execute(Q_DELETE_SENT_NOTIFICATION, dict(
            person_id=row.person_id,
            kind=kind.name,
            event_at=row.event_at,
        ))

async def send_and_record_notification(
    kind: NotificationKind,
    row: Notification,
    badge: int | None,
) -> None:
    await send_notification(kind, row, badge)
    await update_last_notification_time(kind, row)

async def send_pending_notifications_once(kind: NotificationKind) -> None:
    async with api_tx('read committed') as tx:
        await tx.execute('SET LOCAL statement_timeout = 15000') # 15 seconds
        await tx.execute('SET LOCAL jit = off')
        cur = await tx.execute(due_notifications_sql(kind.name, kind.unseen_count))
        rows = await cur.fetchall()

    parsed = [Notification(**j) for j in rows]

    badges = await compute_badges(parsed)

    for row in parsed:
        await asyncio.shield(track(asyncio.create_task(
            send_and_record_notification(
                kind, row, badges.get(row.person_uuid)))))

async def send_pending_notifications_forever(kind: NotificationKind) -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(
            lambda: send_pending_notifications_once(kind))
        await asyncio.sleep(EMAIL_POLL_SECONDS)
