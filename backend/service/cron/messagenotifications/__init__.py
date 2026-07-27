from database import api_tx
from dataclasses import dataclass
from service.cron.messagenotifications.sql import (
    Q_UNREAD_INBOX,
)
from service.cron.messagenotifications.template import (
    MESSAGE_SUBJECT,
    big_part,
    emailtemplate,
)
from service.cron.cronutil import (
    DISABLE_MOBILE_NOTIFICATIONS_FILE,
    MAX_RANDOM_START_DELAY,
    disable_mobile_notifications,
    print_stacktrace,
)
from commonsql import (
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
)
from unseennotificationcount import increment_unseen_notification_count
import asyncio
from smtp import make_aws_smtp
import os
import random
import notify

EMAIL_POLL_SECONDS = int(os.environ.get(
    'DUO_CRON_EMAIL_POLL_SECONDS',
    str(10), # 10 seconds
))

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

def do_send_notification(row: PersonNotification) -> bool:
    return is_intro_sendable(row) or is_chat_sendable(row)

def do_send_email_notification(row: PersonNotification) -> bool:
    is_example = row.email.lower().endswith('@example.com')

    return do_send_notification(row) and not is_example

def notification_body(row: PersonNotification) -> str:
    # Every unread kind the query found, not only the ones whose frequency cap
    # has elapsed: one notification covers the whole inbox, so an intro still
    # inside its cap is mentioned here rather than being held back for a
    # notification of its own.
    return big_part(row.has_intro, row.has_chat)

async def send_email_notification(row: PersonNotification) -> None:
    if not do_send_email_notification(row):
        print('Email notification failed because it ends with @example.com')
        return

    subject = MESSAGE_SUBJECT
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

def send_mobile_notification(
    row: PersonNotification,
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
            title=MESSAGE_SUBJECT,
            body=notification_body(row),
            data={'screen': 'Home', 'params': {'screen': 'Inbox'}},
            badge=badge,
        )

async def compute_badges(
    person_notifications: list[PersonNotification],
) -> dict[str, int | None]:
    """
    Q_UNREAD_INBOX fans a person out into one row per push token, but the
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
        print('Sending message email notification:', str(row))
        return await send_email_notification(row)

    print('Sending message mobile notification:', str(row))
    send_mobile_notification(row, badge=badge)

async def update_last_notification_time(row: PersonNotification) -> None:
    params = dict(username=row.person_uuid)

    # Stamped to match what the notification said: it names every unread kind
    # the query found, so it resets the clock of each.
    async with api_tx('read committed') as tx:
        if row.has_intro:
            await tx.execute(Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME, params)
        if row.has_chat:
            await tx.execute(Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME, params)

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
        cur = await tx.execute(Q_UNREAD_INBOX)
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
