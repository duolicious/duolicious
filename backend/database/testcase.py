import unittest
from database import close_db_pool, open_db_pool


class DbTestCase(unittest.IsolatedAsyncioTestCase):
    """Base for async tests that reach the database through `api_tx`.

    `api_tx` checks a connection out of the pool, so the pool must be open. A
    psycopg pool is bound to the event loop that opened it, and
    `IsolatedAsyncioTestCase` runs each test method on its own fresh loop -- so
    the pool is opened and closed per test, on that test's loop, rather than once
    for the whole run.
    """

    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        await open_db_pool()
        self.addAsyncCleanup(close_db_pool)
