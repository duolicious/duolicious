import unittest

from serviceshared.antiabuse.minorconfession.stage1 import (
    may_confess_minor,
)


class TestMayConfessMinor(unittest.TestCase):
    def test_confessions(self) -> None:
        for message in [
            "I'm 16",
            'im only 15 lol',
            "I'm not 18 yet",
            'pretty sure im too young for this app',
            'i lied about my age when i signed up',
            'got banned last time because of my age',
            'i turn 18 in march',
            'still in high school',
            'tengo 15 años',
            'my profile says 19 but im actually younger',
        ]:
            with self.subTest(message=message):
                self.assertTrue(may_confess_minor(message))

    def test_non_confessions(self) -> None:
        for message in [
            'hey how are you',
            'what are you up to tonight',
            'I love hiking and cooking',
            'lol same',
            'I work as a nurse',
            'do you have any pets?',
        ]:
            with self.subTest(message=message):
                self.assertFalse(may_confess_minor(message))


if __name__ == '__main__':
    unittest.main()
