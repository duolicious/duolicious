import asyncio
import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

from commonsql import Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME
from visitorspush import notify_immediately

PROSPECT_UUID = '00000000-0000-0000-0000-000000000001'


class FakeTx:
    def __init__(self, executed: list[str]) -> None:
        self._executed = executed

    async def execute(self, query: str, params: object) -> None:
        self._executed.append(query)


def fake_api_tx(executed: list[str]) -> object:
    @asynccontextmanager
    async def api_tx(isolation: str) -> AsyncIterator[FakeTx]:
        yield FakeTx(executed)

    return api_tx


def run_notify_immediately(
    wants: bool,
    tokens: list[str],
    prospect_online: bool = False,
    badge: int = 1,
) -> tuple[list[dict[str, object]], list[str]]:
    """
    Returns the pushes that were enqueued and the queries that were run, with
    everything the function touches outside itself faked out.
    """
    pushes: list[dict[str, object]] = []
    executed: list[str] = []

    with (
        patch('visitorspush._wants_immediate_notification',
              new_callable=AsyncMock, return_value=wants),
        patch('visitorspush.fetch_push_tokens',
              new_callable=AsyncMock, return_value=tokens),
        patch('visitorspush.increment_unseen_notification_count',
              new_callable=AsyncMock, return_value=badge),
        patch('visitorspush.notify.enqueue_mobile_notification',
              side_effect=lambda **kw: pushes.append(kw)),
        patch('visitorspush.api_tx', fake_api_tx(executed)),
    ):
        asyncio.run(notify_immediately(
            viewer_id=1,
            prospect_id=2,
            prospect_uuid=PROSPECT_UUID,
            prospect_online=prospect_online,
        ))

    return pushes, executed


class TestNotifyImmediately(unittest.TestCase):

    def test_pushes_and_stamps_the_visitor_clock(self) -> None:
        pushes, executed = run_notify_immediately(
                wants=True, tokens=['phone'])

        [push] = pushes
        self.assertEqual(push['token'], 'phone')
        self.assertEqual(push['title'], 'Someone visited your profile 👀')
        self.assertEqual(push['body'], 'Someone visited your profile!')
        self.assertEqual(
                push['data'],
                {'screen': 'Home', 'params': {'screen': 'Visitors'}})

        # Stamped, so the periodic check doesn't announce the same visit again.
        self.assertEqual(executed, [Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME])

    def test_badges_when_the_prospect_is_away(self) -> None:
        pushes, _ = run_notify_immediately(
                wants=True, tokens=['phone'], prospect_online=False, badge=7)

        self.assertEqual(pushes[0]['badge'], 7)

    def test_no_badge_while_the_prospect_is_around(self) -> None:
        # They can watch the visit land in their visitors tab themselves.
        pushes, _ = run_notify_immediately(
                wants=True, tokens=['phone'], prospect_online=True)

        self.assertIsNone(pushes[0]['badge'])

    def test_every_phone_is_pushed_to(self) -> None:
        pushes, _ = run_notify_immediately(
                wants=True, tokens=['phone-a', 'phone-b'])

        self.assertEqual(
                sorted(str(push['token']) for push in pushes),
                ['phone-a', 'phone-b'])

    def test_silent_unless_set_to_immediately(self) -> None:
        pushes, executed = run_notify_immediately(
                wants=False, tokens=['phone'])

        self.assertEqual(pushes, [])
        self.assertEqual(executed, [])

    def test_no_reachable_phone_leaves_the_visit_to_the_cron(self) -> None:
        # The clock must be left alone: stamping it here would suppress the
        # email the periodic check sends once the visit is ten minutes old.
        pushes, executed = run_notify_immediately(wants=True, tokens=[])

        self.assertEqual(pushes, [])
        self.assertEqual(executed, [])


if __name__ == '__main__':
    unittest.main()
