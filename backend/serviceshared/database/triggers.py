"""Application-level database triggers.

A trigger declares which writes it reacts to (`watched`: tables, columns,
inserts, deletes) and what to do about the person a write touched
(`person_changed`). `install` registers a process's triggers once, at
startup, the way asgi.py registers middleware; a process that installs
none -- initapi running migrations -- runs untriggered. The transaction
layer (TxCursor) reports every statement it executes to a per-transaction
`Tracker`, which parses each query against the installed declarations
(`classify`, cached per query string) and fires each affected trigger for
each affected person before the transaction commits, so a write and its
consequences land together, atomically. No call site anywhere knows the
triggers exist.

A watched write names who it touched on its own. Usually its params carry
`person_id`; a statement that instead learns who it touched as it runs
(creating a person, deleting by token) reports through its own RETURNING
rows -- a fetched column called `person_id` or `person_ids` attributes
it, even when NULL (an explicit nobody). Writes to a captured table
(`Watch.capture`) also carry the capture's key column, and the tracker
reads the old value just before executing the write, so triggers can
patch derived state with the (old, new) pair rather than re-reading every
row. A transaction that commits with a watched write attributed none of
these ways raises instead of committing: the fix is always to make the
statement say who it touched, never to remember a call.

Statements that bypass the transaction layer entirely (psql sessions) are
the one blind spot.
"""
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import psycopg
from pglast import parse_sql
from pglast.visitors import Visitor

from serviceshared.database.tx import CursorQuery, Row, Tx


@dataclass(frozen=True)
class Capture:
    """How to snapshot a captured table's row around a write. The table is
    keyed (person_id, `key_column`), both taken from the writing statement's
    params, and the boolean `value_column` is read just before the write and
    again before commit; the trigger receives the pair as a
    `CapturedChange`, so it can patch derived state instead of re-reading
    every row."""
    key_column: str
    value_column: str

    def query(self, table: str) -> str:
        return (
            f'SELECT {self.value_column} FROM {table} '
            f'WHERE person_id = %(person_id)s '
            f'AND {self.key_column} = %({self.key_column})s')


@dataclass(frozen=True)
class Watch:
    """Which writes to one table fire a trigger: updates of these columns,
    and inserts or deletes of whole rows."""
    update_columns: frozenset[str] = frozenset()
    inserts: bool = False
    deletes: bool = False
    capture: Capture | None = None


@dataclass(frozen=True)
class CapturedChange:
    table: str
    key: int
    old: bool | None
    new: bool | None


class Trigger(Protocol):
    name: str
    watched: Mapping[str, Watch]

    async def person_changed(
        self,
        tx: Tx,
        person_id: int,
        changes: Sequence[CapturedChange],
    ) -> None:
        ...


class UnattributedWriteError(RuntimeError):
    pass


_triggers: tuple[Trigger, ...] = ()
_captures: dict[str, Capture] = {}
_capture_queries: dict[str, str] = {}
_installed = False


def install(triggers: Sequence[Trigger]) -> None:
    """Register this process's triggers, once, before it serves anything.
    Installing the same triggers again is a no-op, so a restarted app
    lifespan in one process is fine; installing different ones raises,
    because `classify`'s cache is only coherent for one trigger set."""
    global _triggers, _captures, _capture_queries, _installed
    if _installed and tuple(triggers) == _triggers:
        return
    if _installed:
        raise RuntimeError('different triggers are already installed')
    captures: dict[str, Capture] = {}
    for trigger in triggers:
        for table, watch in trigger.watched.items():
            if watch.capture is None:
                continue
            if captures.setdefault(table, watch.capture) != watch.capture:
                raise ValueError(
                    f'triggers disagree on how {table} is captured')
    _triggers = tuple(triggers)
    _captures = captures
    _capture_queries = {
        table: capture.query(table) for table, capture in captures.items()}
    _installed = True
    classify.cache_clear()


@dataclass(frozen=True)
class Classification:
    triggers: frozenset[str]
    tables: frozenset[str]
    capture_tables: frozenset[str]
    # True when the statement's only DML is the top-level one, so a rowcount
    # of zero proves nothing changed. A write inside a CTE can move rows the
    # top-level rowcount never counts.
    rowcount_reliable: bool


class _Writes(Visitor):
    def __init__(self) -> None:
        self.writes: list[tuple[str, str, frozenset[str]]] = []
        self.dml_nodes = 0

    def visit_InsertStmt(self, ancestors: object, node: object) -> None:
        self.dml_nodes += 1
        self.writes.append(
            (node.relation.relname, 'insert', frozenset()))  # type: ignore[attr-defined]

    def visit_UpdateStmt(self, ancestors: object, node: object) -> None:
        self.dml_nodes += 1
        columns = frozenset(
            target.name for target in node.targetList or ())  # type: ignore[attr-defined]
        self.writes.append(
            (node.relation.relname, 'update', columns))  # type: ignore[attr-defined]

    def visit_DeleteStmt(self, ancestors: object, node: object) -> None:
        self.dml_nodes += 1
        self.writes.append(
            (node.relation.relname, 'delete', frozenset()))  # type: ignore[attr-defined]


def _hit(watch: Watch, op: str, columns: frozenset[str]) -> bool:
    if op == 'insert':
        return watch.inserts
    if op == 'delete':
        return watch.deletes
    return bool(columns & watch.update_columns)


_PLACEHOLDER = re.compile(r'%(\(\w+\))?s')

_DML_STATEMENTS = ('InsertStmt', 'UpdateStmt', 'DeleteStmt')


@lru_cache(maxsize=4096)
def classify(query: str) -> Classification:
    """Which installed triggers this statement can fire. Parsed once per
    query string (the queries are mostly module-level constants, so in
    practice a dict hit); the cache is bounded so dynamically built queries
    can't leak memory."""
    tree = parse_sql(_PLACEHOLDER.sub('NULL', query))
    visitor = _Writes()
    visitor(tree)

    triggers: set[str] = set()
    tables: set[str] = set()
    for table, op, columns in visitor.writes:
        for trigger in _triggers:
            watch = trigger.watched.get(table)
            if watch and _hit(watch, op, columns):
                triggers.add(trigger.name)
                tables.add(table)

    top_level_dml = (
        len(tree) == 1
        and type(tree[0].stmt).__name__ in _DML_STATEMENTS)
    return Classification(
        triggers=frozenset(triggers),
        tables=frozenset(tables),
        capture_tables=frozenset(tables) & frozenset(_captures),
        rowcount_reliable=top_level_dml and visitor.dml_nodes == 1,
    )


def _int_param(params: psycopg.abc.Params | None, key: str) -> int | None:
    value = params.get(key) if isinstance(params, dict) else None
    return value if isinstance(value, int) else None


class Tracker:
    """One transaction's view of the installed triggers: TxCursor reports
    what it is about to run, what it ran, and what it fetched; `flush` fires
    whoever that made stale, before the transaction commits."""

    def __init__(self, cur: psycopg.AsyncCursor[Row]) -> None:
        # The raw cursor, so the tracker's own reads don't re-enter the
        # hooks that report to it.
        self._cur = cur
        self._stale: dict[str, set[int]] = {}
        self._captured_olds: dict[tuple[str, int, int], bool | None] = {}
        self._unattributed: set[str] = set()
        self._pending_harvest: frozenset[str] | None = None

    def _expire_harvest(self) -> None:
        if self._pending_harvest is not None:
            self._unattributed |= self._pending_harvest
            self._pending_harvest = None

    async def _read_captured(
            self, table: str, person_id: int, key: int) -> bool | None:
        capture = _captures[table]
        await self._cur.execute(
            _capture_queries[table],
            {'person_id': person_id, capture.key_column: key})
        row = await self._cur.fetchone()
        if row is None or row[capture.value_column] is None:
            return None
        return bool(row[capture.value_column])

    async def note_before(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None,
    ) -> None:
        """A statement is about to run. If it writes a captured table, read
        the old value now so triggers can patch derived state with the (old,
        new) pair instead of re-reading every row."""
        self._expire_harvest()
        if not isinstance(query, str):
            return
        person_id = _int_param(params, 'person_id')
        if person_id is None:
            return
        for table in classify(query).capture_tables:
            key = _int_param(params, _captures[table].key_column)
            if key is None:
                continue
            captured = (table, person_id, key)
            if captured not in self._captured_olds:
                self._captured_olds[captured] = await self._read_captured(
                        table, person_id, key)

    def note_after(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None,
        rowcount: int | None,
    ) -> None:
        """A statement ran (`rowcount` is None when it isn't knowable, as
        within executemany). Attribute any watched write to a person, or
        open the one-statement window for its fetched rows to do so."""
        if not isinstance(query, str):
            return
        classified = classify(query)
        if not classified.triggers:
            return
        if (rowcount is not None
                and rowcount == 0
                and classified.rowcount_reliable):
            return
        person_id = _int_param(params, 'person_id')
        captured = all(
            (table, person_id, _int_param(params, _captures[table].key_column))
            in self._captured_olds
            for table in classified.capture_tables)
        if not captured:
            self._unattributed |= classified.tables
            return
        if person_id is None:
            self._pending_harvest = classified.triggers
            return
        for name in classified.triggers:
            self._stale.setdefault(name, set()).add(person_id)

    def saw_rows(self, rows: Iterable[Row]) -> None:
        """A watched write that could not name who it touched from its params
        reports through its own fetched rows instead: a `person_id` or
        `person_ids` column attributes it, even when NULL (an explicit
        nobody)."""
        if self._pending_harvest is None:
            return
        for row in rows:
            if 'person_id' not in row and 'person_ids' not in row:
                continue
            person_ids = row.get('person_ids')
            reported = [
                row.get('person_id'),
                *(person_ids if isinstance(person_ids, list) else []),
            ]
            attributed = [one for one in reported if isinstance(one, int)]
            for name in self._pending_harvest:
                self._stale.setdefault(name, set()).update(attributed)
            self._pending_harvest = None
            return

    async def flush(self, tx: Tx) -> None:
        """Fire the triggers for whatever the transaction made stale, before
        it commits. Raises instead of committing when a watched write went
        unattributed: the fix is making the statement carry person_id (and
        the capture's key column, for captured tables) in its params, or
        report who it touched in its RETURNING rows."""
        self._expire_harvest()
        if self._unattributed:
            raise UnattributedWriteError(
                f'trigger-watched inputs in {sorted(self._unattributed)} '
                'were written without a person to attribute them to; the '
                'statement must carry person_id (and the captured key '
                'column) in its params, or return a person_id/person_ids '
                'column')
        if not self._stale and not self._captured_olds:
            return

        changes: dict[int, list[CapturedChange]] = {}
        for (table, person_id, key), old in self._captured_olds.items():
            new = await self._read_captured(table, person_id, key)
            if new == old:
                continue
            changes.setdefault(person_id, []).append(CapturedChange(
                table=table,
                key=key,
                old=old,
                new=new,
            ))

        for trigger in _triggers:
            for person_id in sorted(self._stale.get(trigger.name, ())):
                await trigger.person_changed(tx, person_id, [
                    change for change in changes.get(person_id, [])
                    if change.table in trigger.watched])
