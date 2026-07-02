import json
import psycopg
import duotypes as t
import sessioncache
from qanda import personality
from pydantic import ValidationError
from database import Tx, api_tx, row_int
from qanda.question import Q_QUESTION_SCORE_VECTORS
from rediscache import redis_cache
from collections.abc import Sequence
from typing import Literal, Tuple
from search.sql import (
    Q_CACHED_SEARCH,
    Q_PUBLIC_SEARCH,
    Q_PUBLIC_SEARCH_WITH_ANSWERS,
    Q_QUIZ_SEARCH,
    Q_SEARCH_PREFERENCE,
    Q_UNCACHED_SEARCH_1,
    Q_UNCACHED_SEARCH_2,
    Q_FEED,
)
from dataclasses import dataclass
from datetime import datetime


@dataclass
class ClubHttpArg:
    club: str | None


async def _quiz_search_results(
    tx: Tx,
    searcher_person_id: int,
) -> object:
    params = dict(
        searcher_person_id=searcher_person_id,
    )

    row_tx = await tx.execute(Q_QUIZ_SEARCH, params)
    return await row_tx.fetchall()


async def _uncached_search_results(
    tx: Tx,
    searcher_person_id: int,
    no: Tuple[int, int],
    gender_preference: list[int],
) -> object:
    n, o = no

    params = dict(
        searcher_person_id=searcher_person_id,
        n=n,
        o=o,
        gender_preference=gender_preference,
    )

    try:
        await tx.execute(Q_UNCACHED_SEARCH_1, params)
        await tx.execute(Q_UNCACHED_SEARCH_2, params)
        row_tx = await tx.execute(Q_CACHED_SEARCH, params)
        return await row_tx.fetchall()
    except psycopg.errors.QueryCanceled:
        return []


async def _cached_search_results(
    tx: Tx,
    searcher_person_id: int,
    no: Tuple[int, int],
) -> object:
    n, o = no

    params = dict(
        searcher_person_id=searcher_person_id,
        n=n,
        o=o,
    )

    row_tx = await tx.execute(Q_CACHED_SEARCH, params)
    return await row_tx.fetchall()


SearchType = Literal['quiz-search', 'uncached-search', 'cached-search']


def get_search_type(n: str | None, o: str | None) -> tuple[SearchType, Tuple[int, int] | None]:
    n_: int | None = n if n is None else int(n)
    o_: int | None = o if o is None else int(o)

    if n_ is not None and not n_ >= 0:
        raise ValueError('n must be >= 0')
    if o_ is not None and not o_ >= 0:
        raise ValueError('o must be >= 0')

    no = None if (n_ is None or o_ is None) else (n_, o_)

    if no is None:
        return 'quiz-search', no
    elif no[1] == 0:
        return 'uncached-search', no
    else:
        return 'cached-search', no


async def get_search(
    s: t.SessionInfo,
    n: str | None,
    o: str | None,
    club: ClubHttpArg | None,
) -> object:
    search_type, no = get_search_type(n, o)

    if no is not None and no[0] > 10:
        return 'n must be less than or equal to 10', 400

    if s.person_id is None:
        return '', 500

    params = dict(
        person_id=s.person_id,
        club_name=club.club if club else None,
        do_modify=club is not None,
    )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 10000') # 10 seconds

        row_tx = await tx.execute(Q_SEARCH_PREFERENCE, params)
        rows = await row_tx.fetchall()

        gender_preference = [row_int(row, 'gender_id') for row in rows]

        if search_type == 'quiz-search':
            result = await _quiz_search_results(
                tx=tx,
                searcher_person_id=s.person_id)

        elif search_type == 'uncached-search':
            if no is None:
                raise RuntimeError('uncached search requires pagination')
            result = await _uncached_search_results(
                tx=tx,
                searcher_person_id=s.person_id,
                no=no,
                gender_preference=gender_preference)

        elif search_type == 'cached-search':
            if no is None:
                raise RuntimeError('cached search requires pagination')
            result = await _cached_search_results(
                tx=tx,
                searcher_person_id=s.person_id,
                no=no)

        else:
            raise Exception('Unexpected quiz type')

    if s.pending_club_name is not None:
        await sessioncache.delete_session(s.session_token_hash)

    return result


async def get_public_search(
    n: str | None,
    o: str | None,
    answers: str | None = None,
) -> object:
    n_: int = 10 if n is None else int(n)
    o_: int = 0 if o is None else int(o)

    if not n_ >= 0:
        raise ValueError('n must be >= 0')
    if not o_ >= 0:
        raise ValueError('o must be >= 0')

    if n_ > 10:
        return 'n must be less than or equal to 10', 400

    if answers is not None:
        try:
            req = t.PublicSearchRequest(answers=json.loads(answers), n=n_, o=o_)
        except (ValueError, ValidationError) as e:
            return str(e), 400
        return await _get_public_search_with_answers(req)

    public_search = await _get_public_search()
    if not isinstance(public_search, list):
        raise RuntimeError('public search cache returned a non-list value')
    return public_search[o_:o_ + n_]


async def _get_public_search_with_answers(req: t.PublicSearchRequest) -> object:
    async with api_tx('READ COMMITTED') as tx:
        questions = {
            row_int(q, 'id'): q
            for q in await (await tx.execute(
                Q_QUESTION_SCORE_VECTORS,
                dict(question_ids=[a.question_id for a in req.answers]),
            )).fetchall()
        }

        presence, absence, count = personality.accumulate(
            (questions[a.question_id], a.answer)
            for a in req.answers
            if a.question_id in questions
        )

        searcher_personality = personality.to_pgvector(
            personality.personality_vector(presence, absence, count))

        return await (await tx.execute(Q_PUBLIC_SEARCH_WITH_ANSWERS, dict(
            searcher_personality=searcher_personality,
            n=req.n,
            o=req.o,
        ))).fetchall()


@redis_cache(ttl=60)
async def _get_public_search() -> Sequence[object]:
    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_PUBLIC_SEARCH)
        return await row_tx.fetchall()


async def get_feed(s: t.SessionInfo, before: datetime) -> object:
    params = dict(
        searcher_person_id=s.person_id,
        before=before,
    )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL jit = off')
        await tx.execute("SET LOCAL work_mem = '32MB'")

        row_tx = await tx.execute(Q_FEED, params)
        rows = await row_tx.fetchall()

    return [row['j'] for row in rows]
