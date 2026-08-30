"""
Tests for serviceshared.database.triggers -- statement classification and
the per-transaction Tracker, driven with a fake cursor; no database.

Installs its own triggers, watching tables no real query touches, so
nothing else in the test process can collide with them; `install` is
per-process, and no other test installs the real models.
"""
import unittest
from collections.abc import Iterable, Sequence

import psycopg

from serviceshared.database.triggers import (
    Capture,
    CapturedChange,
    Tracker,
    UnattributedWriteError,
    Watch,
    classify,
    install,
)
from serviceshared.database.tx import Row, Tx

Fired = tuple[str, int, list[tuple[int, bool | None, bool | None]]]

fired: list[Fired] = []


def _record(
        name: str, owner_id: int, changes: Sequence[CapturedChange]) -> None:
    fired.append((
        name,
        owner_id,
        [(change.key, change.old, change.new) for change in changes],
    ))


class _WidgetModel:
    name = 'widget_model'
    subject_column = 'owner_id'
    watched: Sequence[Watch] = (Watch(
        table='widget',
        update_columns=frozenset({'value'}),
        inserts=True,
        deletes=True,
        capture=Capture(key_column='widget_id', value_column='value'),
    ),)

    async def fire(
        self,
        tx: Tx,
        owner_id: int,
        changes: Sequence[CapturedChange],
    ) -> None:
        _record(self.name, owner_id, changes)


class _MemberModel:
    name = 'member_model'
    subject_column = 'owner_id'
    watched: Sequence[Watch] = (
        Watch(table='gadget_member', inserts=True, deletes=True),)

    async def fire(
        self,
        tx: Tx,
        owner_id: int,
        changes: Sequence[CapturedChange],
    ) -> None:
        _record(self.name, owner_id, changes)


class _ValveModel:
    name = 'valve_model'
    subject_column = 'owner_id'
    watched: Sequence[Watch] = (
        Watch(table='valve', update_columns=frozenset({'value'})),)

    async def fire(
        self,
        tx: Tx,
        owner_id: int,
        changes: Sequence[CapturedChange],
    ) -> None:
        _record(self.name, owner_id, changes)


install((_WidgetModel(), _MemberModel(), _ValveModel()))


INSERT_MEMBER = """
INSERT INTO gadget_member (owner_id, gadget)
VALUES (%(owner_id)s, %(gadget)s)
"""

DELETE_MEMBERS = """
DELETE FROM gadget_member WHERE gadget = %(gadget)s RETURNING owner_id
"""

UPSERT_WIDGET = """
INSERT INTO widget (owner_id, widget_id, value)
VALUES (%(owner_id)s, %(widget_id)s, %(value)s)
ON CONFLICT (owner_id, widget_id) DO UPDATE SET value = EXCLUDED.value
"""

DELETE_WIDGET = """
DELETE FROM widget
WHERE owner_id = %(owner_id)s AND widget_id = %(widget_id)s
"""


class FakeTx:
    """Answers the tracker's capture reads from a canned (owner, widget) ->
    value map, and stands in for the Tx that firing triggers receive."""

    def __init__(
        self,
        values: dict[tuple[int, int], bool | None] | None = None,
    ) -> None:
        self.values = dict(values or {})
        self._row: Row | None = None

    @property
    def connection(self) -> psycopg.AsyncConnection[Row]:
        raise NotImplementedError

    @property
    def rowcount(self) -> int:
        raise NotImplementedError

    async def execute(
        self,
        query: str,
        params: psycopg.abc.Params | None = None,
    ) -> Tx:
        assert isinstance(params, dict)
        self._row = {'value': self.values.get(
            (params['owner_id'], params['widget_id']))}
        return self

    async def require_one(
        self,
        query: str,
        params: psycopg.abc.Params | None = None,
    ) -> Row:
        raise NotImplementedError

    async def executemany(
        self,
        query: str,
        params_seq: Iterable[psycopg.abc.Params],
    ) -> None:
        raise NotImplementedError

    async def fetchone(self) -> Row | None:
        return self._row

    async def fetchall(self) -> list[Row]:
        return []

    def attribute(self, subjects: Iterable[int]) -> None:
        raise NotImplementedError

    async def close(self) -> None:
        pass


class TestClassify(unittest.TestCase):
    def test_watched_insert(self) -> None:
        classified = classify(INSERT_MEMBER)
        self.assertEqual(classified.triggers, frozenset({'member_model'}))
        self.assertTrue(classified.rowcount_reliable)

    def test_upsert_do_update_counts_as_a_column_update(self) -> None:
        classified = classify(
            'INSERT INTO valve (owner_id, value) '
            'VALUES (%(owner_id)s, %(value)s) '
            'ON CONFLICT (owner_id) DO UPDATE SET value = EXCLUDED.value')
        self.assertEqual(classified.triggers, frozenset({'valve_model'}))
        self.assertTrue(classified.rowcount_reliable)

    def test_do_nothing_upsert_stays_a_plain_insert(self) -> None:
        classified = classify(
            'INSERT INTO valve (owner_id, value) '
            'VALUES (%(owner_id)s, %(value)s) ON CONFLICT DO NOTHING')
        self.assertEqual(classified.triggers, frozenset())

    def test_update_of_an_unwatched_column(self) -> None:
        classified = classify(
            'UPDATE widget SET label = %(label)s WHERE owner_id = %(owner_id)s')
        self.assertEqual(classified.triggers, frozenset())

    def test_cte_write_has_unreliable_rowcount(self) -> None:
        classified = classify(
            'WITH gone AS (DELETE FROM gadget_member RETURNING owner_id) '
            'SELECT owner_id FROM gone')
        self.assertEqual(classified.triggers, frozenset({'member_model'}))
        self.assertFalse(classified.rowcount_reliable)

    def test_select_is_unwatched(self) -> None:
        classified = classify('SELECT 1 FROM gadget_member')
        self.assertEqual(classified.triggers, frozenset())

    def test_positional_placeholders_parse(self) -> None:
        classified = classify('INSERT INTO gadget_member VALUES (%s, %s)')
        self.assertEqual(classified.triggers, frozenset({'member_model'}))


class TestTracker(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        fired.clear()
        self.fake = FakeTx()
        self.tracker = Tracker(self.fake)

    async def flush(self) -> None:
        await self.tracker.flush(self.fake)

    async def test_params_attribution_fires(self) -> None:
        self.tracker.note_after(
            INSERT_MEMBER, dict(owner_id=5, gadget='g'), 1)
        await self.flush()
        self.assertEqual(fired, [('member_model', 5, [])])

    async def test_zero_rowcount_write_is_a_noop(self) -> None:
        self.tracker.note_after(
            INSERT_MEMBER, dict(owner_id=5, gadget='g'), 0)
        await self.flush()
        self.assertEqual(fired, [])

    async def test_attribution_fires_every_subject(self) -> None:
        self.tracker.note_after(DELETE_MEMBERS, dict(gadget='g'), 3)
        self.tracker.attribute([10, 11, 12])
        await self.flush()
        self.assertEqual(fired, [
            ('member_model', 10, []),
            ('member_model', 11, []),
            ('member_model', 12, []),
        ])

    async def test_attribution_accumulates_over_calls(self) -> None:
        self.tracker.note_after(DELETE_MEMBERS, dict(gadget='g'), 2)
        self.tracker.attribute([10])
        self.tracker.attribute([11])
        await self.flush()
        self.assertEqual(fired, [
            ('member_model', 10, []),
            ('member_model', 11, []),
        ])

    async def test_unattributed_write_raises(self) -> None:
        self.tracker.note_after(DELETE_MEMBERS, dict(gadget='g'), 1)
        with self.assertRaises(UnattributedWriteError):
            await self.flush()

    async def test_attributing_nobody_fires_nothing(self) -> None:
        self.tracker.note_after(DELETE_MEMBERS, dict(gadget='g'), 1)
        self.tracker.attribute([])
        await self.flush()
        self.assertEqual(fired, [])

    async def test_attribution_window_closes_at_the_next_statement(
            self) -> None:
        self.tracker.note_after(DELETE_MEMBERS, dict(gadget='g'), 1)
        await self.tracker.note_before('SELECT 1', None)
        with self.assertRaises(RuntimeError):
            self.tracker.attribute([10])
        with self.assertRaises(UnattributedWriteError):
            await self.flush()

    def test_attribution_without_a_watched_write_raises(self) -> None:
        with self.assertRaises(RuntimeError):
            self.tracker.attribute([10])

    async def test_bool_param_is_not_a_subject(self) -> None:
        self.tracker.note_after(
            INSERT_MEMBER, dict(owner_id=True, gadget='g'), 1)
        with self.assertRaises(UnattributedWriteError):
            await self.flush()

    async def test_captured_write_fires_with_old_and_new(self) -> None:
        self.fake.values[(1, 10)] = True
        params = dict(owner_id=1, widget_id=10, value=False)
        await self.tracker.note_before(UPSERT_WIDGET, params)
        self.tracker.note_after(UPSERT_WIDGET, params, 1)
        await self.flush()
        self.assertEqual(fired, [('widget_model', 1, [(10, True, False)])])

    async def test_unchanged_captured_value_reports_no_change(self) -> None:
        self.fake.values[(1, 10)] = True
        params = dict(owner_id=1, widget_id=10, value=True)
        await self.tracker.note_before(UPSERT_WIDGET, params)
        self.tracker.note_after(UPSERT_WIDGET, params, 1)
        await self.flush()
        self.assertEqual(fired, [('widget_model', 1, [])])

    async def test_captured_delete_writes_null(self) -> None:
        self.fake.values[(1, 10)] = True
        params = dict(owner_id=1, widget_id=10)
        await self.tracker.note_before(DELETE_WIDGET, params)
        self.tracker.note_after(DELETE_WIDGET, params, 1)
        await self.flush()
        self.assertEqual(fired, [('widget_model', 1, [(10, True, None)])])

    async def test_captured_write_missing_its_key_raises(self) -> None:
        params = dict(owner_id=1, value=False)
        await self.tracker.note_before(UPSERT_WIDGET, params)
        self.tracker.note_after(UPSERT_WIDGET, params, 1)
        with self.assertRaises(UnattributedWriteError):
            await self.flush()

    async def test_captured_write_missing_its_value_raises(self) -> None:
        params = dict(owner_id=1, widget_id=10)
        await self.tracker.note_before(UPSERT_WIDGET, params)
        self.tracker.note_after(UPSERT_WIDGET, params, 1)
        with self.assertRaises(UnattributedWriteError):
            await self.flush()

    async def test_batched_captured_writes(self) -> None:
        self.fake.values.update({(1, 10): True, (2, 10): None})
        params_list = [
            dict(owner_id=1, widget_id=10, value=False),
            dict(owner_id=2, widget_id=10, value=True),
        ]
        for params in params_list:
            await self.tracker.note_before(UPSERT_WIDGET, params)
        for params in params_list:
            self.tracker.note_after(UPSERT_WIDGET, params, None)
        await self.flush()
        self.assertEqual(fired, [
            ('widget_model', 1, [(10, True, False)]),
            ('widget_model', 2, [(10, None, True)]),
        ])
