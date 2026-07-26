import unittest
from service.cron.notifications.template import emailtemplate, subject_line

class TestEmailTemplate(unittest.TestCase):

    def test_stuff(self) -> None:
        e1 = emailtemplate(
                'mail@example.com',
                has_intro=True,
                has_chat=True,
                has_visitor=False)
        e2 = emailtemplate(
                'mail@example.com',
                has_intro=True,
                has_chat=False,
                has_visitor=False)
        e3 = emailtemplate(
                'mail@example.com',
                has_intro=False,
                has_chat=True,
                has_visitor=False)
        e4 = emailtemplate(
                'mail@example.com',
                has_intro=False,
                has_chat=False,
                has_visitor=False)

        self.assertIn('new messages', e1)
        self.assertIn('a new message', e2)
        self.assertIn('a new message', e3)
        self.assertIn('support@duolicious.app', e4)

    def test_visitors(self) -> None:
        visitor_only = emailtemplate(
                'mail@example.com',
                has_intro=False,
                has_chat=False,
                has_visitor=True)
        visitor_and_chat = emailtemplate(
                'mail@example.com',
                has_intro=False,
                has_chat=True,
                has_visitor=True)

        self.assertIn('Someone visited your profile!', visitor_only)
        self.assertIn('get.duolicious.app/visitors', visitor_only)
        self.assertNotIn('get.duolicious.app/inbox', visitor_only)

        self.assertIn('Someone visited your profile!', visitor_and_chat)
        self.assertIn('a new message in your chats!', visitor_and_chat)
        self.assertIn('get.duolicious.app/inbox', visitor_and_chat)

    def test_every_notification_type_can_be_capped(self) -> None:
        email = emailtemplate(
                'mail@example.com',
                has_intro=True,
                has_chat=True,
                has_visitor=True)

        for notification_type in ['Chats', 'Intros', 'Visitors']:
            for frequency in ['Immediately', 'Daily', 'Every+3+days',
                              'Weekly', 'Never']:
                self.assertIn(
                        f'type={notification_type}&frequency={frequency}',
                        email)

    def test_subject_line(self) -> None:
        self.assertEqual(
                subject_line(
                    has_intro=False, has_chat=False, has_visitor=True),
                'Someone visited your profile 👀')
        self.assertEqual(
                subject_line(
                    has_intro=False, has_chat=True, has_visitor=True),
                'You have a new message 😍')

if __name__ == '__main__':
    unittest.main()
