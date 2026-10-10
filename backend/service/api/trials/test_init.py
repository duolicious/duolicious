import unittest

from service.api.trials import sent_messages_in_chats


class TestSentMessagesInChats(unittest.TestCase):
    def test_arms(self) -> None:
        for person_id, expected in [
            (4, False),
            (389200, False),
            (390248, False),
            (390249, False),
            (390250, True),
            (390251, False),
            (390252, True),
            (390253, False),
            (391398, True),
            (391399, False),
            (391400, False),
            (391401, False),
            (391402, False),
        ]:
            with self.subTest(person_id=person_id):
                self.assertEqual(sent_messages_in_chats(person_id), expected)


if __name__ == '__main__':
    unittest.main()
