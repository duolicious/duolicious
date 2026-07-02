from database import api_tx
from dataclasses import dataclass
from service.cron.notifications.sql import (
    Q_UNREAD_INBOX,
)
from service.cron.notifications.template import (
    big_part,
    emailtemplate,
)
from service.cron.cronutil import (
    MAX_RANDOM_START_DELAY,
    print_stacktrace,
)
from commonsql import (
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
)
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
    last_intro_seconds: int
    last_chat_seconds: int
    has_intro: bool
    has_chat: bool
    name: str
    email: str
    chats_drift_seconds: int
    intros_drift_seconds: int
    token: str | None

def disable_mobile_notifications() -> bool:
    if _disable_mobile_notifications_file.is_file():
        with _disable_mobile_notifications_file.open() as file:
            if file.read().strip() == '1':
                return True
    return False

def do_send_notification(row: PersonNotification) -> bool:
    email = row.email
    has_intro = row.has_intro
    has_chat = row.has_chat
    intros_drift_seconds = row.intros_drift_seconds
    chats_drift_seconds = row.chats_drift_seconds
    last_intro_notification_seconds = row.last_intro_notification_seconds
    last_chat_notification_seconds = row.last_chat_notification_seconds
    last_intro_seconds = row.last_intro_seconds
    last_chat_seconds = row.last_chat_seconds

    is_intro_sendable = (
        has_intro and
        intros_drift_seconds >= 0 and
        last_intro_notification_seconds + intros_drift_seconds < last_intro_seconds
    )

    is_chat_sendable = (
        has_chat and
        chats_drift_seconds >= 0 and
        last_chat_notification_seconds + chats_drift_seconds < last_chat_seconds
    )

    return (is_intro_sendable or is_chat_sendable)

def do_send_email_notification(row: PersonNotification) -> bool:
    is_example = row.email.lower().endswith('@example.com')

    return do_send_notification(row) and not is_example

async def send_email_notification(row: PersonNotification) -> None:
    if not do_send_email_notification(row):
        print('Email notification failed because it ends with @example.com')
        return

    subject = "You have a new message 😍"
    body = emailtemplate(
            email=row.email,
            has_intro=row.has_intro,
            has_chat=row.has_chat,
    )
    to_addr = row.email

    aws_smtp = make_aws_smtp()
    def send() -> None:
        aws_smtp.send(subject=subject, body=body, to_addr=to_addr)

    await asyncio.to_thread(send)

def send_mobile_notification(row: PersonNotification) -> None:
    if disable_mobile_notifications():
        print(
            'File prevented mobile notifications',
            str(_disable_mobile_notifications_file.absolute())
        )
    else:
        notify.enqueue_mobile_notification(
            token=row.token,
            title='You have a new message 😍',
            body=big_part(row.has_intro, row.has_chat),
            data={'screen': 'Inbox'},
        )

async def send_notification(row: PersonNotification) -> None:
    if not row.token:
        print('Sending email notification:', str(row))
        return await send_email_notification(row)

    print('Sending mobile notification:', str(row))
    send_mobile_notification(row)

async def update_last_notification_time(row: PersonNotification) -> None:
    params = dict(username=row.person_uuid)

    async with api_tx('read committed') as tx:
        if row.has_intro:
            await tx.execute(Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME, params)
        if row.has_chat:
            await tx.execute(Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME, params)

async def maybe_send_notification(row: PersonNotification) -> None:
    if not do_send_notification(row):
        return

    await send_notification(row)
    await update_last_notification_time(row)

async def send_notifications_once() -> None:
    async with api_tx('read committed') as tx:
        await tx.execute('SET LOCAL statement_timeout = 15000') # 15 seconds
        cur = await tx.execute(Q_UNREAD_INBOX)
        rows = await cur.fetchall()

    person_notifications = [PersonNotification(**j) for j in rows]

    for row in person_notifications:
        await maybe_send_notification(row)

async def send_notifications_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(send_notifications_once)
        await asyncio.sleep(EMAIL_POLL_SECONDS)
