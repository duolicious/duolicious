import unittest
from service.api.chat.spam import is_spam

class TestIsOffensive(unittest.TestCase):

    def test_spam_strings(self) -> None:
        self.assertFalse(
                is_spam("I am therapist"))

        self.assertFalse(
                is_spam("https://media.tenor.com/dxsHgu0_-QAAAAAMx/meganleigh-megaxn.gif"))

        self.assertFalse(
                is_spam("https://static.klipy.com/ii/f87f46a2c5aeaeed4c68910815f73eaf/84/09/VBhPiYbU.gif"))

        # Because the domain isn't considered safe
        self.assertTrue(
                is_spam("look at this https://mycoolsite.com"))


if __name__ == '__main__':
    unittest.main()
