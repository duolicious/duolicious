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
call site fires a trigger; at most it says who a write touched.

A watched write names its subjects. Usually its params carry the
trigger's subject column; a statement that instead learns who it touched
as it runs (creating a row, deleting by token) is attributed by its call
site, which passes the subjects fetched from the write's own rows to
`attribute` before running its next statement -- an empty iterable is an
explicit nobody. Writes to a captured table (`Watch.capture`) also carry
the capture's key column, and the tracker reads the old value just before
executing the write, so triggers can patch derived state with the (old,
new) pair rather than re-reading every row. A transaction that commits
with a watched write attributed neither way raises instead of committing:
the fix is always to say who the write touched, never to remember to fire
anything.

Blind spots: statements that bypass the transaction layer entirely (psql
sessions); and foreign-key cascades, whose writes to a watched table
happen under a statement that never names it.
"""
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import psycopg
from pglast import ast, parse_sql
from pglast.visitors import Ancestor, Visitor

from serviceshared.database.tx import Row, Tx


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


def _relname(relation: ast.RangeVar | None) -> str:
    if relation is None or relation.relname is None:
        raise ValueError('DML statement without a target relation')
    return relation.relname


def _set_columns(target_list: tuple[ast.Node, ...] | None) -> frozenset[str]:
    return frozenset(
        target.name
        for target in target_list or ()
        if isinstance(target, ast.ResTarget) and target.name is not None)


class _Writes(Visitor):
    def __init__(self) -> None:
        self.writes: list[tuple[str, str, frozenset[str]]] = []
        self.dml_nodes = 0

    def visit_InsertStmt(
            self, ancestors: Ancestor, node: ast.InsertStmt) -> None:
        self.dml_nodes += 1
        relname = _relname(node.relation)
        self.writes.append((relname, 'insert', frozenset()))
        conflict = node.onConflictClause
        if conflict is None or not conflict.targetList:
            return
        self.writes.append(
            (relname, 'update', _set_columns(conflict.targetList)))

    def visit_UpdateStmt(
            self, ancestors: Ancestor, node: ast.UpdateStmt) -> None:
        self.dml_nodes += 1
        self.writes.append((
            _relname(node.relation),
            'update',
            _set_columns(node.targetList),
        ))

    def visit_DeleteStmt(
            self, ancestors: Ancestor, node: ast.DeleteStmt) -> None:
        self.dml_nodes += 1
        self.writes.append(
            (_relname(node.relation), 'delete', frozenset()))


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
    return value if type(value) is int else None


@dataclass
class _PendingHarvest:
    """A watched write whose params did not carry every watching trigger's
    subject column: the statement's tables (for the error when nothing
    attributes it), the triggers owed subjects, and the subjects
    `attribute` supplied -- None until it is called. The window stays open
    until the next statement, so the call site can fetch the write's rows
    first; `_expire_harvest` settles it."""
    tables: frozenset[str]
    trigger_names: set[str]
    attributed: set[int] | None = None


class _RawCursor(Protocol):
    """What the tracker needs of the raw cursor for its capture reads."""

    async def execute(
        self,
        query: str,
        params: psycopg.abc.Params | None = None,
    ) -> object:
        ...

    async def fetchone(self) -> Row | None:
        ...


class Tracker:
    """One transaction's view of the installed triggers: TxCursor reports
    what it is about to run and what it ran; `flush` fires whoever that
    made stale, before the transaction commits."""

    def __init__(self, cur: _RawCursor) -> None:
        # The raw cursor, so the tracker's own reads don't re-enter the
        # hooks that report to it.
        self._cur = cur
        self._stale: dict[str, set[int]] = {}
        self._captured_olds: dict[tuple[str, int, int], bool | None] = {}
        self._unattributed: set[str] = set()
        self._pending_harvest: _PendingHarvest | None = None

    def _expire_harvest(self) -> None:
        """Close the harvest window and settle it: an attributed write marks
        its subjects stale for every waiting trigger; one nobody attributed
        is condemned as unattributed."""
        pending, self._pending_harvest = self._pending_harvest, None
        if pending is None:
            return
        if pending.attributed is None:
            self._unattributed |= pending.tables
            return
        for name in pending.trigger_names:
            self._stale.setdefault(name, set()).update(pending.attributed)

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
        query: str,
        params: psycopg.abc.Params | None,
    ) -> None:
        """A statement is about to run. If it writes a captured table, read
        the old value now so triggers can patch derived state with the (old,
        new) pair instead of re-reading every row."""
        self._expire_harvest()
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
        query: str,
        params: psycopg.abc.Params | None,
        rowcount: int | None,
    ) -> None:
        """A statement ran (`rowcount` is None when it isn't knowable, as
        within executemany). Attribute any watched write to its subjects, or
        open the one-statement window for its fetched rows to do so."""
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
        awaiting: set[str] = set()
        for name in classified.triggers:
            trigger = _by_name[name]
            subject = _int_param(params, trigger.subject_column)
            if subject is None:
                awaiting.add(name)
            else:
                self._stale.setdefault(name, set()).add(subject)
        if awaiting:
            self._expire_harvest()
            self._pending_harvest = _PendingHarvest(
                tables=classified.tables, trigger_names=awaiting)

    def attribute(self, subjects: Iterable[int]) -> None:
        """The call site of a watched write whose params could not name its
        subjects names them here, from the write's own fetched rows, before
        its next statement; an empty iterable is an explicit nobody."""
        pending = self._pending_harvest
        if pending is None:
            raise RuntimeError(
                'nothing awaits attribution: the preceding statement either '
                'was not a watched write or already carried its subjects in '
                'its params')
        if pending.attributed is None:
            pending.attributed = set()
        pending.attributed.update(subjects)

    async def flush(self, tx: Tx) -> None:
        """Fire the triggers for whatever the transaction made stale, before
        it commits. Raises instead of committing when a watched write went
        unattributed: the fix is making the statement carry the triggers'
        subject columns (and the capture's key column, for captured tables)
        in its params, or having its call site pass the subjects it fetched
        to `attribute`."""
        self._expire_harvest()
        if self._unattributed:
            raise UnattributedWriteError(
                f'trigger-watched inputs in {sorted(self._unattributed)} '
                'were written without a subject to attribute them to; the '
                'statement must carry the subject column (and the captured '
                'key column) in its params, or its call site must pass the '
                'subjects it fetched to `attribute` before the next '
                'statement')
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
