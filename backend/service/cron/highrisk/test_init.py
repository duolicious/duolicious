import asyncio
import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import ANY, AsyncMock, patch
from uuid import UUID

from service.cron.highrisk import (
    NewPerson,
    action,
    check,
    due_checkpoint,
    escalates,
    reason,
)
from service.cron.highrisk.sql import (
    Q_INSERT_SCORE,
    Q_REQUIRE_PHOTO_VERIFICATION,
)
from serviceshared.antiabuse.sql import Q_SHADOW_BAN

Params = dict[str, int | float | str | None]

PERSON = NewPerson(
    bot_uuid=UUID(int=1),
    person_id=2,
    person_uuid=UUID(int=3),
    has_gold=False,
    hours_since_sign_up=0.2,
    previous_score=None,
    previous_hours=[])


def stored(
    risk: float,
    hours: int = 0,
    previous_level: int | None = None,
) -> tuple[str, Params]:
    return Q_INSERT_SCORE, dict(
        person_id=PERSON.person_id,
        hours=hours,
        score=risk,
        previous_required_verification_level_id=previous_level)


class _DefaultSettings(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.multiple(
            'service.cron.highrisk',
            HIGH_RISK_VERIFY_THRESHOLD=0.95,
            HIGH_RISK_SHADOW_BAN_THRESHOLD=0.999,
            DRY_RUN=True)
        patcher.start()
        self.addCleanup(patcher.stop)


class TestAction(_DefaultSettings):
    def test_no_score_means_no_action(self) -> None:
        self.assertIsNone(action(None, has_gold=False))

    def test_below_the_verification_threshold(self) -> None:
        self.assertIsNone(action(0.949, has_gold=False))

    def test_at_the_verification_threshold(self) -> None:
        self.assertEqual(action(0.95, has_gold=False), 'photo verification')

    def test_at_the_shadow_ban_threshold(self) -> None:
        self.assertEqual(action(0.999, has_gold=False), 'shadow ban')

    def test_gold_members_verify_instead_of_being_shadow_banned(self) -> None:
        self.assertEqual(action(0.9999, has_gold=True), 'photo verification')


class TestEscalates(_DefaultSettings):
    def test_first_score_above_a_threshold(self) -> None:
        self.assertTrue(escalates(0.96, None, has_gold=False))

    def test_first_score_below_every_threshold(self) -> None:
        self.assertFalse(escalates(0.5, None, has_gold=False))

    def test_higher_score_with_the_same_action(self) -> None:
        self.assertFalse(escalates(0.98, 0.96, has_gold=False))

    def test_verification_then_shadow_ban(self) -> None:
        self.assertTrue(escalates(0.9995, 0.96, has_gold=False))

    def test_lower_score_after_a_shadow_ban(self) -> None:
        self.assertFalse(escalates(0.96, 0.9995, has_gold=False))

    def test_gold_member_already_required_to_verify(self) -> None:
        self.assertFalse(escalates(0.9995, 0.96, has_gold=True))


class TestDueCheckpoint(unittest.TestCase):
    def test_too_soon_after_sign_up(self) -> None:
        self.assertIsNone(due_checkpoint(0.05, []))

    def test_first_score(self) -> None:
        self.assertEqual(due_checkpoint(0.2, []), 0)

    def test_between_checkpoints(self) -> None:
        self.assertIsNone(due_checkpoint(2.5, [0, 1]))

    def test_next_checkpoint(self) -> None:
        self.assertEqual(due_checkpoint(3.5, [0, 1]), 3)

    def test_missed_checkpoints_are_skipped(self) -> None:
        self.assertEqual(due_checkpoint(6.5, [0]), 6)

    def test_every_checkpoint_scored(self) -> None:
        self.assertIsNone(due_checkpoint(6.9, [0, 1, 3, 6]))


class TestReason(_DefaultSettings):
    def test_dry_run_at_sign_up(self) -> None:
        self.assertEqual(
            reason(0, 0.9712, 'photo verification'),
            'Dry run: would have required photo verification. '
            'High-risk score at sign-up: 0.971.')

    def test_dry_run_later(self) -> None:
        self.assertEqual(
            reason(3, 0.9995, 'shadow ban'),
            'Dry run: would have shadow banned them. '
            'High-risk score 3 h after sign-up: 1.000.')


class TestCheck(unittest.TestCase):
    def check(
        self,
        risk: float | None,
        dry_run: bool = False,
        shadow_banned_rows: int = 1,
        person: NewPerson = PERSON,
    ) -> tuple[list[tuple[str, Params]], AsyncMock]:
        executed: list[tuple[str, Params]] = []
        lodged = AsyncMock()

        class Cursor:
            rowcount = shadow_banned_rows

        class Tx:
            async def execute(self, query: str, params: Params) -> Cursor:
                executed.append((query, params))
                return Cursor()

            async def require_one(
                self,
                query: str,
                params: Params,
            ) -> dict[str, int]:
                executed.append((query, params))
                return dict(previous_required_verification_level_id=2)

        @asynccontextmanager
        async def api_tx(isolation: str) -> AsyncIterator[Tx]:
            yield Tx()

        with patch.multiple(
            'service.cron.highrisk',
            HIGH_RISK_VERIFY_THRESHOLD=0.95,
            HIGH_RISK_SHADOW_BAN_THRESHOLD=0.999,
            DRY_RUN=dry_run,
            score=AsyncMock(return_value=risk),
            lodge_report=lodged,
            api_tx=api_tx,
        ):
            asyncio.run(check(person))

        return executed, lodged

    def assert_reported(
        self,
        lodged: AsyncMock,
        is_automoded: bool,
        is_shadow_banned: bool,
    ) -> None:
        lodged.assert_awaited_once_with(
            subject_uuid=str(PERSON.bot_uuid),
            object_uuid=str(PERSON.person_uuid),
            reason=ANY,
            is_automoded=is_automoded,
            is_shadow_banned=is_shadow_banned,
            underage_source=None,
            messages=None,
            can_mark_safe=True)

    def test_nobody_due(self) -> None:
        executed, lodged = self.check(0.9995, person=PERSON.model_copy(
            update=dict(hours_since_sign_up=0.05)))

        self.assertEqual(executed, [])
        lodged.assert_not_awaited()

    def test_person_who_cannot_be_scored(self) -> None:
        executed, lodged = self.check(None)

        self.assertEqual(executed, [])
        lodged.assert_not_awaited()

    def test_low_score_is_only_stored(self) -> None:
        executed, lodged = self.check(0.5)

        self.assertEqual(executed, [stored(0.5)])
        lodged.assert_not_awaited()

    def test_dry_run_reports_without_acting(self) -> None:
        executed, lodged = self.check(0.9995, dry_run=True)

        self.assertEqual(executed, [stored(0.9995)])
        self.assert_reported(
            lodged, is_automoded=False, is_shadow_banned=False)

    def test_requires_photo_verification(self) -> None:
        executed, lodged = self.check(0.96)

        self.assertEqual(executed, [
            (Q_REQUIRE_PHOTO_VERIFICATION, dict(person_id=PERSON.person_id)),
            stored(0.96, previous_level=2),
        ])
        self.assert_reported(lodged, is_automoded=True, is_shadow_banned=False)

    def test_shadow_bans(self) -> None:
        executed, lodged = self.check(0.9995)

        self.assertEqual(executed, [
            (Q_SHADOW_BAN, dict(
                object_uuid=str(PERSON.person_uuid),
                shadow_banned_by='model')),
            stored(0.9995),
        ])
        self.assert_reported(lodged, is_automoded=True, is_shadow_banned=True)

    def test_person_someone_else_shadow_banned_first(self) -> None:
        executed, lodged = self.check(0.9995, shadow_banned_rows=0)

        self.assertEqual(executed[-1], stored(0.9995))
        lodged.assert_not_awaited()

    def test_decision_no_stricter_than_before(self) -> None:
        executed, lodged = self.check(0.96, person=PERSON.model_copy(update=dict(
            hours_since_sign_up=1.5,
            previous_score=0.97,
            previous_hours=[0])))

        self.assertEqual(executed, [stored(0.96, hours=1)])
        lodged.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
