import unittest
from typing import Any

from fastapi import FastAPI
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import Message

from service.api.decorators import (
    MaxBodySizeMiddleware,
    RequestEntityTooLarge,
    _handle_too_large,
)

MAX_SIZE = 10


def make_app() -> FastAPI:
    """A minimal app wired with the real middleware + real 413 handler, plus a
    route that actually reads the body (so the streaming byte count runs)."""
    app = FastAPI()
    app.add_exception_handler(RequestEntityTooLarge, _handle_too_large)

    @app.post('/echo')
    async def echo(request: Request) -> Response:
        body = await request.body()
        return Response(str(len(body)))

    # Added last so it wraps outermost, matching production.
    app.add_middleware(MaxBodySizeMiddleware, max_size=MAX_SIZE)
    return app


async def call(
    app: FastAPI,
    body_chunks: list[bytes],
    headers: list[tuple[bytes, bytes]] | None = None,
) -> tuple[int, bytes]:
    """Drive `app` as a raw ASGI app. Sending the body as multiple
    `http.request` chunks with no `content-length` header mimics HTTP chunked
    transfer encoding, which the old header-only check couldn't police."""
    scope: dict[str, Any] = {
        'type': 'http',
        'http_version': '1.1',
        'method': 'POST',
        'path': '/echo',
        'raw_path': b'/echo',
        'query_string': b'',
        'headers': headers or [],
        'scheme': 'http',
        'server': ('testserver', 80),
        'client': ('testclient', 12345),
    }

    messages: list[Message] = [
        {
            'type': 'http.request',
            'body': chunk,
            'more_body': i < len(body_chunks) - 1,
        }
        for i, chunk in enumerate(body_chunks)
    ]
    pending = iter(messages)

    async def receive() -> Message:
        return next(pending, {'type': 'http.disconnect'})

    sent: list[Message] = []

    async def send(message: Message) -> None:
        sent.append(message)

    await app(scope, receive, send)

    status = next(m['status'] for m in sent if m['type'] == 'http.response.start')
    body = b''.join(
        m.get('body', b'') for m in sent if m['type'] == 'http.response.body')
    return status, body


class Test(unittest.IsolatedAsyncioTestCase):
    async def test_under_limit_ok(self) -> None:
        # Split across chunks but summing to the limit exactly: allowed.
        status, body = await call(make_app(), [b'12345', b'67890'])
        self.assertEqual(status, 200)
        self.assertEqual(body, b'10')

    async def test_chunked_over_limit_rejected(self) -> None:
        # No content-length header (chunked transfer); real bytes exceed the
        # limit. The old header-only check let this through.
        status, _ = await call(make_app(), [b'123456', b'7890AB'])
        self.assertEqual(status, 413)

    async def test_lying_content_length_rejected(self) -> None:
        # Header understates the body; the streamed count still catches it.
        status, _ = await call(
            make_app(),
            [b'123456', b'7890AB'],
            headers=[(b'content-length', b'2')])
        self.assertEqual(status, 413)

    async def test_honest_oversized_content_length_rejected_early(self) -> None:
        # Honest oversized header: rejected before any chunk is read.
        status, _ = await call(
            make_app(),
            [b'x'],
            headers=[(b'content-length', b'999')])
        self.assertEqual(status, 413)


if __name__ == '__main__':
    unittest.main()
