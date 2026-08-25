"""Keep person.kv_vector in step with people's profiles.

The model's weights are frozen -- they only change when a new artifact is
deployed -- but a person's vectors change whenever their answers, profile,
clubs or search preferences do. Rather than recompute at every site that can
mutate those, this walks the table oldest-computed-first, so an edit is
picked up within one pass and a newly deployed artifact re-vectorises
everyone without any other trigger. New people sort first: their
kv_vector_computed_at is still the epoch.
"""
import asyncio
import logging
import random

from psycopg.errors import DeadlockDetected, QueryCanceled

from serviceshared.database import api_tx
from serviceshared.duoenv.cron import (
    KV_VECTORS_BATCH_SIZE,
    KV_VECTORS_POLL_SECONDS,
    KV_VECTORS_WRITE_TIMEOUT_MS,
)
from service.cron.cronutil import log_stacktrace, MAX_RANDOM_START_DELAY
from service.cron.kvvectors import features, rows as rowbuilder
from service.cron.kvvectors.spec import Spec
from service.cron.kvvectors.sql import (
    Q_ANSWERS,
    Q_CLUBS,
    Q_PERSON_ROWS,
    Q_PREF_ANSWERS,
    Q_STALE_PEOPLE,
    Q_WRITE_VECTORS,
)

logger = logging.getLogger(__name__)

_spec: Spec | None = None


def spec() -> Spec:
    global _spec
    if _spec is None:
        _spec = Spec()
    return _spec


def to_pgvector(vector: list[float]) -> str:
    return '[' + ','.join(repr(float(x)) for x in vector) + ']'


async def refresh_kv_vectors_once() -> None:
    s = spec()

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_STALE_PEOPLE, dict(batch_size=KV_VECTORS_BATCH_SIZE))
        person_ids = [int(row['id']) for row in await tx.fetchall()]

    if not person_ids:
        return

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_PERSON_ROWS, dict(person_ids=person_ids))
        people = await tx.fetchall()
        await tx.execute(Q_ANSWERS, dict(person_ids=person_ids))
        answers = [
            (int(r['person_id']), int(r['question_id']), bool(r['answer']))
            for r in await tx.fetchall()
        ]
        await tx.execute(Q_PREF_ANSWERS, dict(person_ids=person_ids))
        pref_answers = [
            (int(r['person_id']), int(r['question_id']), bool(r['answer']))
            for r in await tx.fetchall()
        ]
        await tx.execute(Q_CLUBS, dict(person_ids=person_ids))
        clubs = [(int(r['person_id']), str(r['club_name'])) for r in await tx.fetchall()]

    if not people:
        return

    built = rowbuilder.build(s, people, answers, pref_answers, clubs)
    who, wbias = s.who.forward(features.who_input(s, built))
    look, lbias = s.look.forward(features.look_input(s, built))

    vectors = [
        to_pgvector(
            list(who[i]) + [1.0, float(wbias[i])] +
            list(look[i]) + [float(lbias[i]), 1.0])
        for i in range(len(who))
    ]
    ids = [int(x) for x in built.person_ids]

    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(
                f'SET LOCAL statement_timeout = {KV_VECTORS_WRITE_TIMEOUT_MS}')
            await tx.execute(Q_WRITE_VECTORS, dict(
                person_ids=ids, vectors=vectors))
    except (DeadlockDetected, QueryCanceled):
        logger.warning('writing kv vectors: batch timed out or deadlocked')
        return

    logger.info(f'refreshed {len(ids)} kv vectors')


async def refresh_kv_vectors_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_kv_vectors_once)
        await asyncio.sleep(KV_VECTORS_POLL_SECONDS)
