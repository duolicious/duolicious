import unittest
from datetime import datetime
from unittest.mock import patch, MagicMock
from service.cron.notificationdispatch import (
    Notification,
    send_mobile_notification,
)
from service.cron.visitornotifications import VISITOR_NOTIFICATIONS

def make_notification(unseen_count: int) -> Notification:
    return Notification(
        person_id=1,
        person_uuid='2',
        event_at=datetime(2023, 9, 4),
        name='jk',
        email='user.1@gmail.com',
        unseen_count=unseen_count,
        token='asdf',
    )


class TestSendMobileNotification(unittest.TestCase):

    @patch('service.cron.notificationdispatch.disable_mobile_notifications')
    @patch('service.cron.notificationdispatch.notify.enqueue_mobile_notification')
    def test_visitor_push_opens_the_visitors_tab(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False

        send_mobile_notification(
                VISITOR_NOTIFICATIONS, make_notification(1), badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], 'Someone visited your profile 👀')
        self.assertEqual(kwargs['body'], 'Someone visited your profile!')
        self.assertEqual(
                kwargs['data'],
                {'screen': 'Home', 'params': {'screen': 'Visitors'}})

    @patch('service.cron.notificationdispatch.disable_mobile_notifications')
    @patch('service.cron.notificationdispatch.notify.enqueue_mobile_notification')
    def test_multiple_visitors_are_counted(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False

        send_mobile_notification(
                VISITOR_NOTIFICATIONS, make_notification(3), badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], '3 people visited your profile 👀')
        self.assertEqual(kwargs['body'], '3 people visited your profile!')

    @patch('service.cron.notificationdispatch.disable_mobile_notifications')
    @patch('service.cron.notificationdispatch.notify.enqueue_mobile_notification')
    def test_visitor_counts_are_capped(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False

        send_mobile_notification(
                VISITOR_NOTIFICATIONS, make_notification(100), badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], '99+ people visited your profile 👀')
        self.assertEqual(kwargs['body'], '99+ people visited your profile!')


if __name__ == '__main__':
    unittest.main()
