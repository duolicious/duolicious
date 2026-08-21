from serviceshared.commonsql import (
    Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
)
from dataclasses import dataclass
from serviceshared.database import api_tx
from service.cron.notificationdispatch import (
    NotificationKind,
    send_pending_notifications_forever,
)
from service.cron.visitornotifications.sql import (
    Q_PENDING_VISITOR_NOTIFICATIONS,
)
from service.cron.visitornotifications.template import (
    big_part,
    title_part,
    visitor_emailtemplate,
)
import logging

from serviceshared.duoenv.cron import EMAIL_POLL_SECONDS as VISITOR_POLL_SECONDS

logger = logging.getLogger(__name__)

logger.info('Hello from cron module')

@dataclass
class VisitorNotification:
    person_uuid: str
    last_visitor_notification_seconds: int
    last_visitor_seconds: int
    name: str
    email: str
    visitors_drift_seconds: int
    visitor_count: int
    token: str | None

def do_send_notification(row: VisitorNotification) -> bool:
    return (
        row.visitors_drift_seconds >= 0 and
        row.last_visitor_notification_seconds + row.visitors_drift_seconds <
            row.last_visitor_seconds
    )

def push_title(row: VisitorNotification) -> str:
    return title_part(row.visitor_count)

def push_body(row: VisitorNotification) -> str:
    return big_part(row.visitor_count)

def email_body(row: VisitorNotification) -> str:
    return visitor_emailtemplate(
        email=row.email, visitor_count=row.visitor_count)

async def update_last_notification_time(row: VisitorNotification) -> None:
    params = dict(username=row.person_uuid)

    async with api_tx('read committed') as tx:
        await tx.execute(Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME, params)

VISITOR_NOTIFICATIONS = NotificationKind(
    name='visitor',
    query=Q_PENDING_VISITOR_NOTIFICATIONS,
    row_type=VisitorNotification,
    poll_seconds=VISITOR_POLL_SECONDS,
    subject=push_title,
    screen={'screen': 'Home', 'params': {'screen': 'Visitors'}},
    is_sendable=do_send_notification,
    push_body=push_body,
    email_body=email_body,
    update_last_notification_time=update_last_notification_time,
)

async def send_visitor_notifications_forever() -> None:
    await send_pending_notifications_forever(VISITOR_NOTIFICATIONS)
