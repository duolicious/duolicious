import unittest
from unittest.mock import patch, AsyncMock, MagicMock
from service.cron.messagenotifications import (
    MESSAGE_NOTIFICATIONS,
    PersonNotification,
)
from service.cron.notificationdispatch import (
    compute_badges,
    send_notification,
)
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


class TestSendNotification(unittest.TestCase):

    @patch('service.cron.notificationdispatch.send_email_notification')
    @patch('service.cron.notificationdispatch.send_mobile_notification')
    def test_mobile_send_when_token_present(
        self,
        mock_send_mobile_notification: MagicMock,
        mock_send_email_notification: MagicMock,
    ) -> None:
        row = make_person_notification()

        asyncio.run(send_notification(MESSAGE_NOTIFICATIONS, row, badge=5))

        mock_send_mobile_notification.assert_called_once_with(
                MESSAGE_NOTIFICATIONS, row, badge=5)
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
        row = make_person_notification(token=None)

        asyncio.run(send_notification(MESSAGE_NOTIFICATIONS, row, badge=None))

        mock_send_mobile_notification.assert_not_called()
        mock_send_email_notification.assert_called_once_with(
                MESSAGE_NOTIFICATIONS, row)


class TestComputeBadges(unittest.TestCase):

    @patch(
        'service.cron.notificationdispatch.increment_unseen_notification_count',
        new_callable=AsyncMock,
        return_value=5,
    )
    def test_increments_once_per_person(self, mock_increment: AsyncMock) -> None:
        # A person signed in on two devices produces two rows; the count must
        # increment once, with both rows badged with the same value. Zeroing
        # `last_chat_notification_seconds` makes the rows pass `is_sendable`
        # (there's a chat newer than the last notification).
        row_a = make_person_notification(
                token='device-a',
                last_chat_notification_seconds=0)
        row_b = make_person_notification(
                token='device-b',
                last_chat_notification_seconds=0)

        badges = asyncio.run(
                compute_badges(MESSAGE_NOTIFICATIONS, [row_a, row_b]))

        mock_increment.assert_awaited_once_with(username=row_a.person_uuid)
        self.assertEqual(badges, {row_a.person_uuid: 5})

    @patch(
        'service.cron.notificationdispatch.increment_unseen_notification_count',
        new_callable=AsyncMock,
    )
    def test_skips_email_rows(self, mock_increment: AsyncMock) -> None:
        # Emails don't badge an app icon, so the count is untouched
        row = make_person_notification(token=None)

        badges = asyncio.run(compute_badges(MESSAGE_NOTIFICATIONS, [row]))

        mock_increment.assert_not_awaited()
        self.assertEqual(badges, {})

    @patch(
        'service.cron.notificationdispatch.increment_unseen_notification_count',
        new_callable=AsyncMock,
    )
    def test_skips_unsendable_rows(self, mock_increment: AsyncMock) -> None:
        # `is_sendable` will refuse this row (nothing new since the last
        # notification), so no push goes out and the count must not increment.
        row = make_person_notification(
                has_intro=False,
                has_chat=False)

        badges = asyncio.run(compute_badges(MESSAGE_NOTIFICATIONS, [row]))

        mock_increment.assert_not_awaited()
        self.assertEqual(badges, {})


if __name__ == '__main__':
    unittest.main()
