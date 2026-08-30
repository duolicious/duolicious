"""Matching models, and what makes their output vectors stale.

A matching model plugs in by appending itself to `MODELS`: it declares which
tables and columns it reads (`watched`) and how to recompute one person
(`person_changed`). That one declaration is the whole integration -- the
transaction layer (serviceshared/database) parses every SQL statement it
executes against the union of the declarations (`classify`, once per query
string, cached) and calls each affected model for each affected person
before the transaction commits. A change and the vectors derived from it
land together, atomically, and no call site anywhere knows the models
exist.

A watched write names who it made stale on its own. Usually its params
carry `person_id`; a statement that instead learns who it touched as it
runs (creating a person, deleting by token) reports through its own
RETURNING rows -- a fetched column called `person_id` or `person_ids`
attributes it, even when NULL (an explicit nobody). Writes to a captured
table (`Watch.capture`) carry `question_id` too, and the cursor reads the
old value just before executing the write, so models can patch derived
sums with the (old, new) pair rather than re-reading every row. A
transaction that commits with a watched write attributed none of these
ways raises instead of committing: the fix is always to make the statement
say who it touched, never to remember a call.

Statements that bypass the transaction layer entirely (psql sessions) are
the one blind spot. Bulk maintenance that rewrites whole tables (schema
migrations) opts out with `api_tx(suppress_stale_checks=True)` and repairs
the affected people by whatever each model uses as a backfill.
"""
import re
from dataclasses import dataclass
from functools import lru_cache

from pglast import parse_sql
from pglast.visitors import Visitor

from serviceshared.matching import clubs, personality
from serviceshared.matching.model import (
    AnswerChange,
    MatchingModel,
    StalenessError,
    Watch,
)

MODELS: tuple[MatchingModel, ...] = (
    personality.MODEL,
    clubs.MODEL,
)

CAPTURE_TABLES = frozenset(
    table
    for model in MODELS
    for table, watch in model.watched.items()
    if watch.capture)


@dataclass(frozen=True)
class Classification:
    models: frozenset[str]
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
    """Which models this statement can make stale. Parsed once per query
    string (the queries are mostly module-level constants, so in practice a
    dict hit); the cache is bounded so dynamically built queries can't leak
    memory."""
    tree = parse_sql(_PLACEHOLDER.sub('NULL', query))
    visitor = _Writes()
    visitor(tree)

    models: set[str] = set()
    tables: set[str] = set()
    for table, op, columns in visitor.writes:
        for model in MODELS:
            watch = model.watched.get(table)
            if watch and _hit(watch, op, columns):
                models.add(model.name)
                tables.add(table)

    top_level_dml = (
        len(tree) == 1
        and type(tree[0].stmt).__name__ in _DML_STATEMENTS)
    return Classification(
        models=frozenset(models),
        tables=frozenset(tables),
        capture_tables=frozenset(tables) & CAPTURE_TABLES,
        rowcount_reliable=top_level_dml and visitor.dml_nodes == 1,
    )
