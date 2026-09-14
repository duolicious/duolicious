import unittest
from service.api.chat.ratelimit import (
    get_default_rate_limit,
    get_stanza,
    DefaultRateLimit,
    Row,
)
from service.api.chatprotocol.outbound import MessageBlocked


def make_row(**overrides: int) -> Row:
    """Return a Row with sensible defaults, overridden per-call."""
    defaults = dict(
        verification_level_id=1,
        daily_message_count=0,
        recent_manual_report_count=0,
        recent_rude_message_count=0,
    )
    defaults.update(overrides)
    return Row(**defaults)


class TestRateLimit(unittest.TestCase):
    # ──────────────────────────────────────────────────────────────
    #  PHOTOS default (verification_level_id = 3, value = 128)
    # ──────────────────────────────────────────────────────────────
    def test_photos_default_normal(self) -> None:
        """
        recent_manual_report_count = 0 ⇒ limit = 128
        """
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=3, daily_message_count=128 - 1)),
            DefaultRateLimit.NONE,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=3, daily_message_count=128)),
            DefaultRateLimit.PHOTOS,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=3, daily_message_count=400)),
            DefaultRateLimit.PHOTOS,
        )

    # ──────────────────────────────────────────────────────────────
    #  BASICS default (verification_level_id = 2, value = 64)
    # ──────────────────────────────────────────────────────────────
    def test_basics_halved_limit(self) -> None:
        """
        recent_manual_report_count = 1 halves the limit: 64 // 2 = 32
        """
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=2, recent_manual_report_count=1,
                daily_message_count=31)),
            DefaultRateLimit.NONE,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=2, recent_manual_report_count=1,
                daily_message_count=32)),
            DefaultRateLimit.BASICS,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=2, recent_manual_report_count=1,
                daily_message_count=33)),
            DefaultRateLimit.BASICS,
        )

    # ──────────────────────────────────────────────────────────────
    #  UNVERIFIED default (verification_level_id = 1, value = 32)
    # ──────────────────────────────────────────────────────────────
    def test_unverified_baseline_limit(self) -> None:
        """
        recent_manual_report_count = 0 ⇒ limit = 32
        """
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=1, daily_message_count=31)),
            DefaultRateLimit.NONE,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=1, daily_message_count=32)),
            DefaultRateLimit.UNVERIFIED,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=1, daily_message_count=34)),
            DefaultRateLimit.UNVERIFIED,
        )

    def test_unverified_quarter_limit(self) -> None:
        """
        recent_manual_report_count = 2 quarters the limit: 32 // 4 = 8
        """
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=1, recent_manual_report_count=2,
                daily_message_count=7)),
            DefaultRateLimit.NONE,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=1, recent_manual_report_count=2,
                daily_message_count=8)),
            DefaultRateLimit.UNVERIFIED,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=1, recent_manual_report_count=2,
                daily_message_count=9)),
            DefaultRateLimit.UNVERIFIED,
        )

    # ──────────────────────────────────────────────────────────────
    #  limit == 0 branch → fallback to max(DefaultRateLimit) (PHOTOS)
    # ──────────────────────────────────────────────────────────────
    def test_limit_zero_branch_returns_max_enum(self) -> None:
        """When the computed limit is zero, PHOTOS is returned."""
        # UNVERIFIED: 32 // 2**6 = 0
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=1, recent_manual_report_count=6)),
            DefaultRateLimit.PHOTOS,
        )
        # BASICS: 64 // 2**7 = 0
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=2, recent_manual_report_count=7)),
            DefaultRateLimit.PHOTOS,
        )
        # PHOTOS: 128 // 2**8 = 0
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=3, recent_manual_report_count=8)),
            DefaultRateLimit.PHOTOS,
        )

    # ──────────────────────────────────────────────────────────────
    #  recent_rude_message_count affects the penalty exponent
    # ──────────────────────────────────────────────────────────────
    def test_rude_messages_reduce_limit(self) -> None:
        """
        verification_level_id = 3 (PHOTOS, value 128)
        recent_rude_message_count = 2 → adds ⌊2 / 2⌋ = 1 to the exponent
        → limit = 128 // 2 = 64
        """
        # One message below the new limit
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=3,
                recent_rude_message_count=2,
                daily_message_count=128 // 2 - 1)),
            DefaultRateLimit.NONE,
        )
        # At the limit (and beyond) we are rate-limited
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=3,
                recent_rude_message_count=2,
                daily_message_count=128 // 2)),
            DefaultRateLimit.PHOTOS,
        )

    def test_combined_recent_and_rude_penalties(self) -> None:
        """
        verification_level_id = 2 (BASICS, value 64)
        recent_manual_report_count = 1  → +1 exponent
        recent_rude_message_count  = 4  → +⌊4 / 2⌋ = 2 exponent
        total exponent = 3 → limit = 64 // 2**3 = 8
        """
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=2,
                recent_manual_report_count=1,
                recent_rude_message_count=4,
                daily_message_count=7)),
            DefaultRateLimit.NONE,
        )
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=2,
                recent_manual_report_count=1,
                recent_rude_message_count=4,
                daily_message_count=8)),
            DefaultRateLimit.BASICS,
        )

    def test_rude_messages_can_force_zero_limit(self) -> None:
        """
        verification_level_id = 2 (BASICS, value 64)
        recent_rude_message_count = 14 → +⌊14 / 2⌋ = 7 exponent
        limit = 64 // 2**7 = 0 → fallback to max(DefaultRateLimit) (PHOTOS)
        """
        self.assertEqual(
            get_default_rate_limit(make_row(
                verification_level_id=2,
                recent_rude_message_count=14,
                daily_message_count=0)),
            DefaultRateLimit.PHOTOS,
        )

    # ──────────────────────────────────────────────────────────────
    #  Invalid verification_level_id
    # ──────────────────────────────────────────────────────────────
    def test_unhandled_verification_level(self) -> None:
        with self.assertRaises(Exception) as cm:
            get_default_rate_limit(make_row(verification_level_id=0))
        self.assertIn('Unhandled verification_level_id', str(cm.exception))

    # get_stanza tests

    def test_get_stanza_none(self) -> None:
        self.assertEqual(get_stanza(DefaultRateLimit.NONE, 'foo'), [])

    def test_get_stanza_unverified(self) -> None:
        self.assertEqual(
            get_stanza(DefaultRateLimit.UNVERIFIED, 'bar'),
            [MessageBlocked(
                stanza_id='bar',
                reason='rate-limited-1day',
                subreason='unverified-basics')]
        )

    def test_get_stanza_basics(self) -> None:
        self.assertEqual(
            get_stanza(DefaultRateLimit.BASICS, 'baz'),
            [MessageBlocked(
                stanza_id='baz',
                reason='rate-limited-1day',
                subreason='unverified-photos')]
        )

    def test_get_stanza_photos(self) -> None:
        self.assertEqual(
            get_stanza(DefaultRateLimit.PHOTOS, 'qux'),
            [MessageBlocked(
                stanza_id='qux',
                reason='rate-limited-1day')]
        )

    def test_get_stanza_unhandled_enum(self) -> None:
        class FakeLimit:
            pass

        with self.assertRaises(Exception) as cm:
            get_stanza(FakeLimit(), 'xyz')
        self.assertIn('Unhandled rate limit reason', str(cm.exception))


if __name__ == '__main__':
    unittest.main()
