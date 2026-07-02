import unittest
from antiabuse.antirude.displayname import is_rude

class TestIsRude(unittest.IsolatedAsyncioTestCase):

    async def test_rude_strings(self) -> None:
        self.assertTrue(
                await is_rude("You're a nigg"))

        self.assertTrue(
                await is_rude("You're a 𝖓𝖎𝖌𝖌𝖊𝖗"))

        self.assertTrue(
                await is_rude("ywnbaw is an acronym"))

    async def test_non_rude_strings(self) -> None:
        self.assertFalse(
                await is_rude("bot-reporter-of-sender-11"))

        self.assertFalse(
                await is_rude("go hug urself please"))

        self.assertFalse(
                await is_rude("I respect you"))

        self.assertFalse(
                await is_rude("Who're you listening to?"))

        self.assertFalse(
                await is_rude("Can u c my pfp?"))

        self.assertFalse(
                await is_rude("I am therapist"))


if __name__ == '__main__':
    unittest.main()
