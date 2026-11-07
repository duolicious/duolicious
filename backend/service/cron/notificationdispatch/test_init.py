import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
from unittest.mock import patch, AsyncMock, MagicMock
from serviceshared.commonsql import Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME
from service.cron.messagenotifications import CHAT_NOTIFICATIONS
from service.cron.notificationdispatch import (
    Notification,
    compute_badges,
    do_send_email_notification,
    send_notification,
    send_pending_notifications_once,
    update_last_notification_time,
)
from service.cron.notificationdispatch.sql import Q_DELETE_SENT_NOTIFICATION
from serviceshared.batcher import drain_all
from serviceshared.util import Json
import asyncio

def make_notification(**overrides: str | int | None) -> Notification:
    row = Notification(
        person_id=1,
        person_uuid='2',
        event_at=datetime(2023, 9, 4),
        name='jk',
        email='user.1@gmail.com',
        unseen_count=1,
        token='asdf',
    )
    for key, value in overrides.items():
        setattr(row, key, value)
    return row


class TestSendNotification(unittest.TestCase):

    @patch('service.cron.notificationdispatch.send_email_notification')
    @patch('service.cron.notificationdispatch.send_mobile_notification')
    def test_mobile_send_when_token_present(
        self,
        mock_send_mobile_notification: MagicMock,
        mock_send_email_notification: MagicMock,
    ) -> None:
        row = make_notification()

        asyncio.run(send_notification(CHAT_NOTIFICATIONS, row, badge=5))

        mock_send_mobile_notification.assert_called_once_with(
                CHAT_NOTIFICATIONS, row, badge=5)
        mock_send_email_notification.assert_not_called()

    @patch('service.cron.notificationdispatch.send_email_notification')
    @patch('service.cron.notificationdispatch.send_mobile_notification')
    def test_email_send_when_no_token(
        self,
        mock_send_mobile_notification: MagicMock,
        mock_send_email_notification: MagicMock,
    ) -> None:
        # No reachable push device (or the user was last seen on a web client):
        # the query returns a NULL token, so we email instead of pushing.
        row = make_notification(token=None)

        asyncio.run(send_notification(CHAT_NOTIFICATIONS, row, badge=None))

        mock_send_mobile_notification.assert_not_called()
        mock_send_email_notification.assert_called_once_with(
                CHAT_NOTIFICATIONS, row)

    def test_example_addresses_are_not_emailed(self) -> None:
        self.assertTrue(do_send_email_notification(
                make_notification(email='user.1@example.org')))
        self.assertFalse(do_send_email_notification(
                make_notification(email='user.1@exaMPle.com')))


class TestComputeBadges(unittest.TestCase):

    @patch(
        'service.cron.notificationdispatch.increment_unseen_notification_count',
        new_callable=AsyncMock,
        return_value=5,
    )
    def test_increments_once_per_person(self, mock_increment: AsyncMock) -> None:
        # A person signed in on two devices produces two rows; the count must
        # increment once, with both rows badged with the same value.
        row_a = make_notification(token='device-a')
        row_b = make_notification(token='device-b')

        badges = asyncio.run(compute_badges([row_a, row_b]))

        mock_increment.assert_awaited_once_with(username=row_a.person_uuid)
        self.assertEqual(badges, {row_a.person_uuid: 5})

    @patch(
        'service.cron.notificationdispatch.increment_unseen_notification_count',
        new_callable=AsyncMock,
    )
    def test_skips_email_rows(self, mock_increment: AsyncMock) -> None:
        # Emails don't badge an app icon, so the count is untouched
        row = make_notification(token=None)

        badges = asyncio.run(compute_badges([row]))

        mock_increment.assert_not_awaited()
        self.assertEqual(badges, {})


class TestUpdateLastNotificationTime(unittest.TestCase):

    def test_stamps_and_removes_only_the_sent_event(self) -> None:
        executed: list[tuple[str, dict[str, Json]]] = []

        class Tx:
            async def execute(self, query: str, params: dict[str, Json]) -> None:
                executed.append((query, params))

        @asynccontextmanager
        async def api_tx(isolation: str) -> AsyncIterator[Tx]:
            yield Tx()

        row = make_notification()

        with patch('service.cron.notificationdispatch.api_tx', api_tx):
            asyncio.run(update_last_notification_time(CHAT_NOTIFICATIONS, row))

        self.assertEqual(executed, [
            (Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME, dict(username='2')),
            (Q_DELETE_SENT_NOTIFICATION, dict(
                person_id=1, kind='chat', event_at=row.event_at)),
        ])


class TestSendPendingNotificationsOnce(unittest.TestCase):

    @patch(
        'service.cron.notificationdispatch.update_last_notification_time',
        new_callable=AsyncMock,
    )
    @patch(
        'service.cron.notificationdispatch.send_notification',
        new=lambda *_: asyncio.sleep(0.1),
    )
    @patch(
        'service.cron.notificationdispatch.compute_badges',
        new=AsyncMock(return_value={}),
    )
    def test_records_a_send_that_shutdown_cancels(
        self,
        mock_update: AsyncMock,
    ) -> None:
        row = make_notification()

        class Cursor:
            async def fetchall(self) -> list[dict[str, Json]]:
                return [asdict(row)]

        class Tx:
            async def execute(self, query: str) -> Cursor:
                return Cursor()

        @asynccontextmanager
        async def api_tx(isolation: str) -> AsyncIterator[Tx]:
            yield Tx()

        async def cancel_mid_send() -> None:
            job = asyncio.create_task(
                    send_pending_notifications_once(CHAT_NOTIFICATIONS))
            await asyncio.sleep(0.05)
            job.cancel()
            await drain_all()

        with patch('service.cron.notificationdispatch.api_tx', api_tx):
            asyncio.run(cancel_mid_send())

        mock_update.assert_awaited_once_with(CHAT_NOTIFICATIONS, row)


if __name__ == '__main__':
    unittest.main()
