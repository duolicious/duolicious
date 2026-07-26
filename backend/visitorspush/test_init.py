import asyncio
import unittest
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

from commonsql import Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME
from visitorspush import notify_immediately, publish_visit
from visitorsql import Q_VISITOR_ITEM, Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION

PROSPECT_UUID = '00000000-0000-0000-0000-000000000001'
VIEWER_UUID = '00000000-0000-0000-0000-000000000002'


class FakeTx:
    """
    Answers each query from `rows`, keyed by the query itself, and records the
    queries it was asked to run.
    """

    def __init__(
        self,
        rows: dict[str, object],
        executed: list[str],
    ) -> None:
        self._rows = rows
        self._executed = executed
        self._last = ''

    async def execute(self, query: str, params: object) -> None:
        self._last = query
        self._executed.append(query)

    async def fetchone(self) -> object:
        return self._rows.get(self._last)


def fake_api_tx(rows: dict[str, object], executed: list[str]) -> object:
    @asynccontextmanager
    async def api_tx(isolation: str) -> AsyncIterator[FakeTx]:
        yield FakeTx(rows, executed)

    return api_tx


def run_notify_immediately(
    tokens: list[str],
    visitor_name: str = 'Alice',
    prospect_online: bool = False,
    badge: int = 1,
) -> tuple[list[dict[str, object]], list[str]]:
    pushes: list[dict[str, object]] = []
    executed: list[str] = []

    with (
        patch('visitorspush.fetch_push_tokens',
              new_callable=AsyncMock, return_value=tokens),
        patch('visitorspush.increment_unseen_notification_count',
              new_callable=AsyncMock, return_value=badge),
        patch('visitorspush.notify.enqueue_mobile_notification',
              side_effect=lambda **kw: pushes.append(kw)),
        patch('visitorspush.api_tx', fake_api_tx({}, executed)),
    ):
        asyncio.run(notify_immediately(
            prospect_uuid=PROSPECT_UUID,
            visitor_name=visitor_name,
            prospect_online=prospect_online,
        ))

    return pushes, executed


class TestNotifyImmediately(unittest.TestCase):

    def test_pushes_and_stamps_the_visitor_clock(self) -> None:
        pushes, executed = run_notify_immediately(tokens=['phone'])

        [push] = pushes
        self.assertEqual(push['token'], 'phone')
        self.assertEqual(push['title'], 'Alice visited your profile 👀')
        self.assertEqual(push['body'], 'Open the app to see your visitors')
        self.assertEqual(
                push['data'],
                {'screen': 'Home', 'params': {'screen': 'Visitors'}})

        # Stamped, so the periodic check doesn't announce the same visit again.
        self.assertEqual(executed, [Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME])

    def test_badges_when_the_prospect_is_away(self) -> None:
        pushes, _ = run_notify_immediately(
                tokens=['phone'], prospect_online=False, badge=7)

        self.assertEqual(pushes[0]['badge'], 7)

    def test_no_badge_while_the_prospect_is_around(self) -> None:
        # They can watch the visit land in their visitors tab themselves.
        pushes, _ = run_notify_immediately(
                tokens=['phone'], prospect_online=True)

        self.assertIsNone(pushes[0]['badge'])

    def test_every_phone_is_pushed_to(self) -> None:
        pushes, _ = run_notify_immediately(tokens=['phone-a', 'phone-b'])

        self.assertEqual(
                sorted(str(push['token']) for push in pushes),
                ['phone-a', 'phone-b'])

    def test_the_visitor_is_named(self) -> None:
        pushes, _ = run_notify_immediately(
                tokens=['phone'], visitor_name='Zoë 🌸')

        self.assertEqual(pushes[0]['title'], 'Zoë 🌸 visited your profile 👀')

    def test_no_reachable_phone_leaves_the_visit_to_the_cron(self) -> None:
        # The clock must be left alone: stamping it here would suppress the
        # email the periodic check sends once the visit is ten minutes old.
        pushes, executed = run_notify_immediately(tokens=[])

        self.assertEqual(pushes, [])
        self.assertEqual(executed, [])


def run_publish_visit(
    owner_item: object,
    wants_immediate: bool,
    prospect_online: bool = False,
) -> tuple[list[tuple[str, str]], list[str], list[str]]:
    """
    Returns the live pushes published, the names notified about, and the
    queries run.
    """
    published: list[tuple[str, str]] = []
    notified: list[str] = []
    executed: list[str] = []

    rows: dict[str, object] = {
        Q_VISITOR_ITEM: {'j': owner_item} if owner_item else None,
        Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION: 1 if wants_immediate else None,
    }

    async def fake_notify(
        prospect_uuid: str,
        visitor_name: str,
        prospect_online: bool,
    ) -> None:
        notified.append(visitor_name)

    with (
        patch('visitorspush.api_tx', fake_api_tx(rows, executed)),
        patch('visitorspush._publish',
              side_effect=lambda channel, section, item:
                  published.append((channel, section))),
        patch('visitorspush.notify_immediately', side_effect=fake_notify),
    ):
        asyncio.run(publish_visit(
            viewer_id=1,
            viewer_uuid=VIEWER_UUID,
            prospect_id=2,
            prospect_uuid=PROSPECT_UUID,
            prospect_online=prospect_online,
        ))

    return published, notified, executed


class TestPublishVisitDecidesWhatToNotifyAbout(unittest.TestCase):
    """
    `Q_VISITOR_ITEM` decides what the visitors tab shows, so it decides what
    can be notified about too -- there is no second copy of those rules.
    """

    def test_an_offline_prospect_is_still_notified(self) -> None:
        # The case the whole feature exists for. The owner's item is fetched
        # even though nothing is pushed live to them.
        _, notified, executed = run_publish_visit(
                owner_item={'name': 'Alice'},
                wants_immediate=True,
                prospect_online=False)

        self.assertEqual(notified, ['Alice'])
        self.assertIn(Q_VISITOR_ITEM, executed)

    def test_a_hidden_visit_is_not_notified_about(self) -> None:
        # No owner item: invisible, skipped, shadow banned, unverified -- the
        # tab hides it, whichever reason applies.
        _, notified, _ = run_publish_visit(
                owner_item=None, wants_immediate=True)

        self.assertEqual(notified, [])

    def test_the_name_comes_from_the_visitors_tab_item(self) -> None:
        _, notified, _ = run_publish_visit(
                owner_item={'name': 'Bob'}, wants_immediate=True)

        self.assertEqual(notified, ['Bob'])

    def test_the_owner_item_is_not_fetched_when_nobody_needs_it(self) -> None:
        # Offline and not on "Immediately": the expensive query is skipped, as
        # it was before any of this existed.
        _, notified, executed = run_publish_visit(
                owner_item={'name': 'Alice'},
                wants_immediate=False,
                prospect_online=False)

        self.assertEqual(notified, [])
        self.assertEqual(executed.count(Q_VISITOR_ITEM), 1)  # the viewer's only

    def test_an_online_prospect_still_gets_the_live_push(self) -> None:
        published, _, _ = run_publish_visit(
                owner_item={'name': 'Alice'},
                wants_immediate=False,
                prospect_online=True)

        self.assertIn((PROSPECT_UUID, 'visited_you'), published)

    def test_an_offline_prospect_gets_no_live_push(self) -> None:
        published, notified, _ = run_publish_visit(
                owner_item={'name': 'Alice'},
                wants_immediate=True,
                prospect_online=False)

        self.assertNotIn((PROSPECT_UUID, 'visited_you'), published)
        self.assertEqual(notified, ['Alice'])

    def test_visiting_yourself_does_nothing(self) -> None:
        published: list[tuple[str, str]] = []
        notified: list[str] = []
        executed: list[str] = []

        with (
            patch('visitorspush.api_tx', fake_api_tx({}, executed)),
            patch('visitorspush._publish',
                  side_effect=lambda channel, section, item:
                      published.append((channel, section))),
            patch('visitorspush.notify_immediately',
                  new_callable=AsyncMock),
        ):
            asyncio.run(publish_visit(
                viewer_id=1,
                viewer_uuid=VIEWER_UUID,
                prospect_id=1,
                prospect_uuid=VIEWER_UUID,
                prospect_online=True,
            ))

        self.assertEqual(published, [])
        self.assertEqual(executed, [])


if __name__ == '__main__':
    unittest.main()
