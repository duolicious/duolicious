import asyncio
import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

from serviceshared.commonsql import Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME
from service.api.person.visitornotification import notify_of_visit
from service.api.visitorsql import Q_VISITOR_ITEM, Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION

PROSPECT_UUID = '00000000-0000-0000-0000-000000000001'


class FakeTx:
    """
    Answers each query from `rows`, keyed by the query itself, and records the
    queries it was asked to run.
    """

    def __init__(self, rows: dict[str, object], executed: list[str]) -> None:
        self._rows = rows
        self._executed = executed
        self._last = ''

    async def execute(self, query: str, params: object) -> None:
        self._last = query
        self._executed.append(query)

    async def fetchone(self) -> object:
        return self._rows.get(self._last)


def run_notify_of_visit(
    wants_immediate: bool = True,
    visitor_item: object = None,
    tokens: list[str] | None = None,
    prospect_online: bool = False,
    badge: int = 1,
    viewer_id: int = 1,
    prospect_id: int = 2,
) -> tuple[list[dict[str, object]], list[str]]:
    """
    Returns the pushes enqueued and the queries run, with the database, the
    push service and the badge counter faked out.
    """
    pushes: list[dict[str, object]] = []
    executed: list[str] = []

    rows: dict[str, object] = {
        Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION: 1 if wants_immediate else None,
        Q_VISITOR_ITEM: {'j': visitor_item} if visitor_item else None,
    }

    @asynccontextmanager
    async def api_tx(isolation: str) -> AsyncIterator[FakeTx]:
        yield FakeTx(rows, executed)

    with (
        patch('service.api.person.visitornotification.api_tx', api_tx),
        patch('service.api.person.visitornotification.fetch_push_tokens',
              new_callable=AsyncMock,
              return_value=['phone'] if tokens is None else tokens),
        patch('service.api.person.visitornotification.increment_unseen_notification_count',
              new_callable=AsyncMock, return_value=badge),
        patch('service.api.person.visitornotification.notify.enqueue_mobile_notification',
              side_effect=lambda **kw: pushes.append(kw)),
    ):
        asyncio.run(notify_of_visit(
            viewer_id=viewer_id,
            prospect_id=prospect_id,
            prospect_uuid=PROSPECT_UUID,
            prospect_online=prospect_online,
        ))

    return pushes, executed


class TestNotifyOfVisit(unittest.TestCase):

    def test_pushes_and_stamps_the_visitor_clock(self) -> None:
        pushes, executed = run_notify_of_visit(
                visitor_item={'name': 'Alice'})

        [push] = pushes
        self.assertEqual(push['token'], 'phone')
        self.assertEqual(push['title'], 'Alice visited your profile 👀')
        self.assertEqual(push['body'], 'Open the app to see your visitors')
        self.assertEqual(
                push['data'],
                {'screen': 'Home', 'params': {'screen': 'Visitors'}})

        # Stamped, so the periodic check doesn't announce the same visit again.
        self.assertIn(Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME, executed)

    def test_the_visitor_is_named(self) -> None:
        pushes, _ = run_notify_of_visit(visitor_item={'name': 'Zoë 🌸'})

        self.assertEqual(pushes[0]['title'], 'Zoë 🌸 visited your profile 👀')

    def test_badges_when_the_prospect_is_away(self) -> None:
        pushes, _ = run_notify_of_visit(
                visitor_item={'name': 'Alice'},
                prospect_online=False,
                badge=7)

        self.assertEqual(pushes[0]['badge'], 7)

    def test_no_badge_while_the_prospect_is_around(self) -> None:
        # They can watch the visit land in their visitors tab themselves.
        pushes, _ = run_notify_of_visit(
                visitor_item={'name': 'Alice'}, prospect_online=True)

        self.assertIsNone(pushes[0]['badge'])

    def test_every_phone_is_pushed_to(self) -> None:
        pushes, _ = run_notify_of_visit(
                visitor_item={'name': 'Alice'},
                tokens=['phone-a', 'phone-b'])

        self.assertEqual(
                sorted(str(push['token']) for push in pushes),
                ['phone-a', 'phone-b'])

    def test_silent_unless_set_to_immediately(self) -> None:
        # And the expensive visitors-tab query is never reached.
        pushes, executed = run_notify_of_visit(
                wants_immediate=False, visitor_item={'name': 'Alice'})

        self.assertEqual(pushes, [])
        self.assertNotIn(Q_VISITOR_ITEM, executed)

    def test_a_visit_the_visitors_tab_hides_is_not_announced(self) -> None:
        # No item: made invisibly, or by somebody skipped, shadow banned or
        # deactivated. Whichever it is, the tab decides, not this module.
        pushes, executed = run_notify_of_visit(visitor_item=None)

        self.assertEqual(pushes, [])
        self.assertNotIn(Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME, executed)

    def test_no_reachable_phone_leaves_the_visit_to_the_cron(self) -> None:
        # The clock must be left alone: stamping it here would suppress the
        # email the periodic check sends once the visit is ten minutes old.
        pushes, executed = run_notify_of_visit(
                visitor_item={'name': 'Alice'}, tokens=[])

        self.assertEqual(pushes, [])
        self.assertNotIn(Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME, executed)

    def test_visiting_yourself_is_not_a_visit(self) -> None:
        pushes, executed = run_notify_of_visit(
                visitor_item={'name': 'Alice'}, viewer_id=7, prospect_id=7)

        self.assertEqual(pushes, [])
        self.assertEqual(executed, [])


if __name__ == '__main__':
    unittest.main()
