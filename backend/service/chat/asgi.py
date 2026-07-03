"""The chat service's ASGI application.

Kept separate from `service.chat` (the package `__init__`) so that importing the
websocket handler doesn't construct an app as a side effect: `service.api` reuses
`process_websocket_messages` to serve its own `/chat` route, and pulling in a
whole second FastAPI app (plus its lifespan) just to borrow one handler is a
foot-gun. `service.chat.asgi:app` is the uvicorn entry point for the standalone
chat service.
"""

from fastapi import FastAPI

from service.chat import process_websocket_messages
from service.lifespan import app_lifespan

app = FastAPI(lifespan=app_lifespan)

app.add_api_websocket_route("/", process_websocket_messages)
