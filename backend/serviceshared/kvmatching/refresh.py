"""Keep a person's matching vectors in step with their live database rows.

The sites that can change a person's answers, profile or search
preferences call into here in the same transaction as the change, because
their own key decides the order of their next search -- a filter change that
took a minute to show up would just look broken. The chat path calls in too:
its message events move the behaviour counters (a bounded model input read
back like any other), and each message therefore refreshes the *recipient's*
vector as well as any counter movement of the sender's.

A person's Q&A answers are the one input that grows without bound, so the
answer blocks' contribution to each encoder's first-layer preactivation is
cached on the person row (`kv_who_pre`, `kv_look_pre`, NULL until first
computed) and patched one column at a time as answers change (`apply_answer_delta`, `apply_pref_answer_delta`). The patches are
exact, not approximate: the first-layer weights ship on a fixed-point grid
(`encoder.W0_QUANTUM`) whose sums float32 represents exactly, so repeated
patching accumulates no rounding error. Every other input is a bounded
handful of rows, which `refresh_vectors` re-reads before running the
fixed-size remainder of the forward pass.

So no path here does work proportional to how many questions the person has
answered, with one deliberate exception: computing the cached sums for the
first time reads all the answers once, because summarising them requires
reading them at least once. That is the backfill cron's unit of work; after
it has passed (and for everyone created since, whose row is built at
onboarding), the exception never fires on the serving path.
"""
import asyncio

import numpy as np
import numpy.typing as npt
from pgvector import HalfVector

from serviceshared.database import Tx
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


async def build_vectors(tx: Tx, person_id: int | None) -> None:
    """Recompute this person's cached sums and vector from scratch, reading
    every answer they have: the backfill's unit of work."""
    if person_id is None:
        return
    s = spec()
    person = await _person_row(tx, person_id)
    if person is None:
        return
    qpre = await _build_qpre(tx, s, person_id, person)
    await _write_vector(tx, s, person_id, person, qpre)


async def refresh_vectors(tx: Tx, person_id: int | None) -> None:
    """Recompute this person's vector from the bounded inputs and the cached
    sums, at a fixed cost however much they have answered -- except the one
    time no cache exists yet, when it builds it. Accepts the optional
    person_id a session carries, so callers do not have to narrow it."""
    if person_id is None:
        return
    s = spec()
    person = await _person_row(tx, person_id)
    if person is None:
        return
    qpre = await _fetch_qpre(tx, person_id)
    if qpre is None:
        qpre = await _build_qpre(tx, s, person_id, person)
    await _write_vector(tx, s, person_id, person, qpre)


async def apply_answer_delta(
        tx: Tx,
        person_id: int | None,
        question_id: int,
        old: bool | None,
        new: bool | None,
) -> None:
    """A Q&A answer changed: patch one column of the cached preactivations and
    rebuild the person's vector, without reading their other answers."""
    s = spec()
    col = s.qid_column.get(question_id)
    delta = _answer_value(new) - _answer_value(old)
    if person_id is None or col is None or delta == 0:
        return
    steps = delta * encoder.INPUT_UNIT
    await _apply_delta(
        tx, person_id,
        s.who.w0[:, col] * steps,
        s.look.w0[:, col] * steps,
    )


async def apply_pref_answer_delta(
        tx: Tx,
        person_id: int | None,
        question_id: int,
        old: bool | None,
        new: bool | None,
) -> None:
    """Like `apply_answer_delta`, for a Q&A search-preference answer: those
    sit right after the profile block in the look encoder's input, and do not
    reach the who encoder."""
    s = spec()
    col = s.qid_column.get(question_id)
    delta = _answer_value(new) - _answer_value(old)
    if person_id is None or col is None or delta == 0:
        return
    await _apply_delta(
        tx, person_id,
        np.zeros(len(s.who.w0), np.int32),
        s.look.w0[:, s.who.w0.shape[1] + col] * delta * encoder.INPUT_UNIT,
    )


async def _apply_delta(tx: Tx, person_id: int,
                       who_delta: Steps, look_delta: Steps) -> None:
    cached = await _fetch_qpre(tx, person_id)
    if cached is None:
        await refresh_vectors(tx, person_id)
        return
    qpre = (cached[0] + who_delta, cached[1] + look_delta)
    await _write_qpre(tx, person_id, qpre)
    s = spec()
    person = await _person_row(tx, person_id)
    if person is None:
        return
    await _write_vector(tx, s, person_id, person, qpre)
