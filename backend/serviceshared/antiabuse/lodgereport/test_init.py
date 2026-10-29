import unittest
from serviceshared.antiabuse.lodgereport import (
    is_bot_report,
    is_underage_report,
    report_subject,
)

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

    def test_is_underage_report(self) -> None:
        self.assertTrue(is_underage_report("MINOR"))
        self.assertTrue(is_underage_report("they're underage"))
        self.assertTrue(is_underage_report("under-age"))
        self.assertTrue(is_underage_report("under 18"))
        self.assertTrue(is_underage_report("they're not 18"))
        self.assertTrue(is_underage_report("Not eighteen!!"))
        self.assertTrue(is_underage_report("they arent 18"))
        self.assertTrue(is_underage_report("she isn't an adult"))
        self.assertTrue(is_underage_report("under the age of 18"))
        self.assertTrue(is_underage_report("said they're 16yo"))
        self.assertTrue(is_underage_report("15 y/o"))
        self.assertTrue(is_underage_report("17 years old"))
        self.assertTrue(is_underage_report(
            "This is a 15 year old on this platform"))
        self.assertTrue(is_underage_report("a 15-year-old"))
        self.assertTrue(is_underage_report("16yr old"))
        self.assertTrue(is_underage_report("14 yrs old"))
        self.assertTrue(is_underage_report("15 years old"))
        self.assertTrue(is_underage_report("She claims to be 15 on her bio"))
        self.assertTrue(is_underage_report(
            "profile bio says they are 15 (26-11)"))
        self.assertTrue(is_underage_report("bio says they're 16"))
        self.assertTrue(is_underage_report("still in high school"))
        self.assertTrue(is_underage_report("literally a kid"))
        self.assertTrue(is_underage_report("she is actually 16"))
        self.assertTrue(is_underage_report("he's 15"))
        self.assertTrue(is_underage_report("they're only 17"))
        self.assertTrue(is_underage_report("she is 16 in her bio"))
        self.assertTrue(is_underage_report("I think she's not even 18"))
        self.assertTrue(is_underage_report("talks about dating minors"))
        self.assertTrue(is_underage_report("teenagers on here"))

    def test_is_not_underage_report(self) -> None:
        self.assertFalse(is_underage_report("they were mean to me"))
        self.assertFalse(is_underage_report("are you kidding me"))
        self.assertFalse(is_underage_report("18 years old and rude"))
        self.assertFalse(is_underage_report("117 years old"))
        self.assertFalse(is_underage_report(
            "they said offensive things about minorities"))
        self.assertFalse(is_underage_report("she is 18"))
        self.assertFalse(is_underage_report("he's 170cm, not 190cm"))
        self.assertFalse(is_underage_report("she is 15 minutes away"))
        self.assertFalse(is_underage_report("this is 10 times worse"))

    def test_report_subject(self) -> None:
        report_obj = [
            dict(id=12, times_reported=0),
            dict(id=34, times_reported=5),
        ]

        self.assertEqual(
            report_subject(report_obj, False, False, None),
            "Report: (5) 12 - 34",
        )
        self.assertEqual(
            report_subject(report_obj, True, False, None),
            "Report: (5) 12 - 34 [automoded]",
        )
        self.assertEqual(
            report_subject(report_obj, True, True, 'member report'),
            "Report: (5) 12 - 34 [automoded - shadow banned] [underage - member report]",
        )
        self.assertEqual(
            report_subject(report_obj, False, False, 'member report'),
            "Report: (5) 12 - 34 [underage - member report]",
        )
        self.assertEqual(
            report_subject(report_obj, False, False, 'chat model'),
            "Report: (5) 12 - 34 [underage - chat model]",
        )
