import asyncio
import logging
import psycopg
from pgvector.psycopg import register_vector_async
from psycopg_pool import AsyncConnectionPool
import random
from contextlib import asynccontextmanager, suppress
from collections.abc import AsyncIterator, Iterable
from serviceshared.database._row import (
    require_row,
    row_bool,
    row_vector,
    row_int,
    row_int_list,
    row_int_list_or_none,
    row_int_or_none,
    row_str,
    row_str_list,
    row_str_or_none,
    row_value,
)

from serviceshared.duoenv.shared import (
    DB_HOST,
    DB_PASS,
    DB_POOL_MAX_SIZE as _pool_max_size,
    DB_POOL_MIN_SIZE as _pool_min_size,
    DB_PORT,
    DB_USER,
)
from serviceshared.tx import CursorQuery, Row, Tx
from serviceshared.matching import (
    CAPTURE_TABLES,
    MODELS,
    AnswerChange,
    StalenessError,
    classify,
)

logger = logging.getLogger(__name__)

_valid_isolation_levels = [
    'SERIALIZABLE',
    'REPEATABLE READ',
    'READ COMMITTED',
]

_default_transaction_isolation = 'REPEATABLE READ'

_coninfo_args = dict(
    host=DB_HOST,
    port=DB_PORT,
    user=DB_USER,
    password=DB_PASS,
    options=(
        f" -c default_transaction_isolation=" +
            _default_transaction_isolation.replace(' ', '\\ ') +
        f" -c idle_session_timeout=0"
        f" -c statement_timeout=5000"
    ),
)

_api_conninfo = psycopg.conninfo.make_conninfo(
    **(_coninfo_args | dict(dbname='duo_api'))
)

_Q_OLD_ANSWER = {
    table: f'SELECT answer FROM {table} '
           'WHERE person_id = %(person_id)s AND question_id = %(question_id)s'
    for table in CAPTURE_TABLES
}


def _int_param(params: psycopg.abc.Params | None, key: str) -> int | None:
    value = params.get(key) if isinstance(params, dict) else None
    return value if isinstance(value, int) else None


class TxCursor:
    def __init__(
        self,
        cur: psycopg.AsyncCursor[Row],
        suppress_stale_checks: bool = False,
    ) -> None:
        self._cur = cur
        self._stale: dict[str, set[int]] = {}
        self._answer_olds: dict[tuple[str, int, int], bool | None] = {}
        self._unattributed: set[str] = set()
        self._pending_harvest: frozenset[str] | None = None
        self._suppress_stale = suppress_stale_checks

    @property
    def connection(self) -> psycopg.AsyncConnection[Row]:
        return self._cur.connection

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def _expire_harvest(self) -> None:
        if self._pending_harvest is not None:
            self._unattributed |= self._pending_harvest
            self._pending_harvest = None

    async def _read_answer(
            self, table: str, person_id: int, question_id: int) -> bool | None:
        await self._cur.execute(
            _Q_OLD_ANSWER[table],
            dict(person_id=person_id, question_id=question_id))
        row = await self._cur.fetchone()
        if row is None or row['answer'] is None:
            return None
        return bool(row['answer'])

    async def _pre_note(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None,
    ) -> None:
        """A captured table is about to be written: read the old value so
        models can patch their derived sums instead of rebuilding them."""
        if self._suppress_stale or not isinstance(query, str):
            return
        person_id = _int_param(params, 'person_id')
        question_id = _int_param(params, 'question_id')
        if person_id is None or question_id is None:
            return
        for table in classify(query).capture_tables:
            key = (table, person_id, question_id)
            if key not in self._answer_olds:
                self._answer_olds[key] = await self._read_answer(
                        table, person_id, question_id)

    def _post_note(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None,
        rowcount_known: bool = True,
    ) -> None:
        if self._suppress_stale or not isinstance(query, str):
            return
        classified = classify(query)
        if not classified.models:
            return
        if (rowcount_known
                and classified.rowcount_reliable
                and self._cur.rowcount == 0):
            return
        person_id = _int_param(params, 'person_id')
        if classified.capture_tables and (
                person_id is None
                or _int_param(params, 'question_id') is None):
            self._unattributed |= classified.tables
            return
        if person_id is None:
            self._pending_harvest = classified.models
            return
        for name in classified.models:
            self._stale.setdefault(name, set()).add(person_id)

    def _harvest(self, rows: Iterable[Row]) -> None:
        """A watched write that could not name who it touched from its params
        reports through its own fetched rows instead: a `person_id` or
        `person_ids` column attributes it, even when NULL (an explicit
        nobody)."""
        if self._pending_harvest is None:
            return
        for row in rows:
            if 'person_id' not in row and 'person_ids' not in row:
                continue
            person_id = row.get('person_id')
            person_ids = row.get('person_ids')
            attributed = [person_id] if isinstance(person_id, int) else []
            attributed += (
                one for one in
                (person_ids if isinstance(person_ids, list) else [])
                if isinstance(one, int))
            for name in self._pending_harvest:
                self._stale.setdefault(name, set()).update(attributed)
            self._pending_harvest = None
            return

    async def _flush_stale(self) -> None:
        """Recompute whatever this transaction made stale, before it commits.
        Raises instead of committing when a watched write went unattributed:
        the fix is making the statement carry person_id (and question_id for
        captured tables) in its params, or report who it touched in its
        RETURNING rows."""
        self._expire_harvest()
        if self._suppress_stale:
            return
        if self._unattributed:
            raise StalenessError(
                f'matching-model inputs in {sorted(self._unattributed)} were '
                'written without a person to refresh; the statement must '
                'carry person_id (and question_id for captured tables) in '
                'its params, or return a person_id/person_ids column')
        if not self._stale and not self._answer_olds:
            return

        changes: dict[int, list[AnswerChange]] = {}
        for (table, person_id, question_id), old in self._answer_olds.items():
            new = await self._read_answer(table, person_id, question_id)
            if new == old:
                continue
            changes.setdefault(person_id, []).append(AnswerChange(
                table=table,
                question_id=question_id,
                old=old,
                new=new,
            ))

        for model in MODELS:
            for person_id in sorted(self._stale.get(model.name, ())):
                await model.person_changed(self, person_id, [
                    change for change in changes.get(person_id, [])
                    if change.table in model.watched])

    async def execute(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None = None,
    ) -> Tx:
        self._expire_harvest()
        await self._pre_note(query, params)
        await self._cur.execute(query, params)
        self._post_note(query, params)
        return self

    async def require_one(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None = None,
    ) -> Row:
        await self.execute(query, params)
        return require_row(await self.fetchone())

    async def executemany(
        self,
        query: CursorQuery,
        params_seq: Iterable[psycopg.abc.Params],
    ) -> None:
        self._expire_harvest()
        params_list = list(params_seq)
        await self._cur.executemany(query, params_list)
        for params in params_list:
            self._post_note(query, params, rowcount_known=False)

    async def fetchone(self) -> Row | None:
        row = await self._cur.fetchone()
        if row is not None:
            self._harvest([row])
        return row

    async def fetchall(self) -> list[Row]:
        rows = await self._cur.fetchall()
        self._harvest(rows)
        return rows

    async def close(self) -> None:
        await self._cur.close()



_ApiPool = AsyncConnectionPool[psycopg.AsyncConnection[Row]]


def _new_api_pool() -> _ApiPool:
    return AsyncConnectionPool(
        conninfo=_api_conninfo,
        connection_class=psycopg.AsyncConnection[Row],
        # Opening an async pool schedules background tasks on the running event
        # loop, which doesn't exist yet at import time; `open_db_pool()` opens it
        # from within each entrypoint's async lifespan/main.
        open=False,
        min_size=_pool_min_size,
        max_size=_pool_max_size,
        kwargs=dict(row_factory=psycopg.rows.dict_row),
        configure=_register_vector_types,
    )


async def _register_vector_types(conn: psycopg.AsyncConnection[Row]) -> None:
    await register_vector_async(conn)
    await conn.commit()


# A closed pool can't be reopened, so the pool is (re)constructed on each open
# rather than once at import. A server opens it once at startup; tests open and
# close it per case, each on its own event loop.
_api_pool: _ApiPool | None = None


def _pool() -> _ApiPool:
    if _api_pool is None:
        raise RuntimeError('db pool is not open; call open_db_pool() first')
    return _api_pool


async def open_db_pool() -> None:
    global _api_pool
    if _api_pool is None or _api_pool.closed:
        _api_pool = _new_api_pool()
    # `wait=True` blocks until `min_size` connections are established, so the
    # first query after startup doesn't pay a connection cost.
    await _api_pool.open(wait=True)


async def close_db_pool() -> None:
    await _pool().close()


@asynccontextmanager
async def api_tx(
    isolation_level: str = _default_transaction_isolation,
    suppress_stale_checks: bool = False,
) -> AsyncIterator[Tx]:
    """`suppress_stale_checks` is for schema migrations and bulk
    maintenance: nothing the transaction writes updates a matching vector,
    and the affected people are repaired with the models' backfills
    instead."""
    normalized_isolation_level = isolation_level.upper()

    if normalized_isolation_level not in _valid_isolation_levels:
        raise ValueError(isolation_level)

    async with _pool().connection() as conn, conn.cursor() as raw_cur:
        cur = TxCursor(raw_cur, suppress_stale_checks)
        if normalized_isolation_level != _default_transaction_isolation:
            await cur.execute(
                f'SET TRANSACTION ISOLATION LEVEL {normalized_isolation_level}'
            )
        yield cur
        await cur._flush_stale()


async def check_connections_forever() -> None:
    # Connections aren't validated at checkout, so on a low-traffic instance one
    # can sit idle long enough to be dropped by the network or server and then be
    # handed out dead. Periodically pinging the whole pool keeps connections warm
    # and heals any that died while idle.
    while True:
        # `except Exception` (not bare `except`) so that `CancelledError`, raised
        # when the entrypoint tears this task down, propagates and exits the loop.
        try:
            await _pool().check()
        except Exception:
            logger.exception('Pool check failed')
        await asyncio.sleep(random.randint(30, 90))


@asynccontextmanager
async def db_pool_lifespan() -> AsyncIterator[None]:
    await open_db_pool()
    check_task = asyncio.create_task(check_connections_forever())
    try:
        yield
    finally:
        check_task.cancel()
        # Wait for the cancellation to land so the checker can't touch the pool
        # after we close it below.
        with suppress(asyncio.CancelledError):
            await check_task
        await close_db_pool()
