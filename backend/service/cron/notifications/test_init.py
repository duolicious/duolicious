import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import patch, AsyncMock, MagicMock
from commonsql import (
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
)
from service.cron.notifications import (
    NotificationKind,
    PersonNotification,
    compute_badges,
    do_send_notification,
    is_chat_sendable,
    is_intro_sendable,
    is_visitor_sendable,
    maybe_send_notification,
    notification_screen,
    send_mobile_notification,
    send_notification,
    sendable_kinds,
    update_last_notification_time,
)
import asyncio
import json

def make_person_notification(**overrides: str | int | bool | None) -> PersonNotification:
    row = PersonNotification(
        person_uuid='2',
        last_intro_notification_seconds=1693786048,
        last_chat_notification_seconds=1693786048,
        last_visitor_notification_seconds=1693786048,
        has_intro=True,
        has_chat=True,
        has_visitor=False,
        last_intro_seconds=1693786124,
        last_chat_seconds=100,
        last_visitor_seconds=0,
        name='jk',
        email='user.1@gmail.com',
        chats_drift_seconds=0,
        intros_drift_seconds=86400,
        visitors_drift_seconds=604800,
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
        asyncio.run(send_notification(person_notification, 'message', badge=5))

        # Assert that send_mobile_notification was called with the badge
        mock_send_mobile_notification.assert_called_once_with(
                person_notification, 'message', badge=5)

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

        asyncio.run(send_notification(row, 'message', badge=None))

        mock_send_mobile_notification.assert_not_called()
        mock_send_email_notification.assert_called_once_with(row, 'message')


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
        self.assertEqual(badges, {(row_a.person_uuid, 'message'): 5})

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


def make_visitor_only_notification(
    **overrides: str | int | bool | None,
) -> PersonNotification:
    return make_person_notification(
        has_intro=False,
        has_chat=False,
        has_visitor=True,
        last_visitor_notification_seconds=0,
        last_visitor_seconds=1693786124,
        **overrides,
    )


class TestVisitorNotifications(unittest.TestCase):

    def test_visitor_alone_is_worth_notifying_about(self) -> None:
        row = make_visitor_only_notification()

        self.assertTrue(is_visitor_sendable(row))
        self.assertTrue(do_send_notification(row))
        self.assertEqual(sendable_kinds(row), ['visitor'])

    def test_never_suppresses_visitor_notifications(self) -> None:
        row = make_visitor_only_notification(visitors_drift_seconds=-1)

        self.assertFalse(is_visitor_sendable(row))
        self.assertFalse(do_send_notification(row))
        self.assertEqual(sendable_kinds(row), [])

    def test_drift_period_defers_visitor_notifications(self) -> None:
        # The last visit landed a minute after the last notification, well
        # inside the weekly drift period, so it waits.
        row = make_visitor_only_notification(
                last_visitor_notification_seconds=1693786064)

        self.assertFalse(is_visitor_sendable(row))

    @patch('service.cron.notifications.disable_mobile_notifications')
    @patch('service.cron.notifications.notify.enqueue_mobile_notification')
    def test_visitor_push_opens_the_visitors_tab(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False
        row = make_visitor_only_notification()

        send_mobile_notification(row, 'visitor', badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(kwargs['title'], 'Someone visited your profile 👀')
        self.assertEqual(kwargs['body'], 'Someone visited your profile!')
        self.assertEqual(
                kwargs['data'],
                {'screen': 'Home', 'params': {'screen': 'Visitors'}})

    def test_a_message_sends_the_reader_to_the_inbox(self) -> None:
        self.assertEqual(
                notification_screen('message'),
                {'screen': 'Home', 'params': {'screen': 'Inbox'}})


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

    @patch('service.cron.notifications.disable_mobile_notifications')
    @patch('service.cron.notifications.notify.enqueue_mobile_notification')
    def test_one_notification_names_both_kinds(
        self,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False

        send_mobile_notification(self.capped_intro_row(), 'message', badge=1)

        [kwargs] = [call.kwargs for call in mock_enqueue.call_args_list]
        self.assertEqual(
                kwargs['body'],
                'You have new messages in your chats and intros!')

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
            asyncio.run(update_last_notification_time(
                self.capped_intro_row(), 'message'))

        self.assertEqual(executed, [
            Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
            Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
        ])


class TestMessagesAndVisitsAreNotifiedSeparately(unittest.TestCase):

    def message_and_visitor_row(self) -> PersonNotification:
        # An unread intro and a visit, both newer than the last notification of
        # their kind, so both are due at once.
        return make_person_notification(
            has_chat=False,
            has_visitor=True,
            last_intro_notification_seconds=0,
            last_visitor_notification_seconds=0,
            last_visitor_seconds=1693786124,
        )

    def test_both_kinds_are_due(self) -> None:
        self.assertEqual(
                sendable_kinds(self.message_and_visitor_row()),
                ['message', 'visitor'])

    @patch('service.cron.notifications.disable_mobile_notifications')
    @patch('service.cron.notifications.notify.enqueue_mobile_notification')
    @patch(
        'service.cron.notifications.update_last_notification_time',
        new_callable=AsyncMock,
    )
    def test_two_pushes_are_sent(
        self,
        mock_update: AsyncMock,
        mock_enqueue: MagicMock,
        mock_disable: MagicMock,
    ) -> None:
        mock_disable.return_value = False
        row = self.message_and_visitor_row()
        badges: dict[tuple[str, NotificationKind], int | None] = {
            (row.person_uuid, 'message'): 1,
            (row.person_uuid, 'visitor'): 2,
        }

        asyncio.run(maybe_send_notification(row, badges))

        sent = [
            (call.kwargs['title'], call.kwargs['body'], call.kwargs['badge'],
             call.kwargs['data']['params']['screen'])
            for call in mock_enqueue.call_args_list
        ]
        self.assertEqual(sent, [
            (
                'You have a new message 😍',
                'You have a new message in your intros!',
                1,
                'Inbox',
            ),
            (
                'Someone visited your profile 👀',
                'Someone visited your profile!',
                2,
                'Visitors',
            ),
        ])

        # Each notification stamps only its own last-notification time.
        self.assertEqual(
                [call.args[1] for call in mock_update.await_args_list],
                ['message', 'visitor'])

    @patch(
        'service.cron.notifications.increment_unseen_notification_count',
        new_callable=AsyncMock,
        side_effect=[1, 2],
    )
    def test_badges_count_each_notification(
        self,
        mock_increment: AsyncMock,
    ) -> None:
        row = self.message_and_visitor_row()

        badges = asyncio.run(compute_badges([row]))

        self.assertEqual(badges, {
            (row.person_uuid, 'message'): 1,
            (row.person_uuid, 'visitor'): 2,
        })


if __name__ == '__main__':
    unittest.main()
