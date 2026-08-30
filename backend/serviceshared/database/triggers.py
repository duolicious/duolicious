"""Application-level database triggers.

A trigger declares which writes it reacts to (`watched`: tables, columns,
inserts, deletes), what its subject is (`subject_column`, the params key
that identifies whose row changed -- `person_id` for the matching models),
and what to do about each affected subject (`fire`). `install` registers a
process's triggers once, at startup, the way asgi.py registers middleware;
a process that installs none -- initapi running migrations -- runs
untriggered. The transaction layer (TxCursor) reports every statement it
executes to a per-transaction `Tracker`, which parses each query against
the installed declarations (`classify`, cached per query string) and fires
each affected trigger for each affected subject before the transaction
commits, so a write and its consequences land together, atomically. No
call site anywhere knows the triggers exist.

A watched write names its subjects on its own. Usually its params carry
the trigger's subject column; a statement that instead learns who it
touched as it runs (creating a row, deleting by token) reports through its
own RETURNING rows -- a fetched column named after the subject column, or
its plural with an appended `s`, attributes it, even when NULL (an
explicit nobody). Writes to a captured table (`Watch.capture`) also carry
the capture's key column, and the tracker reads the old value just before
executing the write, so triggers can patch derived state with the (old,
new) pair rather than re-reading every row. A transaction that commits
with a watched write attributed none of these ways raises instead of
committing: the fix is always to make the statement say who it touched,
never to remember a call.

Statements that bypass the transaction layer entirely (psql sessions) are
the one blind spot.
"""
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Protocol

import psycopg
from pglast import parse_sql
from pglast.visitors import Visitor

from serviceshared.database.tx import CursorQuery, Row, Tx


@dataclass(frozen=True)
class Capture:
    """How to snapshot a captured table's row around a write. The table is
    keyed (subject, `key_column`), both taken from the writing statement's
    params (the subject under the watching trigger's `subject_column`, which
    must also be the table's column name for it), and the boolean
    `value_column` is read just before the write and again before commit;
    the trigger receives the pair as a `CapturedChange`, so it can patch
    derived state instead of re-reading every row."""
    key_column: str
    value_column: str

    def query(self, table: str, subject_column: str) -> str:
        return (
            f'SELECT {self.value_column} FROM {table} '
            f'WHERE {subject_column} = %({subject_column})s '
            f'AND {self.key_column} = %({self.key_column})s')


@dataclass(frozen=True)
class Watch:
    """Which writes to `table` fire a trigger: updates of these columns, and
    inserts or deletes of whole rows."""
    table: str
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
    subject_column: str
    watched: Sequence[Watch]

    async def fire(
        self,
        tx: Tx,
        subject_id: int,
        changes: Sequence[CapturedChange],
        /,
    ) -> None:
        ...


class UnattributedWriteError(RuntimeError):
    pass


_triggers: tuple[Trigger, ...] = ()
_by_name: dict[str, Trigger] = {}
_watched_tables: dict[str, frozenset[str]] = {}
_captures: dict[str, tuple[str, Capture]] = {}
_capture_queries: dict[str, str] = {}
_installed = False


def install(triggers: Sequence[Trigger]) -> None:
    """Register this process's triggers, once, before it serves anything.
    Installing the same triggers again is a no-op, so a restarted app
    lifespan in one process is fine; installing different ones raises,
    because `classify`'s cache is only coherent for one trigger set."""
    global _triggers, _by_name, _watched_tables, _captures, \
        _capture_queries, _installed
    if _installed and tuple(triggers) == _triggers:
        return
    if _installed:
        raise RuntimeError('different triggers are already installed')
    by_name: dict[str, Trigger] = {}
    captures: dict[str, tuple[str, Capture]] = {}
    for trigger in triggers:
        if by_name.setdefault(trigger.name, trigger) is not trigger:
            raise ValueError(f'two triggers are named {trigger.name}')
        for watch in trigger.watched:
            if watch.capture is None:
                continue
            entry = (trigger.subject_column, watch.capture)
            if captures.setdefault(watch.table, entry) != entry:
                raise ValueError(
                    f'triggers disagree on how {watch.table} is captured')
    _triggers = tuple(triggers)
    _by_name = by_name
    _watched_tables = {
        trigger.name: frozenset(watch.table for watch in trigger.watched)
        for trigger in triggers}
    _captures = captures
    _capture_queries = {
        table: capture.query(table, subject_column)
        for table, (subject_column, capture) in captures.items()}
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
        conflict = node.onConflictClause  # type: ignore[attr-defined]
        if conflict is None or not conflict.targetList:
            return
        self.writes.append((
            node.relation.relname,  # type: ignore[attr-defined]
            'update',
            frozenset(target.name for target in conflict.targetList),
        ))

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
            for watch in trigger.watched:
                if watch.table == table and _hit(watch, op, columns):
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


@dataclass
class _Awaited:
    """What one subject column of a harvesting write is owed: the triggers
    waiting on it, and the subject ids its fetched rows reported -- None
    while no row has carried the column at all (as distinct from rows
    carrying it as NULL, an explicit nobody)."""
    trigger_names: set[str]
    reported_subjects: set[int] | None = None


@dataclass
class _PendingHarvest:
    """A watched write whose subjects must come from its own fetched rows:
    the statement's tables (for the error when nothing reports), and each
    subject column the rows must produce. The window stays open until the
    next statement, so every row of a multi-row RETURNING reports, however
    it's fetched; `_expire_harvest` settles the whole window at once."""
    tables: frozenset[str]
    awaiting: dict[str, _Awaited] = field(default_factory=dict)


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
        self._pending_harvest: _PendingHarvest | None = None

    def _expire_harvest(self) -> None:
        """Close the harvest window and settle it: each awaited subject
        column either attributes everything its rows reported, or, if no row
        carried it, condemns the write as unattributed."""
        pending, self._pending_harvest = self._pending_harvest, None
        if pending is None:
            return
        for awaited in pending.awaiting.values():
            if awaited.reported_subjects is None:
                self._unattributed |= pending.tables
                continue
            for name in awaited.trigger_names:
                self._stale.setdefault(name, set()).update(
                    awaited.reported_subjects)

    async def _read_captured(
            self, table: str, subject: int, key: int) -> bool | None:
        subject_column, capture = _captures[table]
        await self._cur.execute(
            _capture_queries[table],
            {subject_column: subject, capture.key_column: key})
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
        for table in classify(query).capture_tables:
            subject_column, capture = _captures[table]
            subject = _int_param(params, subject_column)
            key = _int_param(params, capture.key_column)
            if subject is None or key is None:
                continue
            captured = (table, subject, key)
            if captured not in self._captured_olds:
                self._captured_olds[captured] = await self._read_captured(
                        table, subject, key)

    def _captured(
        self,
        classified: Classification,
        params: psycopg.abc.Params | None,
    ) -> bool:
        for table in classified.capture_tables:
            subject_column, capture = _captures[table]
            subject = _int_param(params, subject_column)
            key = _int_param(params, capture.key_column)
            if (table, subject, key) not in self._captured_olds:
                return False
        return True

    def note_after(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None,
        rowcount: int | None,
    ) -> None:
        """A statement ran (`rowcount` is None when it isn't knowable, as
        within executemany). Attribute any watched write to its subjects, or
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
        if not self._captured(classified, params):
            self._unattributed |= classified.tables
            return
        awaiting: dict[str, _Awaited] = {}
        for name in classified.triggers:
            trigger = _by_name[name]
            subject = _int_param(params, trigger.subject_column)
            if subject is None:
                awaiting.setdefault(
                    trigger.subject_column,
                    _Awaited(trigger_names=set()),
                ).trigger_names.add(name)
            else:
                self._stale.setdefault(name, set()).add(subject)
        if awaiting:
            self._pending_harvest = _PendingHarvest(
                tables=classified.tables, awaiting=awaiting)

    def saw_rows(self, rows: Iterable[Row]) -> None:
        """A watched write that could not name its subjects from its params
        reports through its own fetched rows instead: a column named after
        the awaited subject column (or its plural) attributes it, even when
        NULL (an explicit nobody)."""
        pending = self._pending_harvest
        if pending is None:
            return
        for row in rows:
            for subject_column, awaited in pending.awaiting.items():
                singular, plural = subject_column, subject_column + 's'
                if singular not in row and plural not in row:
                    continue
                subjects = row.get(plural)
                values = [
                    row.get(singular),
                    *(subjects if isinstance(subjects, list) else []),
                ]
                if awaited.reported_subjects is None:
                    awaited.reported_subjects = set()
                awaited.reported_subjects.update(
                    one for one in values if isinstance(one, int))

    async def flush(self, tx: Tx) -> None:
        """Fire the triggers for whatever the transaction made stale, before
        it commits. Raises instead of committing when a watched write went
        unattributed: the fix is making the statement carry the triggers'
        subject columns (and the capture's key column, for captured tables)
        in its params, or report its subjects in its RETURNING rows."""
        self._expire_harvest()
        if self._unattributed:
            raise UnattributedWriteError(
                f'trigger-watched inputs in {sorted(self._unattributed)} '
                'were written without a subject to attribute them to; the '
                'statement must carry the subject column (and the captured '
                'key column) in its params, or return the subject column, '
                'singular or plural, among its rows')
        if not self._stale and not self._captured_olds:
            return

        changes: dict[int, list[CapturedChange]] = {}
        for (table, subject, key), old in self._captured_olds.items():
            new = await self._read_captured(table, subject, key)
            if new == old:
                continue
            changes.setdefault(subject, []).append(CapturedChange(
                table=table,
                key=key,
                old=old,
                new=new,
            ))

        for trigger in _triggers:
            for subject in sorted(self._stale.get(trigger.name, ())):
                await trigger.fire(tx, subject, [
                    change for change in changes.get(subject, [])
                    if change.table in _watched_tables[trigger.name]])
