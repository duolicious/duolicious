import asyncio
import os
import psycopg
import random
import traceback
from types import TracebackType
from typing import Protocol
from collections.abc import Iterable
from database._row import (
    require_row,
    row_bool,
    row_int,
    row_str,
    row_str_list,
    row_str_or_none,
    row_value,
)

DB_HOST = os.environ['DUO_DB_HOST']
DB_PORT = os.environ['DUO_DB_PORT']
DB_USER = os.environ['DUO_DB_USER']
DB_PASS = os.environ['DUO_DB_PASS']

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

CursorQuery = str | bytes | psycopg.sql.SQL | psycopg.sql.Composed
Row = psycopg.rows.DictRow


class Tx(Protocol):
    @property
    def connection(self) -> psycopg.AsyncConnection[Row]:
        ...

    @property
    def rowcount(self) -> int:
        ...

    async def execute(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None = None,
    ) -> "Tx":
        ...

    async def require_one(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None = None,
    ) -> Row:
        ...

    async def executemany(
        self,
        query: CursorQuery,
        params_seq: Iterable[psycopg.abc.Params],
    ) -> None:
        ...

    async def fetchone(self) -> Row | None:
        ...

    async def fetchall(self) -> list[Row]:
        ...

    async def close(self) -> None:
        ...


class TxCursor:
    def __init__(self, cur: psycopg.AsyncCursor[Row]) -> None:
        self._cur = cur

    @property
    def connection(self) -> psycopg.AsyncConnection[Row]:
        return self._cur.connection

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    async def execute(
        self,
        query: CursorQuery,
        params: psycopg.abc.Params | None = None,
    ) -> Tx:
        await self._cur.execute(query, params)
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
        await self._cur.executemany(query, params_seq)

    async def fetchone(self) -> Row | None:
        return await self._cur.fetchone()

    async def fetchall(self) -> list[Row]:
        return await self._cur.fetchall()

    async def close(self) -> None:
        await self._cur.close()


_api_conn: psycopg.AsyncConnection[Row] | None = None

_api_conn_lock = asyncio.Lock()

class api_tx:
    def __init__(self, isolation_level: str = _default_transaction_isolation) -> None:
        normalized_isolation_level = isolation_level.upper()

        if normalized_isolation_level not in _valid_isolation_levels:
            raise ValueError(isolation_level)

        self.isolation_level = normalized_isolation_level

        self.conn: psycopg.AsyncConnection[Row]
        self.cur: Tx

    async def __aenter__(self) -> Tx:
        await _api_conn_lock.acquire()

        global _api_conn
        conn = _api_conn
        if conn is None or conn.closed:
            try:
                conn = await psycopg.AsyncConnection.connect(
                    conninfo=_api_conninfo,
                    row_factory=psycopg.rows.dict_row,
                )
                _api_conn = conn
            except:
                _api_conn_lock.release()
                print(traceback.format_exc())
                raise

        self.conn = conn
        self.cur = TxCursor(conn.cursor())

        if self.isolation_level != _default_transaction_isolation:
            try:
                await self.cur.execute(
                    f'SET TRANSACTION ISOLATION LEVEL {self.isolation_level}'
                )
            except:
                _api_conn_lock.release()
                print(traceback.format_exc())
                raise
        return self.cur

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        try:
            if exc_type is None:
                await self.conn.commit()
            else:
                await self.conn.rollback()
        except:
                traceback.print_exception(exc_type, exc_val, exc_tb)
        finally:
            try:
                await self.cur.close()
            except:
                print(traceback.format_exc())

        _api_conn_lock.release()

async def _check_api_connection_forever() -> None:
    while True:
        try:
            async with api_tx() as tx:
                await tx.execute('SELECT 1')
        except:
            print(traceback.format_exc())
        await asyncio.sleep(random.randint(30, 90))

async def check_connections_forever() -> None:
    await _check_api_connection_forever()
