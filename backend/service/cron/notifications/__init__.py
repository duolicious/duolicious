from database import api_tx
from dataclasses import dataclass
from service.cron.notifications.sql import (
    Q_PENDING_NOTIFICATIONS,
)
from service.cron.notifications.template import (
    big_part,
    emailtemplate,
    subject_line,
)
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    print_stacktrace,
)
from commonsql import (
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
    Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
)
from unseennotificationcount import increment_unseen_notification_count
from util import Json
import asyncio
from smtp import make_aws_smtp
import os
import random
import json
import traceback
from pathlib import Path
import notify

EMAIL_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_EMAIL_POLL_SECONDS',
    str(10), # 10 seconds
))

_disable_mobile_notifications_file = (
    Path(__file__).parent.parent.parent.parent /
    'test' /
    'input' /
    'disable-mobile-notifications')

print(f'Hello from cron module: {__name__}')

@dataclass
class PersonNotification:
    person_uuid: str
    last_intro_notification_seconds: int
    last_chat_notification_seconds: int
    last_visitor_notification_seconds: int
    last_intro_seconds: int
    last_chat_seconds: int
    last_visitor_seconds: int
    has_intro: bool
    has_chat: bool
    has_visitor: bool
    name: str
    email: str
    chats_drift_seconds: int
    intros_drift_seconds: int
    visitors_drift_seconds: int
    token: str | None

def disable_mobile_notifications() -> bool:
    if _disable_mobile_notifications_file.is_file():
        with _disable_mobile_notifications_file.open() as file:
            if file.read().strip() == '1':
                return True
    return False

def _is_sendable(
    is_due: bool,
    drift_seconds: int,
    last_notification_seconds: int,
    last_seconds: int,
) -> bool:
    return (
        is_due and
        drift_seconds >= 0 and
        last_notification_seconds + drift_seconds < last_seconds
    )

def is_intro_sendable(row: PersonNotification) -> bool:
    return _is_sendable(
        is_due=row.has_intro,
        drift_seconds=row.intros_drift_seconds,
        last_notification_seconds=row.last_intro_notification_seconds,
        last_seconds=row.last_intro_seconds,
    )

def is_chat_sendable(row: PersonNotification) -> bool:
    return _is_sendable(
        is_due=row.has_chat,
        drift_seconds=row.chats_drift_seconds,
        last_notification_seconds=row.last_chat_notification_seconds,
        last_seconds=row.last_chat_seconds,
    )

def is_visitor_sendable(row: PersonNotification) -> bool:
    return _is_sendable(
        is_due=row.has_visitor,
        drift_seconds=row.visitors_drift_seconds,
        last_notification_seconds=row.last_visitor_notification_seconds,
        last_seconds=row.last_visitor_seconds,
    )

def do_send_notification(row: PersonNotification) -> bool:
    return (
        is_intro_sendable(row) or
        is_chat_sendable(row) or
        is_visitor_sendable(row)
    )

def do_send_email_notification(row: PersonNotification) -> bool:
    is_example = row.email.lower().endswith('@example.com')

    return do_send_notification(row) and not is_example

async def send_email_notification(row: PersonNotification) -> None:
    if not do_send_email_notification(row):
        print('Email notification failed because it ends with @example.com')
        return

    has_intro = is_intro_sendable(row)
    has_chat = is_chat_sendable(row)
    has_visitor = is_visitor_sendable(row)

    subject = subject_line(has_intro, has_chat, has_visitor)
    body = emailtemplate(
            email=row.email,
            has_intro=has_intro,
            has_chat=has_chat,
            has_visitor=has_visitor,
    )
    to_addr = row.email

    aws_smtp = make_aws_smtp()
    def send() -> None:
        aws_smtp.send(subject=subject, body=body, to_addr=to_addr)

    await asyncio.to_thread(send)

def notification_screen(
    has_intro: bool,
    has_chat: bool,
    has_visitor: bool,
) -> Json:
    # A notification about nothing but visitors opens the visitors tab; anything
    # mentioning a message opens the inbox, where the message is.
    if has_visitor and not has_intro and not has_chat:
        return {'screen': 'Home', 'params': {'screen': 'Visitors'}}
    return {'screen': 'Home', 'params': {'screen': 'Inbox'}}

def send_mobile_notification(
    row: PersonNotification,
    badge: int | None,
) -> None:
    has_intro = is_intro_sendable(row)
    has_chat = is_chat_sendable(row)
    has_visitor = is_visitor_sendable(row)

    if disable_mobile_notifications():
        print(
            'File prevented mobile notifications',
            str(_disable_mobile_notifications_file.absolute())
        )
    else:
        notify.enqueue_mobile_notification(
            token=row.token,
            title=subject_line(has_intro, has_chat, has_visitor),
            body=big_part(has_intro, has_chat, has_visitor),
            data=notification_screen(has_intro, has_chat, has_visitor),
            badge=badge,
        )

async def compute_badges(
    person_notifications: list[PersonNotification],
) -> dict[str, int | None]:
    """
    Q_PENDING_NOTIFICATIONS fans a person out into one row per push token, but the
    unseen-notification count (the app-icon badge) must increment once per
    person, not once per device, so every device shows the same badge. The
    conditions here mirror the ones under which `maybe_send_notification`
    sends a push rather than an email or nothing.
    """
    badges: dict[str, int | None] = {}

    for row in person_notifications:
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
    row: PersonNotification,
    badge: int | None,
) -> None:
    if not row.token:
        print('Sending email notification:', str(row))
        return await send_email_notification(row)

    print('Sending mobile notification:', str(row))
    send_mobile_notification(row, badge=badge)

async def update_last_notification_time(row: PersonNotification) -> None:
    params = dict(username=row.person_uuid)

    async with api_tx('read committed') as tx:
        if is_intro_sendable(row):
            await tx.execute(Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME, params)
        if is_chat_sendable(row):
            await tx.execute(Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME, params)
        if is_visitor_sendable(row):
            await tx.execute(Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME, params)

async def maybe_send_notification(
    row: PersonNotification,
    badge: int | None,
) -> None:
    if not do_send_notification(row):
        return

    await send_notification(row, badge)
    await update_last_notification_time(row)

async def send_notifications_once() -> None:
    async with api_tx('read committed') as tx:
        await tx.execute('SET LOCAL statement_timeout = 15000') # 15 seconds
        cur = await tx.execute(Q_PENDING_NOTIFICATIONS)
        rows = await cur.fetchall()

    person_notifications = [PersonNotification(**j) for j in rows]

    badges = await compute_badges(person_notifications)

    for row in person_notifications:
        await maybe_send_notification(row, badges.get(row.person_uuid))

async def send_notifications_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(send_notifications_once)
        await asyncio.sleep(EMAIL_POLL_SECONDS)
