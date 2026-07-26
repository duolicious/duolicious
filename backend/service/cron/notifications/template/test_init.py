import unittest
from service.cron.notifications.template import (
    emailtemplate,
    visitor_emailtemplate,
)

class TestEmailTemplate(unittest.TestCase):

    def test_stuff(self) -> None:
        e1 = emailtemplate('mail@example.com', has_intro=True, has_chat=True)
        e2 = emailtemplate('mail@example.com', has_intro=True, has_chat=False)
        e3 = emailtemplate('mail@example.com', has_intro=False, has_chat=True)
        e4 = emailtemplate('mail@example.com', has_intro=False, has_chat=False)

        self.assertIn('new messages', e1)
        self.assertIn('a new message', e2)
        self.assertIn('a new message', e3)
        self.assertIn('support@duolicious.app', e4)

    def test_visitors_get_their_own_email(self) -> None:
        visitor = visitor_emailtemplate('mail@example.com')
        message = emailtemplate(
                'mail@example.com', has_intro=False, has_chat=True)

        self.assertIn('Someone visited your profile', visitor)
        self.assertIn('get.duolicious.app/visitors', visitor)
        self.assertNotIn('get.duolicious.app/inbox', visitor)
        self.assertNotIn('message', visitor)

        # Conversely, a message email says nothing about visitors beyond the
        # frequency links in its footer.
        self.assertNotIn('Someone visited your profile', message)
        self.assertIn('get.duolicious.app/inbox', message)

    def test_every_notification_type_can_be_capped(self) -> None:
        emails = [
            emailtemplate('mail@example.com', has_intro=True, has_chat=True),
            visitor_emailtemplate('mail@example.com'),
        ]

        for email in emails:
            for notification_type in ['Chats', 'Intros', 'Visitors']:
                for frequency in ['Immediately', 'Daily', 'Every+3+days',
                                  'Weekly', 'Never']:
                    self.assertIn(
                            f'type={notification_type}&frequency={frequency}',
                            email)

if __name__ == '__main__':
    unittest.main()
