import unittest
from datetime import datetime
from unittest.mock import patch, MagicMock
from service.cron.messagenotifications import (
    CHAT_NOTIFICATIONS,
    INTRO_NOTIFICATIONS,
)
from service.cron.notificationdispatch import (
    Notification,
    NotificationKind,
    send_mobile_notification,
)

def make_notification() -> Notification:
    return Notification(
        person_id=1,
        person_uuid='2',
        event_at=datetime(2023, 9, 4),
        name='jk',
        email='user.1@gmail.com',
        unseen_count=1,
        token='asdf',
    )


class TestMessageNotifications(unittest.TestCase):

    @patch('service.cron.notificationdispatch.disable_mobile_notifications')
    @patch('service.cron.notificationdispatch.notify.enqueue_mobile_notification')
    def push_body(
        self,
        kind: NotificationKind,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> str:
        mock_disable.return_value = False

        send_mobile_notification(kind, make_notification(), badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], 'You have a new message 😍')
        self.assertEqual(
                kwargs['data'],
                {'screen': 'Home', 'params': {'screen': 'Inbox'}})
        return kwargs['body']

    def test_intro_push_names_intros(self) -> None:
        self.assertEqual(
                self.push_body(INTRO_NOTIFICATIONS),
                'You have a new message in your intros!')

    def test_chat_push_names_chats(self) -> None:
        self.assertEqual(
                self.push_body(CHAT_NOTIFICATIONS),
                'You have a new message in your chats!')


if __name__ == '__main__':
    unittest.main()
