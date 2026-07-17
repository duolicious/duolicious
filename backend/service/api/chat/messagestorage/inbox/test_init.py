import unittest

from service.api.chat.messagestorage.inbox import _composed_body


class TestComposedBody(unittest.TestCase):
    def test_no_reaction_returns_last_message(self) -> None:
        self.assertEqual(
            _composed_body('hey, how are you?', None, None),
            'hey, how are you?',
        )

    def test_reaction_decorates_its_target(self) -> None:
        self.assertEqual(
            _composed_body('a newer message', '👍', 'hey, how are you?'),
            'Reacted 👍 to: hey, how are you?',
        )

    def test_multiline_target(self) -> None:
        self.assertEqual(
            _composed_body('x', '😂', 'line one\nline two'),
            'Reacted 😂 to: line one\nline two',
        )


if __name__ == '__main__':
    unittest.main()
