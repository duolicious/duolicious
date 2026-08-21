import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import patch, MagicMock
from serviceshared.commonsql import (
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
)
from service.cron.messagenotifications import (
    MESSAGE_NOTIFICATIONS,
    PersonNotification,
    do_send_notification,
    is_chat_sendable,
    is_intro_sendable,
    update_last_notification_time,
)
from service.cron.notificationdispatch import send_mobile_notification
import asyncio

def make_person_notification(**overrides: str | int | bool | None) -> PersonNotification:
    row = PersonNotification(
        person_uuid='2',
        last_intro_notification_seconds=1693786048,
        last_chat_notification_seconds=1693786048,
        has_intro=True,
        has_chat=True,
        last_intro_seconds=1693786124,
        last_chat_seconds=100,
        name='jk',
        email='user.1@gmail.com',
        chats_drift_seconds=0,
        intros_drift_seconds=86400,
        token='asdf',
    )
    for key, value in overrides.items():
        setattr(row, key, value)
    return row


class TestMessageNotificationsCoverTheWholeInbox(unittest.TestCase):

    def capped_intro_row(self) -> PersonNotification:
        # A due chat and an unread intro that the query found but that is still
        # inside its weekly cap, having been notified about a minute before it
        # arrived.
        return make_person_notification(
            intros_drift_seconds=604800,
            last_intro_notification_seconds=1693786064,
            last_intro_seconds=1693786124,
            chats_drift_seconds=0,
            last_chat_notification_seconds=0,
            last_chat_seconds=1693786124,
        )

    def test_the_capped_intro_is_not_due_on_its_own(self) -> None:
        row = self.capped_intro_row()

        self.assertFalse(is_intro_sendable(row))
        self.assertTrue(is_chat_sendable(row))
        self.assertTrue(do_send_notification(row))

    @patch('service.cron.notificationdispatch.disable_mobile_notifications')
    @patch('service.cron.notificationdispatch.notify.enqueue_mobile_notification')
    def test_one_notification_names_both_kinds(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False

        send_mobile_notification(
                MESSAGE_NOTIFICATIONS, self.capped_intro_row(), badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], 'You have a new message 😍')
        self.assertEqual(
                kwargs['body'],
                'You have new messages in your chats and intros!')
        self.assertEqual(
                kwargs['data'],
                {'screen': 'Home', 'params': {'screen': 'Inbox'}})

    def test_both_clocks_are_stamped(self) -> None:
        # Whatever the notification named, it stamped, so the intro doesn't come
        # back as a second notification once its cap elapses.
        executed = []

        class Tx:
            async def execute(self, query: str, params: object) -> None:
                executed.append(query)

        @asynccontextmanager
        async def api_tx(isolation: str) -> AsyncIterator[Tx]:
            yield Tx()

        with patch('service.cron.messagenotifications.api_tx', api_tx):
            asyncio.run(update_last_notification_time(self.capped_intro_row()))

        self.assertEqual(executed, [
            Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
            Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
        ])


if __name__ == '__main__':
    unittest.main()
