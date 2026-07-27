import unittest
from service.cron.visitornotifications.template import (
    visitor_emailtemplate,
)

class TestVisitorEmailTemplate(unittest.TestCase):

    def test_visitors_get_their_own_email(self) -> None:
        visitor = visitor_emailtemplate('mail@example.com')

        self.assertIn('Someone visited your profile', visitor)
        self.assertIn('get.duolicious.app/visitors', visitor)
        self.assertNotIn('get.duolicious.app/inbox', visitor)
        self.assertNotIn('message', visitor)

    def test_every_notification_type_can_be_capped(self) -> None:
        email = visitor_emailtemplate('mail@example.com')

        for notification_type in ['Chats', 'Intros', 'Visitors']:
            for frequency in ['Immediately', 'Daily', 'Every+3+days',
                              'Weekly', 'Never']:
                self.assertIn(
                        f'type={notification_type}&frequency={frequency}',
                        email)

if __name__ == '__main__':
    unittest.main()
