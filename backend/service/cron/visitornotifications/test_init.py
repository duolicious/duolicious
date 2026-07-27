import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import patch, AsyncMock, MagicMock
from commonsql import (
    Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
)
from service.cron.visitornotifications import (
    VisitorNotification,
    compute_badges,
    do_send_email_notification,
    do_send_notification,
    send_mobile_notification,
    send_notification,
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
        self.assertFalse(do_send_email_notification(row))


class TestSendNotification(unittest.TestCase):

    @patch('service.cron.visitornotifications.send_email_notification')
    @patch('service.cron.visitornotifications.send_mobile_notification')
    def test_mobile_send_when_token_present(
        self,
        mock_send_mobile_notification: MagicMock,
        mock_send_email_notification: MagicMock,
    ) -> None:
        row = make_visitor_notification()

        asyncio.run(send_notification(row, badge=5))

        mock_send_mobile_notification.assert_called_once_with(row, badge=5)
        mock_send_email_notification.assert_not_called()

    @patch('service.cron.visitornotifications.send_email_notification')
    @patch('service.cron.visitornotifications.send_mobile_notification')
    def test_email_send_when_no_token(
        self,
        mock_send_mobile_notification: MagicMock,
        mock_send_email_notification: MagicMock,
    ) -> None:
        # No reachable push device (or the user was last seen on a web client):
        # the query returns a NULL token, so we email instead of pushing.
        row = make_visitor_notification(token=None)

        asyncio.run(send_notification(row, badge=None))

        mock_send_mobile_notification.assert_not_called()
        mock_send_email_notification.assert_called_once_with(row)

    @patch('service.cron.visitornotifications.disable_mobile_notifications')
    @patch('service.cron.visitornotifications.notify.enqueue_mobile_notification')
    def test_visitor_push_opens_the_visitors_tab(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False

        send_mobile_notification(make_visitor_notification(), badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], 'Someone visited your profile 👀')
        self.assertEqual(kwargs['body'], 'Someone visited your profile!')
        self.assertEqual(
                kwargs['data'],
                {'screen': 'Home', 'params': {'screen': 'Visitors'}})


class TestComputeBadges(unittest.TestCase):

    @patch(
        'service.cron.visitornotifications.increment_unseen_notification_count',
        new_callable=AsyncMock,
        return_value=5,
    )
    def test_increments_once_per_person(self, mock_increment: AsyncMock) -> None:
        # A person signed in on two devices produces two rows; the count must
        # increment once, with both rows badged with the same value.
        row_a = make_visitor_notification(token='device-a')
        row_b = make_visitor_notification(token='device-b')

        badges = asyncio.run(compute_badges([row_a, row_b]))

        mock_increment.assert_awaited_once_with(username=row_a.person_uuid)
        self.assertEqual(badges, {row_a.person_uuid: 5})

    @patch(
        'service.cron.visitornotifications.increment_unseen_notification_count',
        new_callable=AsyncMock,
    )
    def test_skips_email_rows(self, mock_increment: AsyncMock) -> None:
        # Emails don't badge an app icon, so the count is untouched
        row = make_visitor_notification(token=None)

        badges = asyncio.run(compute_badges([row]))

        mock_increment.assert_not_awaited()
        self.assertEqual(badges, {})

    @patch(
        'service.cron.visitornotifications.increment_unseen_notification_count',
        new_callable=AsyncMock,
    )
    def test_skips_unsendable_rows(self, mock_increment: AsyncMock) -> None:
        # `do_send_notification` will refuse this row (nothing new since the
        # last notification), so no push goes out and the count must not
        # increment.
        row = make_visitor_notification(
                last_visitor_notification_seconds=1693786064)

        badges = asyncio.run(compute_badges([row]))

        mock_increment.assert_not_awaited()
        self.assertEqual(badges, {})


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
