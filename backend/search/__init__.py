import json
import psycopg
import time
import duotypes as t
import sessioncache
from qanda import personality
from pydantic import ValidationError
from database import Row, Tx, api_tx, row_float, row_int
from qanda.question import Q_QUESTION_SCORE_VECTORS
from rediscache import redis_cache
from collections.abc import Sequence
from typing import Literal, Tuple
from searchfilters import Q_SEARCH_PARAMETERS, SearchParam
from search.sql import (
    MAX_SEARCH_CANDIDATES,
    Q_APPLY_CLUB_PREFERENCE,
    Q_CACHED_SEARCH,
    Q_INSERT_SEARCH_CACHE,
    Q_PUBLIC_SEARCH,
    Q_PUBLIC_SEARCH_WITH_ANSWERS,
    Q_QUIZ_SEARCH,
    Q_DELETE_SEARCH_CACHE,
    Q_FEED,
    Q_FEED_V2,
    build_uncached_search,
    build_unordered_uncached_search,
    search_cache_insert_params,
)
from dataclasses import dataclass
from datetime import datetime


SEARCH_TIMEOUT_MS = 10_000

UNCACHED_SEARCH_FETCH_SECONDS = 10.0 # TODO

UNCACHED_SEARCH_FETCH_BATCH_SIZE = 10


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

    await tx.execute(Q_QUIZ_SEARCH, params)
    return await tx.fetchall()


def _trim_candidates(candidates: list[Row]) -> list[Row]:
    if len(candidates) <= MAX_SEARCH_CANDIDATES:
        return candidates
    candidates.sort(
        key=lambda c: row_float(c, 'match_percentage'), reverse=True)
    del candidates[MAX_SEARCH_CANDIDATES:]
    return candidates


PERSONALITY_INDEX_PREFIX = 'idx__person__personality'


def _plan_uses_personality_index(node: object) -> bool:
    if isinstance(node, list):
        return any(_plan_uses_personality_index(n) for n in node)
    if not isinstance(node, dict):
        return False
    index_name = node.get('Index Name')
    if isinstance(index_name, str) \
            and index_name.startswith(PERSONALITY_INDEX_PREFIX):
        return True
    return any(_plan_uses_personality_index(v) for v in node.values())


async def _search_plan_pipelines(
    tx: Tx,
    uncached_search: str,
    params: dict[str, SearchParam],
) -> bool:
    cursor = psycopg.AsyncClientCursor(tx.connection)
    merged = cursor.mogrify(uncached_search, params)
    await tx.execute('EXPLAIN (FORMAT JSON) ' + merged)
    plan = await tx.fetchone()
    if plan is None:
        return True
    return _plan_uses_personality_index(plan['QUERY PLAN'])


async def _fetch_search_candidates(
    tx: Tx,
    uncached_search: str,
    params: dict[str, SearchParam],
) -> list[Row]:
    deadline = time.monotonic() + UNCACHED_SEARCH_FETCH_SECONDS
    candidates: list[Row] = []

    async with tx.connection.cursor(
        name='uncached_search',
        scrollable=False,
    ) as cursor:
        print('Executing...', datetime.now()) # TODO
        await cursor.execute(uncached_search, params)
        print('Executed!', datetime.now()) # TODO
        print('Saving...', datetime.now()) # TODO
        await tx.execute('SAVEPOINT uncached_search_fetch')
        print('Saved!', datetime.now()) # TODO

        print('Starting batch fetch...', datetime.now()) # TODO
        i = 1
        while True:
            remaining_ms = int(1000 * (deadline - time.monotonic()))
            if remaining_ms <= 0:
                break

            await tx.execute(f'SET LOCAL statement_timeout = {remaining_ms}')

            try:
                batch = await cursor.fetchmany(
                    UNCACHED_SEARCH_FETCH_BATCH_SIZE)
                print('batch', i, datetime.now()) # TODO
                i += 1
            except psycopg.errors.QueryCanceled:
                await tx.execute('ROLLBACK TO SAVEPOINT uncached_search_fetch')
                break

            candidates.extend(batch)

            if len(candidates) >= 2 * MAX_SEARCH_CANDIDATES:
                _trim_candidates(candidates)

            if len(batch) < UNCACHED_SEARCH_FETCH_BATCH_SIZE:
                break

    return _trim_candidates(candidates)


async def _uncached_search_results(
    tx: Tx,
    searcher_person_id: int,
    no: Tuple[int, int],
) -> object:
    n, o = no

    prefs = await tx.require_one(
        Q_SEARCH_PARAMETERS,
        dict(searcher_person_id=searcher_person_id),
    )

    ordered_search, params = build_uncached_search(
        searcher_person_id=searcher_person_id,
        n=n,
        o=o,
        prefs=prefs,
    )
    unordered_search, _ = build_unordered_uncached_search(
        searcher_person_id=searcher_person_id,
        n=n,
        o=o,
        prefs=prefs,
    )

    try:
        await tx.execute('SET LOCAL jit = off')
        await tx.execute("SET LOCAL hnsw.iterative_scan = strict_order")

        uncached_search = (
            ordered_search
            if await _search_plan_pipelines(tx, ordered_search, params)
            else unordered_search
        )

        candidates = await _fetch_search_candidates(
            tx, uncached_search, params)

        await tx.execute(f'SET LOCAL statement_timeout = {SEARCH_TIMEOUT_MS}')

        await tx.execute(Q_DELETE_SEARCH_CACHE, params)
        if candidates:
            await tx.execute(
                Q_INSERT_SEARCH_CACHE,
                {**params, **search_cache_insert_params(candidates)},
            )
        await tx.execute(Q_CACHED_SEARCH, params)
        return await tx.fetchall()
    except psycopg.errors.QueryCanceled:
        # The query probably timed-out because it was too specific
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

    await tx.execute(Q_CACHED_SEARCH, params)
    return await tx.fetchall()


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
        await tx.execute(f'SET LOCAL statement_timeout = {SEARCH_TIMEOUT_MS}')

        await tx.execute(Q_APPLY_CLUB_PREFERENCE, params)

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
                no=no)

        elif search_type == 'cached-search':
            if no is None:
                raise RuntimeError('cached search requires pagination')
            result = await _cached_search_results(
                tx=tx,
                searcher_person_id=s.person_id,
                no=no)

        else:
            raise Exception('Unexpected quiz type')

    # Q_APPLY_CLUB_PREFERENCE clears `pending_club_name`, so drop the now-stale
    # cached session (see the sessioncache correctness model).
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
        await tx.execute(
            Q_QUESTION_SCORE_VECTORS,
            dict(question_ids=[a.question_id for a in req.answers]),
        )
        questions = {
            row_int(q, 'id'): q
            for q in await tx.fetchall()
        }

        presence, absence, count = personality.accumulate(
            (questions[a.question_id], a.answer)
            for a in req.answers
            if a.question_id in questions
        )

        searcher_personality = personality.to_pgvector(
            personality.personality_vector(presence, absence, count))

        await tx.execute(Q_PUBLIC_SEARCH_WITH_ANSWERS, dict(
            searcher_personality=searcher_personality,
            n=req.n,
            o=req.o,
        ))
        return await tx.fetchall()


@redis_cache(ttl=60)
async def _get_public_search() -> Sequence[object]:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_PUBLIC_SEARCH)
        return await tx.fetchall()


async def get_feed(s: t.SessionInfo, before: datetime) -> object:
    params = dict(
        searcher_person_id=s.person_id,
        before=before,
    )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL jit = off')
        await tx.execute("SET LOCAL work_mem = '32MB'")

        await tx.execute(Q_FEED, params)
        rows = await tx.fetchall()

    return [row['j'] for row in rows]


async def get_feed_v2(s: t.SessionInfo, before: datetime) -> object:
    params = dict(
        searcher_person_id=s.person_id,
        before=before,
    )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL jit = off')
        await tx.execute("SET LOCAL work_mem = '32MB'")

        await tx.execute(Q_FEED_V2, params)
        rows = await tx.fetchall()

    return [row['j'] for row in rows]
