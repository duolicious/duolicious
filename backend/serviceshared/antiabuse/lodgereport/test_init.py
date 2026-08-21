import unittest
from serviceshared.antiabuse.lodgereport import is_bot_report

class TestIsOffensive(unittest.TestCase):

    def test_is_bot_report(self) -> None:
        self.assertTrue(is_bot_report("bot__"))
        self.assertTrue(is_bot_report("IT'S A DAMN BOT AGAIN"))
        self.assertTrue(is_bot_report("They asked for money (it's a bot)"))
        self.assertTrue(is_bot_report("cat fish"))
        self.assertTrue(is_bot_report("they're a catfish"))
        self.assertTrue(is_bot_report("catfishing"))

    def test_is_not_bot_report(self) -> None:
        self.assertFalse(is_bot_report("they were mean to me"))
        self.assertFalse(is_bot_report("racism"))
        self.assertFalse(is_bot_report("They asked for money"))
