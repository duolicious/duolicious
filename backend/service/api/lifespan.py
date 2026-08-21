"""ASGI lifespan for the API app (which also serves the `/chat` WebSocket).

Startup/shutdown: open the DB pool (and its keepalive checker) for the app's
lifetime, then start the registered batch consumers on the running loop. The
consumers can't be started at import time, before the loop exists.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from serviceshared.batcher import start_all
from serviceshared.database import db_pool_lifespan
from fastapi import FastAPI


@asynccontextmanager
async def app_lifespan(app: FastAPI) -> AsyncIterator[None]:
    async with db_pool_lifespan():
        await start_all()
        yield
