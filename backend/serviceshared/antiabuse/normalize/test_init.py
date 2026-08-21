import unittest
from serviceshared.antiabuse.normalize import (
    normalize_string,
)

class TestNormalizeString(unittest.TestCase):
    def test_normalize_string(self) -> None:
        normalizeable_phrases = [
            "fuck",
            "cum",
            "rape",
            "kill you",
        ]

        self.assertEqual(
                normalize_string("I'm gonna fck you", normalizeable_phrases),
                "I'm gonna fuck you")

        self.assertEqual(
                normalize_string("I'm gonna cvm on u", normalizeable_phrases),
                "I'm gonna cum on u")

        self.assertEqual(
                normalize_string("I'm gonna kill u", normalizeable_phrases),
                "I'm gonna kill you")

        self.assertEqual(
                normalize_string("I'm gonna r4p3 you", normalizeable_phrases),
                "I'm gonna rape you")


if __name__ == '__main__':
    unittest.main()
