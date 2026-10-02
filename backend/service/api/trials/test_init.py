import unittest

from service.api.trials import sent_messages_in_chats


class TestSentMessagesInChats(unittest.TestCase):
    def test_arms(self) -> None:
        for person_id, expected in [
            (4, False),
            (389192, False),
            (389199, False),
            (389200, True),
            (389202, True),
            (389204, False),
            (389208, True),
        ]:
            with self.subTest(person_id=person_id):
                self.assertEqual(sent_messages_in_chats(person_id), expected)


if __name__ == '__main__':
    unittest.main()
