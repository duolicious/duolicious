import unittest
from service.api.chat.dailyintrolimit import intro_limit_block, Sender
from service.api.chatprotocol.outbound import MessageBlocked


def sender(**overrides: int) -> Sender:
    return Sender(**(dict(
        verification_level_id=1,
        daily_intro_count=0,
        recent_manual_report_count=0,
        recent_rude_message_count=0,
    ) | overrides))


def block(subreason: str | None = None) -> MessageBlocked:
    return MessageBlocked(
        stanza_id='id',
        reason='rate-limited-1day',
        subreason=subreason,
    )


class TestIntroLimitBlock(unittest.TestCase):
    def assert_limit(
        self,
        daily_intros: int,
        expected_block: MessageBlocked,
        **overrides: int,
    ) -> None:
        for daily_intro_count in [daily_intros, daily_intros + 1]:
            self.assertEqual(
                intro_limit_block(
                    sender(daily_intro_count=daily_intro_count, **overrides),
                    'id'),
                expected_block,
            )

        self.assertIsNone(
            intro_limit_block(
                sender(daily_intro_count=daily_intros - 1, **overrides),
                'id'),
        )

    def test_unverified(self) -> None:
        self.assert_limit(
            32, block('unverified-basics'),
            verification_level_id=1)

    def test_basics_verified(self) -> None:
        self.assert_limit(
            64, block('unverified-photos'),
            verification_level_id=2)

    def test_photos_verified(self) -> None:
        self.assert_limit(
            128, block(),
            verification_level_id=3)

    def test_each_report_halves_the_limit(self) -> None:
        self.assert_limit(
            8, block('unverified-basics'),
            verification_level_id=1, recent_manual_report_count=2)

    def test_every_two_rude_messages_halve_the_limit(self) -> None:
        self.assert_limit(
            64, block(),
            verification_level_id=3, recent_rude_message_count=3)

    def test_reports_and_rude_messages_combine(self) -> None:
        self.assert_limit(
            8, block('unverified-photos'),
            verification_level_id=2,
            recent_manual_report_count=1,
            recent_rude_message_count=4)

    def test_no_verification_subreason_when_the_limit_is_zero(self) -> None:
        for overrides in [
            dict(verification_level_id=1, recent_manual_report_count=6),
            dict(verification_level_id=2, recent_manual_report_count=7),
            dict(verification_level_id=3, recent_manual_report_count=8),
            dict(verification_level_id=2, recent_rude_message_count=14),
        ]:
            self.assertEqual(intro_limit_block(sender(**overrides), 'id'), block())


if __name__ == '__main__':
    unittest.main()
