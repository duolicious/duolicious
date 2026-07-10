import unittest

from service.api.chat.messagestorage.reaction import reaction_inbox_body


class TestReactionInboxBody(unittest.TestCase):

    def test_text_message(self) -> None:
        self.assertEqual(
            reaction_inbox_body('👍', 'hey, how are you?'),
            'Reacted 👍 to: hey, how are you?',
        )

    def test_multiline_message(self) -> None:
        self.assertEqual(
            reaction_inbox_body('😂', 'line one\nline two'),
            'Reacted 😂 to: line one\nline two',
        )

    def test_audio_message_body(self) -> None:
        audio_body = 'Voice message' + ' ' * 50
        self.assertEqual(
            reaction_inbox_body('❤️', audio_body),
            f'Reacted ❤️ to: {audio_body}',
        )


if __name__ == '__main__':
    unittest.main()
