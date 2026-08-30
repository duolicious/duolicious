"""Per-transaction staleness tracking, driven by the transaction layer.

`TxCursor` (serviceshared/database) owns one `StaleTracker` per transaction
and reports what it is about to run, what it ran, and what it fetched; the
tracker classifies the statements against the models' declarations and
recomputes whoever they made stale in `flush`, before the transaction
commits. The database layer knows these hooks and nothing else about
matching models.
"""
import psycopg

from collections.abc import Iterable

from serviceshared.matching import CAPTURE_TABLES, MODELS, classify
from serviceshared.matching.model import AnswerChange, StalenessError
from serviceshared.tx import CursorQuery, Row, Tx

_Q_OLD_ANSWER = {
    table: f'SELECT answer FROM {table} '
           'WHERE person_id = %(person_id)s AND question_id = %(question_id)s'
    for table in CAPTURE_TABLES
}


def _int_param(params: psycopg.abc.Params | None, key: str) -> int | None:
    value = params.get(key) if isinstance(params, dict) else None
    return value if isinstance(value, int) else None


class StaleTracker:
    def __init__(
        self,
        cur: psycopg.AsyncCursor[Row],
        suppressed: bool = False,
    ) -> None:
        # The raw cursor, so the tracker's own reads don't re-enter the
        # hooks that report to it.
        self._cur = cur
        self._suppressed = suppressed
        self._stale: dict[str, set[int]] = {}
        self._answer_olds: dict[tuple[str, int, int], bool | None] = {}
        self._unattributed: set[str] = set()
        self._pending_harvest: frozenset[str] | None = None

    def _expire_harvest(self) -> None:
        if self._pending_harvest is not None:
            self._unattributed |= self._pending_harvest
            self._pending_harvest = None

    async def _read_answer(
            self, table: str, person_id: int, question_id: int) -> bool | None:
        await self._cur.execute(
            _Q_OLD_ANSWER[table],
            dict(person_id=person_id, question_id=question_id))
        row = await self._cur.fetchone()
        if row is None or row['answer'] is None:
            return None
        return bool(row['answer'])

    async def note_before(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None,
    ) -> None:
        """A statement is about to run. If it writes a captured table, read
        the old value now so models can patch derived sums with the (old,
        new) pair instead of re-reading every row."""
        self._expire_harvest()
        if self._suppressed or not isinstance(query, str):
            return
        person_id = _int_param(params, 'person_id')
        question_id = _int_param(params, 'question_id')
        if person_id is None or question_id is None:
            return
        for table in classify(query).capture_tables:
            key = (table, person_id, question_id)
            if key not in self._answer_olds:
                self._answer_olds[key] = await self._read_answer(
                        table, person_id, question_id)

    def note_after(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None,
        rowcount: int | None,
    ) -> None:
        """A statement ran (`rowcount` is None when it isn't knowable, as
        within executemany). Attribute any watched write to a person, or
        open the one-statement window for its fetched rows to do so."""
        if self._suppressed or not isinstance(query, str):
            return
        classified = classify(query)
        if not classified.models:
            return
        if (rowcount is not None
                and rowcount == 0
                and classified.rowcount_reliable):
            return
        person_id = _int_param(params, 'person_id')
        question_id = _int_param(params, 'question_id')
        captured = all(
            (table, person_id, question_id) in self._answer_olds
            for table in classified.capture_tables)
        if not captured:
            self._unattributed |= classified.tables
            return
        if person_id is None:
            self._pending_harvest = classified.models
            return
        for name in classified.models:
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
            person_id = row.get('person_id')
            person_ids = row.get('person_ids')
            attributed = [person_id] if isinstance(person_id, int) else []
            attributed += (
                one for one in
                (person_ids if isinstance(person_ids, list) else [])
                if isinstance(one, int))
            for name in self._pending_harvest:
                self._stale.setdefault(name, set()).update(attributed)
            self._pending_harvest = None
            return

    async def flush(self, tx: Tx) -> None:
        """Recompute whatever the transaction made stale, before it commits.
        Raises instead of committing when a watched write went unattributed:
        the fix is making the statement carry person_id (and question_id for
        captured tables) in its params, or report who it touched in its
        RETURNING rows."""
        self._expire_harvest()
        if self._suppressed:
            return
        if self._unattributed:
            raise StalenessError(
                f'matching-model inputs in {sorted(self._unattributed)} were '
                'written without a person to refresh; the statement must '
                'carry person_id (and question_id for captured tables) in '
                'its params, or return a person_id/person_ids column')
        if not self._stale and not self._answer_olds:
            return

        changes: dict[int, list[AnswerChange]] = {}
        for (table, person_id, question_id), old in self._answer_olds.items():
            new = await self._read_answer(table, person_id, question_id)
            if new == old:
                continue
            changes.setdefault(person_id, []).append(AnswerChange(
                table=table,
                question_id=question_id,
                old=old,
                new=new,
            ))

        for model in MODELS:
            for person_id in sorted(self._stale.get(model.name, ())):
                await model.person_changed(tx, person_id, [
                    change for change in changes.get(person_id, [])
                    if change.table in model.watched])
