import unittest

from service.api.trials import hide_rude_intros, sent_messages_in_chats


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
            (391400, True),
            (391548, True),
            (391549, False),
            (391550, False),
            (391551, False),
            (391552, False),
        ]:
            with self.subTest(person_id=person_id):
                self.assertEqual(sent_messages_in_chats(person_id), expected)


class TestHideRudeIntros(unittest.TestCase):
    def test_arms(self) -> None:
        for person_id, expected in [
            (4, False),
            (390452, False),
            (391550, False),
            (391558, False),
            (391559, False),
            (391560, True),
            (391561, False),
            (391562, True),
            (391563, False),
        ]:
            with self.subTest(person_id=person_id):
                self.assertEqual(hide_rude_intros(person_id), expected)


if __name__ == '__main__':
    unittest.main()
