from commonsql import (
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
)
from dataclasses import dataclass
from database import api_tx
from service.cron.messagenotifications.sql import (
    Q_UNREAD_INBOX,
)
from service.cron.messagenotifications.template import (
    MESSAGE_SUBJECT,
    big_part,
    emailtemplate,
)
from service.cron.notificationdispatch import (
    NotificationKind,
    send_pending_notifications_forever,
)
import os

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

def notification_subject(row: PersonNotification) -> str:
    return MESSAGE_SUBJECT

def notification_body(row: PersonNotification) -> str:
    # Every unread kind the query found, not only the ones whose frequency cap
    # has elapsed: one notification covers the whole inbox, so an intro still
    # inside its cap is mentioned here rather than being held back for a
    # notification of its own.
    return big_part(row.has_intro, row.has_chat)

def email_body(row: PersonNotification) -> str:
    return emailtemplate(
        email=row.email,
        has_intro=row.has_intro,
        has_chat=row.has_chat,
    )

async def update_last_notification_time(row: PersonNotification) -> None:
    params = dict(username=row.person_uuid)

    # Stamped to match what the notification said: it names every unread kind
    # the query found, so it resets the clock of each.
    async with api_tx('read committed') as tx:
        if row.has_intro:
            await tx.execute(Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME, params)
        if row.has_chat:
            await tx.execute(Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME, params)

MESSAGE_NOTIFICATIONS = NotificationKind(
    name='message',
    query=Q_UNREAD_INBOX,
    row_type=PersonNotification,
    poll_seconds=EMAIL_POLL_SECONDS,
    subject=notification_subject,
    screen={'screen': 'Home', 'params': {'screen': 'Inbox'}},
    is_sendable=do_send_notification,
    push_body=notification_body,
    email_body=email_body,
    update_last_notification_time=update_last_notification_time,
)

async def send_notifications_forever() -> None:
    await send_pending_notifications_forever(MESSAGE_NOTIFICATIONS)
