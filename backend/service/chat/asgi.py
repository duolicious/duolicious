"""The chat service's ASGI application.

Kept separate from `service.chat` (the package `__init__`) so that importing the
websocket handler doesn't construct an app as a side effect: `service.api` reuses
`process_websocket_messages` to serve its own `/chat` route, and pulling in a
whole second FastAPI app (plus its lifespan) just to borrow one handler is a
foot-gun. `service.chat.asgi:app` is the uvicorn entry point for the standalone
chat service.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from batcher import start_all
from database import db_pool_lifespan
from fastapi import FastAPI

from service.chat import process_websocket_messages


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Open the DB pool and run its keepalive checker for the app's lifetime, then
    # start the batch consumers on the running loop (they can't be started at
    # import time, before the loop exists).
    async with db_pool_lifespan():
        await start_all()
        yield


app = FastAPI(lifespan=lifespan)

app.add_api_websocket_route("/", process_websocket_messages)
