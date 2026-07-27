import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import patch, AsyncMock, MagicMock
from commonsql import (
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
)
from service.cron.notifications import (
    PersonNotification,
    compute_badges,
    do_send_notification,
    is_chat_sendable,
    is_intro_sendable,
    send_mobile_notification,
    send_notification,
    update_last_notification_time,
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


person_notification = make_person_notification()

class TestSendNotification(unittest.TestCase):

    @patch('service.cron.notifications.send_email_notification')
    @patch('service.cron.notifications.send_mobile_notification')
    def test_mobile_send_when_token_present(
        self,
        mock_send_mobile_notification: MagicMock,
        mock_send_email_notification: MagicMock,
    ) -> None:
        # Call the send_notification function
        asyncio.run(send_notification(person_notification, badge=5))

        # Assert that send_mobile_notification was called with the badge
        mock_send_mobile_notification.assert_called_once_with(
                person_notification, badge=5)

        # Assert that send_email_notification was not called
        mock_send_email_notification.assert_not_called()

    @patch('service.cron.notifications.send_email_notification')
    @patch('service.cron.notifications.send_mobile_notification')
    def test_email_send_when_no_token(
        self,
        mock_send_mobile_notification: MagicMock,
        mock_send_email_notification: MagicMock,
    ) -> None:
        # No reachable push device (or the user was last seen on a web client):
        # the query returns a NULL token, so we email instead of pushing.
        row = make_person_notification(token=None)

        asyncio.run(send_notification(row, badge=None))

        mock_send_mobile_notification.assert_not_called()
        mock_send_email_notification.assert_called_once_with(row)


class TestComputeBadges(unittest.TestCase):

    @patch(
        'service.cron.notifications.increment_unseen_notification_count',
        new_callable=AsyncMock,
        return_value=5,
    )
    def test_increments_once_per_person(self, mock_increment: AsyncMock) -> None:
        # A person signed in on two devices produces two rows; the count must
        # increment once, with both rows badged with the same value. Zeroing
        # `last_chat_notification_seconds` makes the rows pass
        # `do_send_notification` (there's a chat newer than the last
        # notification).
        row_a = make_person_notification(
                token='device-a',
                last_chat_notification_seconds=0)
        row_b = make_person_notification(
                token='device-b',
                last_chat_notification_seconds=0)

        badges = asyncio.run(compute_badges([row_a, row_b]))

        mock_increment.assert_awaited_once_with(username=row_a.person_uuid)
        self.assertEqual(badges, {row_a.person_uuid: 5})

    @patch(
        'service.cron.notifications.increment_unseen_notification_count',
        new_callable=AsyncMock,
    )
    def test_skips_email_rows(self, mock_increment: AsyncMock) -> None:
        # Emails don't badge an app icon, so the count is untouched
        row = make_person_notification(token=None)

        badges = asyncio.run(compute_badges([row]))

        mock_increment.assert_not_awaited()
        self.assertEqual(badges, {})

    @patch(
        'service.cron.notifications.increment_unseen_notification_count',
        new_callable=AsyncMock,
    )
    def test_skips_unsendable_rows(self, mock_increment: AsyncMock) -> None:
        # `do_send_notification` will refuse this row (nothing new since the
        # last notification), so no push goes out and the count must not
        # increment.
        row = make_person_notification(
                has_intro=False,
                has_chat=False)

        badges = asyncio.run(compute_badges([row]))

        mock_increment.assert_not_awaited()
        self.assertEqual(badges, {})


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

    @patch('service.cron.notifications.disable_mobile_notifications')
    @patch('service.cron.notifications.notify.enqueue_mobile_notification')
    def test_one_notification_names_both_kinds(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False

        send_mobile_notification(self.capped_intro_row(), badge=1)

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

        with patch('service.cron.notifications.api_tx', api_tx):
            asyncio.run(update_last_notification_time(self.capped_intro_row()))

        self.assertEqual(executed, [
            Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
            Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
        ])


if __name__ == '__main__':
    unittest.main()
