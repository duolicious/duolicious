"""Recomputing a person's matching vectors.

The model's weights are frozen -- they change only when a new artifact is
deployed -- but a person's vectors change whenever their answers, profile,
clubs or search preferences do, and their own `key` half decides the order of
their next search. So the sites that change those inputs call
`refresh_vectors` in the same transaction, and the cron
(service/cron/kvvectors) uses the same function to backfill everyone whose
vectors predate the current artifact.
"""
from collections.abc import Sequence

import numpy as np

from serviceshared.database import Tx
from serviceshared.pgvector import to_pgvector
from serviceshared.kvmatching import features, rows as rowbuilder
from serviceshared.kvmatching.spec import Spec
from serviceshared.kvmatching.sql import (
    Q_ANSWERS,
    Q_CLUBS,
    Q_PERSON_ROWS,
    Q_PREF_ANSWERS,
    Q_WRITE_VECTORS,
)

_spec: Spec | None = None


def spec() -> Spec:
    global _spec
    if _spec is None:
        _spec = Spec()
    return _spec


async def refresh_vectors(tx: Tx, person_ids: Sequence[int | None]) -> int:
    """Recompute and store kv_vector for these people, in this transaction.
    Returns how many rows were written. Accepts the optional person_id that
    sessions carry, so callers do not each have to narrow it."""
    ids = [p for p in person_ids if p is not None]
    if not ids:
        return 0

    s = spec()
    params = dict(person_ids=ids)

    await tx.execute(Q_PERSON_ROWS, params)
    people = await tx.fetchall()
    if not people:
        return 0

    await tx.execute(Q_ANSWERS, params)
    answers = [
        (int(r['person_id']), int(r['question_id']), bool(r['answer']))
        for r in await tx.fetchall()
    ]
    await tx.execute(Q_PREF_ANSWERS, params)
    pref_answers = [
        (int(r['person_id']), int(r['question_id']), bool(r['answer']))
        for r in await tx.fetchall()
    ]
    await tx.execute(Q_CLUBS, params)
    clubs = [(int(r['person_id']), str(r['club_name'])) for r in await tx.fetchall()]

    blocks = rowbuilder.build(s, people, answers, pref_answers, clubs)
    who, wbias = s.who.forward(features.who_input(s, blocks))
    look, lbias = s.look.forward(features.look_input(s, blocks))

    # `value || key`, the layout person.kv_vector holds
    vectors = [
        to_pgvector(
            list(np.asarray(who[i], np.float64)) + [1.0, float(wbias[i])] +
            list(np.asarray(look[i], np.float64)) + [float(lbias[i]), 1.0])
        for i in range(len(who))
    ]
    await tx.execute(Q_WRITE_VECTORS, dict(
        person_ids=[int(x) for x in blocks.person_ids],
        vectors=vectors,
    ))
    return len(vectors)
