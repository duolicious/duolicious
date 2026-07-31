import time
import unittest

from service.api.chat.online import _seconds_since


class TestSecondsSince(unittest.TestCase):
    def test_measures_the_time_since_the_sighting(self) -> None:
        self.assertEqual(_seconds_since(str(time.time() - 7200)), 7200)

    def test_clamps_a_sighting_yet_to_happen_to_no_time_at_all(self) -> None:
        self.assertEqual(_seconds_since(str(time.time() + 60)), 0)

    def test_reports_no_age_for_a_value_that_predates_sighting_times(
        self,
    ) -> None:
        stored = '{"kind": "OnlineEvent", "username": "u1", "status": "online"}'

        self.assertIsNone(_seconds_since(stored))


if __name__ == '__main__':
    unittest.main()
