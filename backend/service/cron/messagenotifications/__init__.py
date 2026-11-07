from serviceshared.commonsql import (
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
)
from service.cron.messagenotifications.template import (
    MESSAGE_SUBJECT,
    big_part,
    emailtemplate,
)
from service.cron.notificationdispatch import NotificationKind
from typing import Literal

def _message_notifications(
    name: Literal['intro', 'chat'],
    box: str,
    stamp: str,
) -> NotificationKind:
    return NotificationKind(
        name=name,
        unseen_count=f"""
            EXISTS (
                SELECT
                    1
                FROM
                    inbox
                WHERE
                    luser = person.uuid::TEXT
                AND
                    box = '{box}'
                AND
                    unread_count > 0
            )::INT
        """,
        stamp=stamp,
        subject=lambda row: MESSAGE_SUBJECT,
        screen={'screen': 'Home', 'params': {'screen': 'Inbox'}},
        push_body=lambda row: big_part(name),
        email_body=lambda row: emailtemplate(row.person_uuid, name),
    )

INTRO_NOTIFICATIONS = _message_notifications(
    'intro', 'inbox', Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME)

CHAT_NOTIFICATIONS = _message_notifications(
    'chat', 'chats', Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME)
