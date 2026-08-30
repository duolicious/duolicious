from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from serviceshared.tx import Tx


@dataclass(frozen=True)
class Capture:
    """How to snapshot a captured table's row around a write. The table is
    keyed (person_id, `key_column`), both taken from the writing statement's
    params, and the boolean `value_column` is read just before the write and
    again before commit; the model receives the pair as a `CapturedChange`,
    so it can patch derived state instead of re-reading every row."""
    key_column: str
    value_column: str

    def query(self, table: str) -> str:
        return (
            f'SELECT {self.value_column} FROM {table} '
            f'WHERE person_id = %(person_id)s '
            f'AND {self.key_column} = %({self.key_column})s')


@dataclass(frozen=True)
class Watch:
    """Which writes to one table make a model's output stale: updates of
    these columns, and inserts or deletes of whole rows."""
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


class MatchingModel(Protocol):
    name: str
    watched: Mapping[str, Watch]

    async def person_changed(
        self,
        tx: Tx,
        person_id: int,
        changes: Sequence[CapturedChange],
    ) -> None:
        ...


class StalenessError(RuntimeError):
    pass
