import unittest
from typing import TypedDict
from service.cron.notifications import (
    PersonNotification,
    do_send_email_notification,
)


class BaseNotificationKwargs(TypedDict):
    person_uuid: str
    name: str
    token: str | None


class TestDoSend(unittest.TestCase):

    def test_stuff(self) -> None:
        dont_care: BaseNotificationKwargs = dict(
            person_uuid='0',
            name='user0',
            token=None,
        )

        self.assertFalse(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@exaMPle.com',
            has_intro=True,
            has_chat=True,
            last_intro_seconds=1,
            last_chat_seconds=1,
            last_intro_notification_seconds=0,
            last_chat_notification_seconds=0,
            intros_drift_seconds=0,
            chats_drift_seconds=0)))

        self.assertFalse(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=True,
            has_chat=True,
            last_intro_seconds=1,
            last_chat_seconds=1,
            last_intro_notification_seconds=0,
            last_chat_notification_seconds=0,
            intros_drift_seconds=-1,
            chats_drift_seconds=-1)))

        self.assertFalse(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=False,
            has_chat=True,
            last_intro_seconds=1,
            last_chat_seconds=1,
            last_intro_notification_seconds=0,
            last_chat_notification_seconds=0,
            intros_drift_seconds=0,
            chats_drift_seconds=-1)))

        self.assertFalse(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=True,
            has_chat=False,
            last_intro_seconds=1,
            last_chat_seconds=1,
            last_intro_notification_seconds=0,
            last_chat_notification_seconds=0,
            intros_drift_seconds=-1,
            chats_drift_seconds=0)))

        self.assertTrue(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=True,
            has_chat=True,
            last_intro_seconds=1,
            last_chat_seconds=1,
            last_intro_notification_seconds=0,
            last_chat_notification_seconds=0,
            intros_drift_seconds=0,
            chats_drift_seconds=0)))

        self.assertTrue(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=True,
            has_chat=False,
            last_intro_seconds=100,
            last_chat_seconds=100,
            last_intro_notification_seconds=90,
            last_chat_notification_seconds=90,
            intros_drift_seconds=5,
            chats_drift_seconds=50)))

        self.assertTrue(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=False,
            has_chat=True,
            last_intro_seconds=100,
            last_chat_seconds=100,
            last_intro_notification_seconds=90,
            last_chat_notification_seconds=90,
            intros_drift_seconds=50,
            chats_drift_seconds=5)))

        self.assertFalse(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=True,
            has_chat=False,
            last_intro_seconds=100,
            last_chat_seconds=100,
            last_intro_notification_seconds=90,
            last_chat_notification_seconds=99,
            intros_drift_seconds=50,
            chats_drift_seconds=5)))

        self.assertFalse(do_send_email_notification(PersonNotification(
            **dont_care,
            email='asdf@notexample.com',
            has_intro=False,
            has_chat=True,
            last_intro_seconds=100,
            last_chat_seconds=100,
            last_intro_notification_seconds=99,
            last_chat_notification_seconds=90,
            intros_drift_seconds=5,
            chats_drift_seconds=50)))

        real_notification = PersonNotification(
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
            token=None,
        )

        self.assertFalse(do_send_email_notification(real_notification))

if __name__ == '__main__':
    unittest.main()
