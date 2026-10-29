import unittest

from serviceshared.antiabuse.minorconfession.stage2 import (
    is_minor_confession,
)


class TestIsMinorConfession(unittest.TestCase):
    def test_confessions(self) -> None:
        for before, target in [
            ([(False, 'how old are you?')], "16, I know I'm not supposed to be here"),
            ([(False, 'hey whats up')], "honestly I'm only 15, I lied about my age to sign up"),
            ([(False, 'your profile says 19?')], "yeah that's fake, I'm actually 17"),
        ]:
            with self.subTest(target=target):
                self.assertTrue(is_minor_confession(
                    claimed_age=18,
                    about='',
                    before=before,
                    target=target))

    def test_non_confessions(self) -> None:
        for before, target in [
            ([(False, 'how old were you when you moved?')], '16'),
            ([(False, 'do you have siblings?')], 'yeah my sister is 15'),
            ([(False, 'when did you start drawing?')], 'when I was 13, been at it since'),
        ]:
            with self.subTest(target=target):
                self.assertFalse(is_minor_confession(
                    claimed_age=27,
                    about='',
                    before=before,
                    target=target))


if __name__ == '__main__':
    unittest.main()
