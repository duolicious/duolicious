"""Keep a person's matching vectors in step with their live database rows.

Nothing calls in here directly: the model is registered as an
application-level trigger (serviceshared/matching/kv.py), so the
transaction layer fires `refresh` for whoever a transaction's writes made
stale, before it commits -- a filter change that took even a minute to
show up in its owner's next search would just look broken.

A person's Q&A answers are the one input that grows without bound, so the
answer blocks' contribution to each encoder's first-layer preactivation is
cached on the person row (`kv_who_pre`, `kv_look_pre`, NULL until first
computed). An answer change arrives from the trigger layer as an (old, new)
pair and patches one column of the cache -- integer addition, exact however
often it happens. Every other input is a bounded handful of rows, re-read
before running the fixed-size remainder of the forward pass.

So no path here does work proportional to how many questions the person has
answered, with one deliberate exception: computing the cached sums for the
first time reads all the answers once, because summarising them requires
reading them at least once. That is the backfill cron's unit of work; after
it has passed (and for everyone created since, whose row is built at
onboarding), the exception never fires on the serving path.
"""
import asyncio
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt
from pgvector import HalfVector

from serviceshared.database.triggers import CapturedChange
from serviceshared.database.tx import Tx
from serviceshared.kvmatching import encoder, features, rows as rowbuilder
from serviceshared.kvmatching.blocks import FloatArray
from serviceshared.kvmatching.rows import Row, Triple
from serviceshared.kvmatching.spec import Spec
from serviceshared.kvmatching.sql import (
    Q_QPRE,
    Q_WRITE_QPRE,
    Q_WRITE_VECTOR,
    answers_query,
    person_rows_query,
    pref_answers_query,
)

Q_PERSON_ROWS = person_rows_query(everyone=False)
Q_ANSWERS = answers_query(everyone=False)
Q_PREF_ANSWERS = pref_answers_query(everyone=False)

_ANSWER_QUERIES = {
    table: f"""
    SELECT answer FROM {table}
    WHERE person_id = %(person_id)s
    AND question_id = %(question_id)s
    """
    for table in ('answer', 'search_preference_answer')
}

_spec: Spec | None = None

Steps = npt.NDArray[np.int32]
Qpre = tuple[Steps, Steps]


def spec() -> Spec:
    """The frozen weights, loaded once per process."""
    global _spec
    if _spec is None:
        _spec = Spec()
    return _spec


def _answer_value(answer: bool | None) -> int:
    if answer is None:
        return 0
    return 1 if answer else -1


def _steps(value: object) -> Steps:
    if not isinstance(value, list):
        raise RuntimeError(f'expected an array, got {type(value).__name__}')
    return np.asarray(value, np.int32)


async def _person_row(tx: Tx, person_id: int) -> Row | None:
    await tx.execute(Q_PERSON_ROWS, dict(person_id=person_id))
    rows = await tx.fetchall()
    return rows[0] if rows else None


async def _fetch_triples(tx: Tx, query: str, person_id: int) -> list[Triple]:
    await tx.execute(query, dict(person_id=person_id))
    return [
        (int(r['person_id']), int(r['question_id']), bool(r['answer']))
        for r in await tx.fetchall()
    ]


async def _fetch_qpre(tx: Tx, person_id: int) -> Qpre | None:
    await tx.execute(Q_QPRE, dict(person_id=person_id))
    rows = await tx.fetchall()
    if not rows:
        return None
    return _steps(rows[0]['who_pre']), _steps(rows[0]['look_pre'])


def _qpre_of(s: Spec, person: Row, answers: list[Triple],
             pref_answers: list[Triple]) -> Qpre:
    blocks = rowbuilder.build(s, [person], answers, pref_answers)
    return (s.who.pre_answers(features.who_input(s, blocks))[0],
            s.look.pre_answers(features.look_input(s, blocks))[0])


async def _build_qpre(tx: Tx, s: Spec, person_id: int, person: Row) -> Qpre:
    """Compute and store the answer blocks' preactivation contributions from
    scratch, counted in the same grid steps the one-column patches add."""
    answers = await _fetch_triples(tx, Q_ANSWERS, person_id)
    pref_answers = await _fetch_triples(tx, Q_PREF_ANSWERS, person_id)
    qpre = await asyncio.to_thread(_qpre_of, s, person, answers, pref_answers)
    await _write_qpre(tx, person_id, qpre)
    return qpre


async def _write_qpre(tx: Tx, person_id: int, qpre: Qpre) -> None:
    await tx.execute(Q_WRITE_QPRE, dict(
        person_id=person_id,
        who_pre=qpre[0].tolist(),
        look_pre=qpre[1].tolist(),
    ))


async def _patch_qpre(
    tx: Tx,
    s: Spec,
    person_id: int,
    qpre: Qpre,
    changes: Sequence[CapturedChange],
) -> Qpre:
    """Fold the captured answer changes into the cached sums. The new value
    is re-read from the table rather than taken from the change, because a
    watched statement may not have written what it carried (the filter
    upsert refuses answers over the cap)."""
    who_delta = np.zeros(len(s.who.w0), np.int32)
    look_delta = np.zeros(len(s.look.w0), np.int32)
    moved = False
    for change in changes:
        col = s.qid_column.get(change.key)
        if col is None:
            continue
        await tx.execute(_ANSWER_QUERIES[change.table], dict(
            person_id=person_id, question_id=change.key))
        row = await tx.fetchone()
        stored = row['answer'] if row is not None else None
        current = bool(stored) if stored is not None else None
        steps = (_answer_value(current) - _answer_value(change.old)) \
            * encoder.INPUT_UNIT
        if steps == 0:
            continue
        if change.table == 'answer':
            who_delta += s.who.w0[:, col] * steps
            look_delta += s.look.w0[:, col] * steps
        else:
            look_delta += s.look.w0[:, s.who.w0.shape[1] + col] * steps
        moved = True
    if not moved:
        return qpre
    qpre = (qpre[0] + who_delta, qpre[1] + look_delta)
    await _write_qpre(tx, person_id, qpre)
    return qpre


def _stored_of(s: Spec, person: Row, qpre: Qpre) -> FloatArray:
    rest = rowbuilder.build(s, [person], [], [])
    who, wbias = s.who.head(
        s.who.pre_live(features.who_input(s, rest))[0] + qpre[0])
    look, lbias = s.look.head(
        s.look.pre_live(features.look_input(s, rest))[0] + qpre[1])
    return encoder.stored_vector(who, wbias, look, lbias)


async def _write_vector(tx: Tx, s: Spec, person_id: int, person: Row,
                        qpre: Qpre) -> None:
    """Re-read the bounded inputs, add the cached answer contributions, run
    the heads, and store the vector."""
    stored = await asyncio.to_thread(_stored_of, s, person, qpre)
    await tx.execute(Q_WRITE_VECTOR, dict(
        person_id=person_id,
        vector=HalfVector(stored),
    ))


async def build_vectors(tx: Tx, person_id: int) -> None:
    """Recompute this person's cached sums and vector from scratch, reading
    every answer they have: the backfill's unit of work."""
    s = spec()
    person = await _person_row(tx, person_id)
    if person is None:
        return
    qpre = await _build_qpre(tx, s, person_id, person)
    await _write_vector(tx, s, person_id, person, qpre)


async def refresh(
    tx: Tx,
    person_id: int,
    changes: Sequence[CapturedChange] = (),
) -> None:
    """The trigger's whole job: patch the cached sums with whatever answer
    changes were captured -- or build them the one time none exist yet --
    then re-read the bounded inputs and rerun the fixed-size tail."""
    s = spec()
    person = await _person_row(tx, person_id)
    if person is None:
        return
    qpre = await _fetch_qpre(tx, person_id)
    if qpre is None:
        qpre = await _build_qpre(tx, s, person_id, person)
    else:
        qpre = await _patch_qpre(tx, s, person_id, qpre, changes)
    await _write_vector(tx, s, person_id, person, qpre)
