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
from serviceshared.database.triggers import Tracker
from serviceshared.database.tx import Row, Tx

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

class TxCursor:
    def __init__(self, cur: psycopg.AsyncCursor[Row]) -> None:
        self._cur = cur
        self._triggers = Tracker(cur)

    @property
    def connection(self) -> psycopg.AsyncConnection[Row]:
        return self._cur.connection

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    async def execute(
        self,
        query: str,
        params: psycopg.abc.Params | None = None,
    ) -> Tx:
        await self._triggers.note_before(query, params)
        await self._cur.execute(query, params)
        self._triggers.note_after(query, params, self._cur.rowcount)
        return self

    async def require_one(
        self,
        query: str,
        params: psycopg.abc.Params | None = None,
    ) -> Row:
        await self.execute(query, params)
        return require_row(await self.fetchone())

    async def executemany(
        self,
        query: str,
        params_seq: Iterable[psycopg.abc.Params],
    ) -> None:
        params_list = list(params_seq)
        for params in params_list:
            await self._triggers.note_before(query, params)
        await self._cur.executemany(query, params_list)
        for params in params_list:
            self._triggers.note_after(query, params, None)

    async def fetchone(self) -> Row | None:
        return await self._cur.fetchone()

    async def fetchall(self) -> list[Row]:
        return await self._cur.fetchall()

    def attribute(self, subjects: Iterable[int]) -> None:
        self._triggers.attribute(subjects)

    async def flush_triggers(self) -> None:
        await self._triggers.flush(self)

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
) -> AsyncIterator[Tx]:
    normalized_isolation_level = isolation_level.upper()

    if normalized_isolation_level not in _valid_isolation_levels:
        raise ValueError(isolation_level)

    async with _pool().connection() as conn, conn.cursor() as raw_cur:
        cur = TxCursor(raw_cur)
        if normalized_isolation_level != _default_transaction_isolation:
            await cur.execute(
                f'SET TRANSACTION ISOLATION LEVEL {normalized_isolation_level}'
            )
        yield cur
        await cur.flush_triggers()


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
