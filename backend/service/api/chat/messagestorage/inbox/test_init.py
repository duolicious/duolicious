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

    def test_gif_last_message(self) -> None:
        self.assertEqual(
            _composed_body(
                'https://static.klipy.com/ii/abc123.gif', None, None),
            '🖼️ GIF',
        )

    def test_legacy_tenor_gif_last_message(self) -> None:
        self.assertEqual(
            _composed_body(
                'https://media.tenor.com/abc123.gif', None, None),
            '🖼️ GIF',
        )

    def test_reaction_to_a_gif(self) -> None:
        self.assertEqual(
            _composed_body(
                'x', '👍', 'https://static.klipy.com/ii/abc123.webp'),
            'Reacted 👍 to: 🖼️ GIF',
        )

    def test_non_gif_url_is_left_alone(self) -> None:
        self.assertEqual(
            _composed_body('https://example.com/abc.gif', None, None),
            'https://example.com/abc.gif',
        )


if __name__ == '__main__':
    unittest.main()
