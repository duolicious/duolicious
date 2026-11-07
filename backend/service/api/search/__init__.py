import asyncio
import psycopg
import service.api.duotypes as t
from service.api import sessioncache
from serviceshared.matching import personality
from pgvector import Vector

from serviceshared.database import Tx, api_tx, row_bool, row_int
from serviceshared.util.coerce import integer
from serviceshared.matching.personality import Q_QUESTION_SCORE_VECTORS
from service.api.search.rediscache import redis_cache
from service.api.redisclient import make_redis_client
from collections.abc import Sequence
from typing import Literal
from service.api.searchfilters import Q_SEARCH_PARAMETERS
from service.api.search.sql import (
    Q_APPLY_CLUB_PREFERENCE,
    Q_CACHED_SEARCH,
    Q_CACHED_SIMILAR_PROFILES,
    Q_PUBLIC_SEARCH,
    Q_PUBLIC_SEARCH_WITH_ANSWERS,
    Q_PUBLIC_SIMILAR_PROFILES,
    Q_PUBLIC_SIMILAR_PROFILES_WITH_ANSWERS,
    Q_QUIZ_SEARCH,
    Q_SAME_COUNTRY_ONLY,
    build_uncached_search,
    feed_v2_query,
)
from dataclasses import dataclass
from datetime import datetime, timedelta


_NUM_SIMILAR_PROFILES = 8

_redis = make_redis_client()


@dataclass
class ClubHttpArg:
    club: str | None


async def _search_results(
    query: str,
    prospect_person_ids: list[int],
    params: dict[str, int],
) -> object:
    if not prospect_person_ids:
        return []

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(
            query, dict(params, prospect_person_ids=prospect_person_ids))
        return await tx.fetchall()


async def _prospect_ids(
    searcher_person_id: int,
    refresh: bool,
    ignore_sort_preference: bool,
) -> list[int]:
    key = f'search_results:{searcher_person_id}'

    while True:
        saved = None if refresh else await _redis.get(key)

        if saved is not None:
            return list(map(int, saved.split()))

        if await _redis.set(f'{key}:lock', '1', nx=True, ex=15):
            break

        await asyncio.sleep(0.05)

    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute('SET LOCAL statement_timeout = 10000') # 10 seconds

            prefs = await tx.require_one(
                Q_SEARCH_PARAMETERS,
                dict(searcher_person_id=searcher_person_id),
            )

            uncached_search, params = build_uncached_search(
                searcher_person_id=searcher_person_id,
                prefs=prefs,
                ignore_sort_preference=ignore_sort_preference,
            )

            try:
                await tx.execute('SET LOCAL jit = off')
                await tx.execute(uncached_search, params)
                prospect_person_ids = [
                    row_int(row, 'prospect_person_id')
                    for row in await tx.fetchall()
                ]
                timed_out = False
            except psycopg.errors.QueryCanceled:
                # The query probably timed-out because it was too specific
                prospect_person_ids = []
                timed_out = True

        await _redis.set(
            key,
            ' '.join(map(str, prospect_person_ids)),
            ex=timedelta(days=1),
            nx=timed_out,
        )

        return prospect_person_ids
    finally:
        await _redis.delete(f'{key}:lock')


SearchType = Literal[
    'quiz-search', 'quiz-refresh', 'uncached-search', 'cached-search']


def get_search_type(q: t.SearchQuery) -> SearchType:
    if q.o is None and q.n is None:
        return 'quiz-search'
    elif q.o is None:
        return 'quiz-refresh'
    elif q.o == 0:
        return 'uncached-search'
    else:
        return 'cached-search'


async def get_search(
    s: t.SessionInfo,
    q: t.SearchQuery,
    club: ClubHttpArg | None,
) -> object:
    search_type = get_search_type(q)

    n = 1 if q.n is None else q.n
    o = 0 if q.o is None else q.o

    if s.person_id is None:
        return '', 500

    params = dict(
        person_id=s.person_id,
        club_name=club.club if club else None,
        do_modify=club is not None,
    )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_APPLY_CLUB_PREFERENCE, params)

    is_quiz = search_type in ('quiz-search', 'quiz-refresh')

    prospect_person_ids = await _prospect_ids(
        searcher_person_id=s.person_id,
        refresh=search_type in ('quiz-refresh', 'uncached-search'),
        ignore_sort_preference=is_quiz,
    )

    result = await _search_results(
        query=Q_QUIZ_SEARCH if is_quiz else Q_CACHED_SEARCH,
        prospect_person_ids=(
            prospect_person_ids if is_quiz
            else prospect_person_ids[o:o + n]),
        params=dict(searcher_person_id=s.person_id, n=n),
    )

    # Q_APPLY_CLUB_PREFERENCE clears `pending_club_name`, so drop the now-stale
    # cached session (see the sessioncache correctness model).
    if s.pending_club_name is not None:
        await sessioncache.delete_session(s.session_token_hash)

    return result


async def get_public_search(q: t.PublicSearchQuery) -> object:
    gender = q.gender.root if q.gender else None

    if q.answers is not None:
        return await _get_public_search_with_answers(q, q.answers.root, gender)

    public_search = await _get_public_search(gender, q.min_age, q.max_age)
    if not isinstance(public_search, list):
        raise RuntimeError('public search cache returned a non-list value')
    return public_search[q.o:q.o + q.n]


async def _searcher_personality(
    tx: Tx,
    answers: list[t.PublicAnswer],
) -> Vector:
    await tx.execute(
        Q_QUESTION_SCORE_VECTORS,
        dict(question_ids=[a.question_id for a in answers]),
    )
    questions = {
        row_int(q, 'id'): q
        for q in await tx.fetchall()
    }

    presence, absence, count = personality.accumulate(
        (questions[a.question_id], a.answer)
        for a in answers
        if a.question_id in questions
    )

    return Vector(personality.personality_vector(presence, absence, count))


async def _get_public_search_with_answers(
    q: t.PublicSearchQuery,
    answers: list[t.PublicAnswer],
    gender: list[str] | None,
) -> object:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_PUBLIC_SEARCH_WITH_ANSWERS, dict(
            searcher_personality=await _searcher_personality(tx, answers),
            gender=gender,
            min_age=q.min_age,
            max_age=q.max_age,
            n=q.n,
            o=q.o,
        ))
        return await tx.fetchall()


async def similar_profiles(
    viewer_person_id: int | None,
    prospect_person_id: int,
    answers: list[t.PublicAnswer] | None,
) -> object:
    if viewer_person_id is not None:
        return await _search_results(
            query=Q_CACHED_SIMILAR_PROFILES,
            prospect_person_ids=await _prospect_ids(
                searcher_person_id=viewer_person_id,
                refresh=False,
                ignore_sort_preference=False,
            ),
            params=dict(
                searcher_person_id=viewer_person_id,
                prospect_person_id=prospect_person_id,
                n=_NUM_SIMILAR_PROFILES,
            ),
        )

    if answers is None:
        return await _public_similar_profiles(prospect_person_id)

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_PUBLIC_SIMILAR_PROFILES_WITH_ANSWERS, dict(
            searcher_personality=await _searcher_personality(tx, answers),
            prospect_person_id=prospect_person_id,
            n=_NUM_SIMILAR_PROFILES,
        ))
        return await tx.fetchall()


@redis_cache(ttl=60)
async def _public_similar_profiles(prospect_person_id: int) -> object:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_PUBLIC_SIMILAR_PROFILES, dict(
            prospect_person_id=prospect_person_id,
            n=_NUM_SIMILAR_PROFILES,
        ))
        return await tx.fetchall()


@redis_cache(ttl=60)
async def _get_public_search(
    gender: list[str] | None,
    min_age: int | None,
    max_age: int | None,
) -> Sequence[object]:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_PUBLIC_SEARCH, dict(
            gender=gender,
            min_age=min_age,
            max_age=max_age,
        ))
        return await tx.fetchall()


async def get_feed_v2(s: t.SessionInfo, before: datetime) -> object:
    person_id = integer(s.person_id)

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL jit = off')
        await tx.execute("SET LOCAL work_mem = '32MB'")

        same_country_only = row_bool(
            await tx.require_one(
                Q_SAME_COUNTRY_ONLY,
                params=dict(person_id=person_id),
            ),
            'same_country_only',
        )

        await tx.execute(
            feed_v2_query(same_country_only=same_country_only),
            dict(searcher_person_id=person_id, before=before),
        )
        rows = await tx.fetchall()

    return [row['j'] for row in rows]
