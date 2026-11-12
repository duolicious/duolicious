import unittest

from service.api.trials import (
    messages_received_sort_until_answered,
    no_message_count_filter_in_feed,
    web_push_when_offline,
)


class TestTrials(unittest.TestCase):
    def test_arms(self) -> None:
        for person_id, expected in [
            (4, (False, False, False)),
            (398992, (False, False, False)),
            (398999, (False, False, False)),
            (399000, (True, True, True)),
            (399001, (False, True, True)),
            (399002, (True, False, True)),
            (399003, (False, False, True)),
            (399004, (True, True, False)),
            (399005, (False, True, False)),
            (399006, (True, False, False)),
            (399007, (False, False, False)),
            (399008, (True, True, True)),
        ]:
            with self.subTest(person_id=person_id):
                self.assertEqual(
                    (
                        messages_received_sort_until_answered(person_id),
                        no_message_count_filter_in_feed(person_id),
                        web_push_when_offline(person_id),
                    ),
                    expected,
                )


if __name__ == '__main__':
    unittest.main()
