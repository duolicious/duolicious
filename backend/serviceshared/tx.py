import psycopg
from collections.abc import Iterable
from typing import Protocol

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

    def suppress_stale_checks(self) -> None:
        ...
