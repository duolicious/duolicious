import unittest
from service.cron.messagenotifications.template import (
    emailtemplate,
)
from serviceshared.unsubscribe import person_token

PERSON_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

class TestEmailTemplate(unittest.TestCase):

    def test_stuff(self) -> None:
        self.assertIn('a new message in your intros',
                      emailtemplate(PERSON_UUID, 'intro'))
        self.assertIn('a new message in your chats',
                      emailtemplate(PERSON_UUID, 'chat'))

    def test_a_message_email_says_nothing_about_visitors(self) -> None:
        message = emailtemplate(PERSON_UUID, 'chat')

        # Beyond the frequency links in its footer.
        self.assertNotIn('Someone visited your profile', message)
        self.assertIn('get.duolicious.app/inbox', message)

    def test_every_notification_type_can_be_capped(self) -> None:
        email = emailtemplate(PERSON_UUID, 'intro')

        for notification_type in ['Chats', 'Intros', 'Visitors']:
            for frequency in ['Immediately', 'Daily', 'Every+3+days',
                              'Weekly', 'Never']:
                self.assertIn(
                        f'type={notification_type}&frequency={frequency}',
                        email)

    def test_frequency_links_carry_a_signed_token(self) -> None:
        email = emailtemplate(PERSON_UUID, 'intro')

        self.assertIn(f'token={person_token(PERSON_UUID)}&', email)
        self.assertNotIn('email=', email)

if __name__ == '__main__':
    unittest.main()
