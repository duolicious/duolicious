import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import patch, MagicMock
from commonsql import (
    Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
)
from service.cron.notificationdispatch import (
    do_send_email_notification,
    send_mobile_notification,
)
from service.cron.visitornotifications import (
    VISITOR_NOTIFICATIONS,
    VisitorNotification,
    do_send_notification,
    update_last_notification_time,
)
import asyncio

def make_visitor_notification(**overrides: str | int | bool | None) -> VisitorNotification:
    row = VisitorNotification(
        person_uuid='2',
        last_visitor_notification_seconds=0,
        last_visitor_seconds=1693786124,
        name='jk',
        email='user.1@gmail.com',
        visitors_drift_seconds=604800,
        visitor_count=1,
        token='asdf',
    )
    for key, value in overrides.items():
        setattr(row, key, value)
    return row


class TestDoSendNotification(unittest.TestCase):

    def test_a_visit_alone_is_worth_notifying_about(self) -> None:
        self.assertTrue(do_send_notification(make_visitor_notification()))

    def test_never_suppresses_visitor_notifications(self) -> None:
        row = make_visitor_notification(visitors_drift_seconds=-1)

        self.assertFalse(do_send_notification(row))

    def test_drift_period_defers_visitor_notifications(self) -> None:
        # The last visit landed a minute after the last notification, well
        # inside the weekly drift period, so it waits.
        row = make_visitor_notification(
                last_visitor_notification_seconds=1693786064)

        self.assertFalse(do_send_notification(row))

    def test_example_addresses_are_not_emailed(self) -> None:
        row = make_visitor_notification(email='user.1@exaMPle.com')

        self.assertTrue(do_send_notification(row))
        self.assertFalse(
                do_send_email_notification(VISITOR_NOTIFICATIONS, row))


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
                VISITOR_NOTIFICATIONS, make_visitor_notification(), badge=1)

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
                VISITOR_NOTIFICATIONS,
                make_visitor_notification(visitor_count=3),
                badge=1)

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
                VISITOR_NOTIFICATIONS,
                make_visitor_notification(visitor_count=100),
                badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], '99+ people visited your profile 👀')
        self.assertEqual(kwargs['body'], '99+ people visited your profile!')


class TestUpdateLastNotificationTime(unittest.TestCase):

    def test_the_visitor_clock_is_stamped(self) -> None:
        executed = []

        class Tx:
            async def execute(self, query: str, params: object) -> None:
                executed.append(query)

        @asynccontextmanager
        async def api_tx(isolation: str) -> AsyncIterator[Tx]:
            yield Tx()

        with patch('service.cron.visitornotifications.api_tx', api_tx):
            asyncio.run(update_last_notification_time(
                make_visitor_notification()))

        self.assertEqual(executed, [Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME])


if __name__ == '__main__':
    unittest.main()
