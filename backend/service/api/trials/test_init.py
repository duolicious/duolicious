import unittest

from service.api.trials import sent_messages_in_chats


class TestSentMessagesInChats(unittest.TestCase):
    def test_arms(self) -> None:
        for person_id, expected in [
            (4, False),
            (389200, False),
            (390698, False),
            (390699, False),
            (390700, True),
            (390701, False),
            (390702, True),
            (390703, False),
        ]:
            with self.subTest(person_id=person_id):
                self.assertEqual(sent_messages_in_chats(person_id), expected)


if __name__ == '__main__':
    unittest.main()
