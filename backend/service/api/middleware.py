"""Raw ASGI middleware for the API app.

These are raw ASGI middleware (not `BaseHTTPMiddleware`) so they see every
response -- including CORS preflights and error responses from exception
handlers -- and don't interfere with streaming.
"""

import os

from starlette.datastructures import MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

COMMIT_HASH = os.environ.get('DUO_COMMIT_HASH', 'unknown')
WORKER_ID = str(os.getpid())


class RequestEntityTooLarge(Exception):
    """Raised while streaming a request body once it exceeds
    `MAX_CONTENT_LENGTH`. Rendered to a plain-text 413 by its handler."""


class MaxBodySizeMiddleware:
    """Reject request bodies larger than `max_size`.

    The `Content-Length` header is only a hint: it can be absent (chunked
    transfer encoding), or a lie. So we also tally the bytes as they actually
    arrive and reject the request the moment the real total exceeds the limit,
    before the whole payload is buffered."""

    def __init__(self, app: ASGIApp, max_size: int) -> None:
        self.app = app
        self.max_size = max_size

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        # Cheap early rejection when the client honestly advertises an
        # oversized body, before we read a single chunk.
        for name, value in scope.get('headers', []):
            if name == b'content-length':
                try:
                    too_large = int(value) > self.max_size
                except ValueError:
                    too_large = False
                if too_large:
                    response = Response(
                        'Request entity too large', status_code=413)
                    await response(scope, receive, send)
                    return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message['type'] == 'http.request':
                received += len(message.get('body', b''))
                if received > self.max_size:
                    # Raised inside the endpoint's body read; propagates up to
                    # the RequestEntityTooLarge exception handler, which sends
                    # the 413.
                    raise RequestEntityTooLarge
            return message

        await self.app(scope, counting_receive, send)


class WorkerHeadersMiddleware:
    """Stamp every response with the serving worker's PID and the build's commit
    hash, so clients can tell which of the `--workers` processes handled a
    request and which build it's running."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope['type'] != 'http':
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message['type'] == 'http.response.start':
                headers = MutableHeaders(scope=message)
                headers['X-Duolicious-Worker'] = WORKER_ID
                headers['X-Duolicious-Commit'] = COMMIT_HASH
            await send(message)

        await self.app(scope, receive, send_with_headers)
