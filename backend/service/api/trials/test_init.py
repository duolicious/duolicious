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
            (399000, (False, True, True)),
            (399001, (False, True, True)),
            (399002, (False, False, True)),
            (399003, (False, False, True)),
            (399004, (False, True, False)),
            (399005, (False, True, False)),
            (399006, (False, False, False)),
            (399007, (False, False, False)),
            (399008, (False, True, True)),
            (400048, (False, True, True)),
            (400049, (False, True, True)),
            (400050, (True, False, True)),
            (400051, (False, False, True)),
            (400052, (True, True, False)),
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
