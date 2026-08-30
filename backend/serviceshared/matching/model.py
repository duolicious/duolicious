from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from serviceshared.tx import Tx


@dataclass(frozen=True)
class Watch:
    """Which writes to one table make a model's output stale: updates of
    these columns, and inserts or deletes of whole rows. `capture` is for
    answer-shaped tables keyed (person_id, question_id): the old `answer` is
    read just before the write and delivered with the update as an
    `AnswerChange`, so the model can patch derived state instead of
    re-reading every row."""
    update_columns: frozenset[str] = frozenset()
    inserts: bool = False
    deletes: bool = False
    capture: bool = False


@dataclass(frozen=True)
class AnswerChange:
    table: str
    question_id: int
    old: bool | None
    new: bool | None


class MatchingModel(Protocol):
    name: str
    watched: Mapping[str, Watch]

    async def person_changed(
        self,
        tx: Tx,
        person_id: int,
        changes: Sequence[AnswerChange],
    ) -> None:
        ...


class StalenessError(RuntimeError):
    pass
