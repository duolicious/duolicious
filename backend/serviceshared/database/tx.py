import psycopg
from collections.abc import Iterable
from typing import Protocol

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
        query: str,
        params: psycopg.abc.Params | None = None,
    ) -> "Tx":
        ...

    async def require_one(
        self,
        query: str,
        params: psycopg.abc.Params | None = None,
    ) -> Row:
        ...

    async def executemany(
        self,
        query: str,
        params_seq: Iterable[psycopg.abc.Params],
    ) -> None:
        ...

    async def fetchone(self) -> Row | None:
        ...

    async def fetchall(self) -> list[Row]:
        ...

    async def close(self) -> None:
        ...
