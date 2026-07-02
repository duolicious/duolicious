from collections.abc import Awaitable, Callable
from dataclasses import is_dataclass, asdict
from datetime import date, datetime, timezone
from decimal import Decimal
from email.utils import format_datetime
from typing import Literal, ParamSpec, cast, overload
from uuid import UUID
from database import api_tx, check_connections_forever
from duohash import sha512
import constants
import duotypes
import asyncio
import inspect
import os
from pathlib import Path
import ipaddress
import json
import time
import traceback

from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from pydantic import ValidationError

from limits import parse_many
from limits.storage import storage_from_string
from limits.aio.strategies import FixedWindowRateLimiter

from antiabuse.antispam.signupemail import normalize_email
from functools import lru_cache, wraps
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from batcher import start_all
import sessioncache

enable_mocking_file = (
    Path(__file__).parent.parent.parent /
    'test' /
    'input' /
    'enable-mocking')

disable_ip_rate_limit_file = (
    Path(__file__).parent.parent.parent /
    'test' /
    'input' /
    'disable-ip-rate-limit')

disable_account_rate_limit_file = (
    Path(__file__).parent.parent.parent /
    'test' /
    'input' /
    'disable-account-rate-limit')

mock_ip_address_file = (
    Path(__file__).parent.parent.parent /
    'test' /
    'input' /
    'mock-ip-address')

@lru_cache()
def _enable_mocking(ttl_hash: int | None = None) -> bool:
    if enable_mocking_file.is_file():
        with enable_mocking_file.open() as file:
            if file.read().strip() == '1':
                return True
    return False

def enable_mocking() -> bool:
    return _enable_mocking(ttl_hash=round(time.time()))

# `request` is accepted (and ignored) so these match the uniform
# `exempt_when(request)` signature the rate limiter calls them with.
def disable_ip_rate_limit(request: Request | None = None) -> bool:
    if not enable_mocking():
        return False

    if not disable_ip_rate_limit_file.is_file():
        return False

    with disable_ip_rate_limit_file.open() as file:
        if file.read().strip() == '1':
            return True

    return False

def disable_account_rate_limit(request: Request | None = None) -> bool:
    if not enable_mocking():
        return False

    if not disable_account_rate_limit_file.is_file():
        return False

    with disable_account_rate_limit_file.open() as file:
        if file.read().strip() == '1':
            return True

    return False

def mock_ip_address() -> str | None:
    if not enable_mocking():
        return None

    if not mock_ip_address_file.is_file():
        return None

    with mock_ip_address_file.open() as file:
        ip_address = file.read().strip()
        if ip_address:
            return ip_address

    return None

def client_ip(request: Request) -> str | None:
    """The requesting client's IP, honouring X-Forwarded-For with a single
    trusted hop (the right-most entry, matching the old werkzeug
    ProxyFix(x_for=1)), falling back to the socket peer. No mock override —
    this is the real address used for ban / firehol checks."""
    xff = request.headers.get('x-forwarded-for')
    if xff:
        parts = [p.strip() for p in xff.split(',') if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else None

def _is_private_ip(request: Request) -> bool:
    """
    Check if the requesting IP address is private.
    """
    if disable_ip_rate_limit():
        return True

    _remote_addr = mock_ip_address() or client_ip(request) or "127.0.0.1"

    try:
        return ipaddress.ip_address(_remote_addr).is_private
    except ValueError:
        return False

def _get_remote_address(request: Request) -> str:
    """
    :return: the ip address used for rate-limit keys for the current request
     (mock-aware, or 127.0.0.1 if none found)
    """
    return mock_ip_address() or client_ip(request) or "127.0.0.1"

CORS_ORIGINS = os.environ.get('DUO_CORS_ORIGINS', '*')
REDIS_HOST: str = os.environ.get("DUO_REDIS_HOST", "redis")
REDIS_PORT: int = int(os.environ.get("DUO_REDIS_PORT", 6379))


# ---------------------------------------------------------------------------
# Rate limiting
#
# flask_limiter has no FastAPI equivalent, so we reimplement the slice of its
# API the app uses directly on top of the `limits` library it wrapped: a
# fixed-window strategy over a Redis store. We use `limits`' async storage
# (the `async+redis://` scheme, backed by coredis) so `Limiter.check` awaits
# the Redis round-trip on the event loop instead of blocking. It's used inline
# (via the `rate_limit`/`default_rate_limit` dependencies) to enforce a limit.
# ---------------------------------------------------------------------------

class RateLimitExceeded(Exception):
    pass


LimitValue = str | Callable[[], str]
ScopeArg = str | Callable[[], str] | None
KeyFunc = Callable[[Request], str]
ExemptWhen = Callable[[Request], bool]


class Limiter:
    def __init__(
        self,
        key_func: KeyFunc,
        default_limits: list[str],
        storage_uri: str,
        default_limits_exempt_when: ExemptWhen,
    ) -> None:
        self._default_key_func = key_func
        self._default_limits = default_limits
        self._default_exempt_when = default_limits_exempt_when
        self._strategy = FixedWindowRateLimiter(storage_from_string(storage_uri))

    async def _enforce(
        self,
        request: Request,
        limit_value: LimitValue,
        scope: ScopeArg,
        key_func: KeyFunc | None,
        exempt_when: ExemptWhen | None,
    ) -> None:
        if exempt_when is not None and exempt_when(request):
            return

        value = limit_value() if callable(limit_value) else limit_value
        scope_str = scope() if callable(scope) else scope
        key = key_func(request) if key_func else _get_remote_address(request)

        for item in parse_many(value):
            if not await self._strategy.hit(item, scope_str or '', key):
                raise RateLimitExceeded()

    async def check(
        self,
        request: Request,
        limit_value: LimitValue,
        scope: ScopeArg = None,
        key_func: KeyFunc | None = None,
        exempt_when: ExemptWhen | None = None,
    ) -> None:
        """Inline rate-limit check used from within a handler (replaces the old
        `with limiter.limit(...):` blocks). Raises `RateLimitExceeded`."""
        await self._enforce(request, limit_value, scope, key_func, exempt_when)

    async def check_default(self, request: Request, endpoint_name: str) -> None:
        """Apply the global per-endpoint default limits, keyed on the remote
        address (flask_limiter applies these to every non-exempt view)."""
        if self._default_exempt_when is not None and self._default_exempt_when(request):
            return

        key = self._default_key_func(request)
        for value in self._default_limits:
            for item in parse_many(value):
                if not await self._strategy.hit(item, endpoint_name, key):
                    raise RateLimitExceeded()


default_limits = "60 per minute; 12 per second"

# Per-IP cap shared by every unauthenticated auth endpoint
# (/request-otp, /check-otp, /sign-in-with-*, /auth/apple/callback).
# Each endpoint scopes the bucket separately so they don't double-bill
# against the same allowance — change this string to retune them all
# at once.
auth_rate_limit = "40 per day"

limiter = Limiter(
    _get_remote_address,
    default_limits=[default_limits],
    storage_uri=f"async+redis://{REDIS_HOST}:{REDIS_PORT}",
    default_limits_exempt_when=_is_private_ip,
)

def limiter_account(request: Request) -> str:
    email = getattr(request.state, 'normalized_email', None)
    return email if isinstance(email, str) else _get_remote_address(request)


# ---------------------------------------------------------------------------
# ASGI app + middleware
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Start any registered batch consumers on the running loop and keep the DB
    # connection warm (the old sync `database` module started the keepalive on
    # import; the async module leaves that to the entrypoint).
    await start_all()
    connection_check_task = asyncio.create_task(check_connections_forever())
    try:
        yield
    finally:
        connection_check_task.cancel()


app = FastAPI(lifespan=lifespan)

# Disable Starlette's default 307 trailing-slash redirect (routes match their
# exact path only).
app.router.redirect_slashes = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS.split(','),
    allow_methods=['*'],
    allow_headers=['*'],
)


class RequestEntityTooLarge(Exception):
    """Raised while streaming a request body once it exceeds
    `MAX_CONTENT_LENGTH`. Rendered to a plain-text 413 by its handler."""


class MaxBodySizeMiddleware:
    """Enforce Flask's old `MAX_CONTENT_LENGTH`.

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
                    # the exception handler below, which sends the 413.
                    raise RequestEntityTooLarge
            return message

        await self.app(scope, counting_receive, send)


app.add_middleware(MaxBodySizeMiddleware, max_size=constants.MAX_CONTENT_LENGTH)


# ---------------------------------------------------------------------------
# Response normalisation
#
# Handlers return Flask-style values: dict/list (-> JSON), str (-> text/html),
# None (-> empty body), `(body, status)` tuples, or a Starlette `Response`
# (e.g. a RedirectResponse or a file download). We serialise JSON the way Flask's
# default provider did (Decimal/UUID -> str, dates -> HTTP-date, sorted keys,
# trailing newline) to keep responses byte-comparable for clients.
#
# JSON is pretty-printed (indent=2, the same shape as `jq`'s output, which the
# functionality test suite compares against). This is identical in dev and
# prod.
# ---------------------------------------------------------------------------

def _flask_json_default(o: object) -> object:
    if isinstance(o, datetime):
        if o.tzinfo is None:
            o = o.replace(tzinfo=timezone.utc)
        return format_datetime(o, usegmt=True)
    if isinstance(o, date):
        return format_datetime(
            datetime(o.year, o.month, o.day, tzinfo=timezone.utc), usegmt=True)
    if isinstance(o, (Decimal, UUID)):
        return str(o)
    if is_dataclass(o) and not isinstance(o, type):
        return asdict(o)
    if hasattr(o, '__html__'):
        return str(o.__html__())
    raise TypeError(
        f'Object of type {type(o).__name__} is not JSON serializable')


def _json_dumps(obj: object) -> str:
    body = json.dumps(
        obj,
        default=_flask_json_default,
        sort_keys=True,
        ensure_ascii=True,
        indent=2,
    )
    return body + '\n'


_HTML_MIME = 'text/html; charset=utf-8'


def _make_response(result: object) -> Response:
    status = 200

    if isinstance(result, tuple) and len(result) == 2:
        body, code = result
        result = body
        if isinstance(code, int):
            status = code

    if isinstance(result, Response):
        return result

    if result is None or isinstance(result, str):
        return Response(
            content=result or '', status_code=status, media_type=_HTML_MIME)

    if isinstance(result, bytes):
        return Response(
            content=result,
            status_code=status,
            media_type='application/octet-stream')

    return Response(
        content=_json_dumps(result),
        status_code=status,
        media_type='application/json',
    )


Q_GET_SESSION = """
SELECT
    duo_session.person_id,
    person.uuid::TEXT AS person_uuid,
    duo_session.email,
    duo_session.signed_in,
    duo_session.pending_club_name,
    EXTRACT(EPOCH FROM duo_session.session_expiry)::double precision
        AS session_expiry_epoch
FROM
    duo_session
LEFT JOIN
    person
ON
    duo_session.person_id = person.id
WHERE
    session_token_hash = %(session_token_hash)s
AND
    session_expiry > NOW()
"""


# ---------------------------------------------------------------------------
# FastAPI-native dispatch
#
# The building blocks for writing endpoints as idiomatic, `async def` FastAPI
# routes (see `GET /check-verification` in `service.api` for the reference
# example).
#
#   @app.get('/thing')
#   @duo_route
#   async def get_thing(
#       _limited: None = Depends(default_rate_limit('get_thing')),
#       s: duotypes.SessionInfo = Depends(session()),
#   ) -> object:
#       async with api_tx() as tx:
#           ...
#       return result            # plain value, same convention as manual handlers
# ---------------------------------------------------------------------------

_P = ParamSpec('_P')


def duo_route(func: Callable[_P, object]) -> Callable[_P, Awaitable[Response]]:
    """Let a native handler keep the manual handlers' return convention: it
    returns a plain value (dict/list -> JSON, str -> text/html, `(body,
    status)`, None -> empty) and this adapter runs it through the same
    `_make_response`. Returning a `Response` also makes FastAPI skip its
    `jsonable_encoder`, so serialization stays byte-for-byte identical to the
    manual dispatch. `wraps` keeps the signature visible so FastAPI still
    resolves `Depends(...)`. Handles sync or async handlers."""
    @wraps(func)
    async def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> Response:
        result = func(*args, **kwargs)
        if inspect.isawaitable(result):
            result = await cast(Awaitable[object], result)
        return _make_response(result)
    return wrapper


class DuoRoute(APIRoute):
    """Route class that applies `duo_route` to every endpoint automatically,
    so handlers keep the plain-value return convention without repeating the
    decorator on each route. `duo_route` uses `@wraps`, so FastAPI still sees
    the original signature (and route name) for dependency resolution."""
    def __init__(
        self,
        path: str,
        endpoint: Callable[_P, object],
        **kwargs: object,
    ) -> None:
        super().__init__(path, duo_route(endpoint), **kwargs)  # type: ignore[arg-type]


# Every route registered via `@app.<method>` now goes through `DuoRoute`.
app.router.route_class = DuoRoute


class AuthError(Exception):
    """Raised by `session` on missing/invalid auth. Rendered to the
    same plain-text bodies + status codes the manual chain returned (rather
    than FastAPI's default JSON `{"detail": ...}`)."""
    def __init__(self, message: str, status_code: int) -> None:
        self.message = message
        self.status_code = status_code


@app.exception_handler(AuthError)
async def _handle_auth_error(request: Request, exc: AuthError) -> Response:
    return _make_response((exc.message, exc.status_code))


@app.exception_handler(RequestEntityTooLarge)
async def _handle_too_large(
    request: Request, exc: RequestEntityTooLarge) -> Response:
    return _make_response(('Request entity too large', 413))


@app.exception_handler(RateLimitExceeded)
async def _handle_rate_limit(request: Request, exc: RateLimitExceeded) -> Response:
    # Only native routes reach here — the manual dispatch catches
    # RateLimitExceeded itself and renders its own 429.
    return _make_response(('Too Many Requests', 429))


@overload
def session(
    expected_onboarding_status: bool | None = ...,
    expected_sign_in_status: bool | None = ...,
    *,
    optional: Literal[False] = False,
) -> Callable[[Request], Awaitable[duotypes.SessionInfo]]: ...


@overload
def session(
    expected_onboarding_status: bool | None = ...,
    expected_sign_in_status: bool | None = ...,
    *,
    optional: Literal[True],
) -> Callable[[Request], Awaitable[duotypes.SessionInfo | None]]: ...


def session(
    expected_onboarding_status: bool | None = True,
    expected_sign_in_status: bool | None = True,
    *,
    optional: bool = False,
) -> Callable[[Request], Awaitable[duotypes.SessionInfo | None]]:
    """Async auth dependency factory. Resolves the bearer token to a
    `SessionInfo` (async sessioncache lookup, async DB fallback) and enforces
    the expected onboarding/sign-in status, raising `AuthError` otherwise.

    With `optional=True`, any `AuthError` (missing/malformed header, unknown
    session, or status mismatch) yields `None` instead of propagating — the
    overloads reflect this in the return type."""
    async def dependency(request: Request) -> duotypes.SessionInfo | None:
        try:
            auth_header = (request.headers.get('Authorization') or '').lower()
            try:
                bearer, session_token = auth_header.split()
                if bearer != 'bearer':
                    raise ValueError
            except Exception:
                raise AuthError('Missing or malformed authorization header', 400)

            session_token_hash = sha512(session_token)

            # sessioncache is a fast, best-effort async Redis get/set. The
            # session-row fallback uses the async DB.
            session_info = await sessioncache.get_session(session_token_hash)

            if session_info is None:
                async with api_tx('READ COMMITTED') as tx:
                    await tx.execute(
                        Q_GET_SESSION,
                        dict(session_token_hash=session_token_hash))
                    row = await tx.fetchone()
                if row:
                    session_info = duotypes.SessionInfo(
                        email=row['email'],
                        person_id=row['person_id'],
                        person_uuid=row['person_uuid'],
                        signed_in=row['signed_in'],
                        session_token_hash=session_token_hash,
                        pending_club_name=row['pending_club_name'],
                    )
                    await sessioncache.put_session(
                        session_info,
                        row['session_expiry_epoch'])

            if session_info is None:
                raise AuthError('Invalid session token', 401)

            is_onboarded = session_info.person_id is not None
            ok_onboarding = (
                expected_onboarding_status is None
                or expected_onboarding_status == is_onboarded)
            ok_sign_in = (
                expected_sign_in_status is None
                or expected_sign_in_status == session_info.signed_in)
            if not (ok_onboarding and ok_sign_in):
                raise AuthError('Unauthorized', 401)

            # Set for account-scoped rate limiting (see `limiter_account`), so
            # an account-keyed limit can compose as another dependency.
            request.state.normalized_email = normalize_email(session_info.email)
            return session_info
        except AuthError:
            if optional:
                return None
            raise

    return dependency


def default_rate_limit(
    endpoint_name: str | None = None,
) -> Callable[[Request], Awaitable[None]]:
    """The global per-endpoint default limit, as a dependency. The limiter is
    async (backed by `limits.aio` over Redis), so its check is awaited directly.

    `endpoint_name` scopes the limit's bucket; when omitted it defaults to the
    matched route's name (the handler function's name), which is what every
    call site passed by hand before."""
    async def dependency(request: Request) -> None:
        name = endpoint_name or request.scope['route'].name
        await limiter.check_default(request, name)
    return dependency


def rate_limit(
    limit_value: LimitValue,
    scope: ScopeArg = None,
    key_func: KeyFunc | None = None,
    exempt_when: ExemptWhen | None = None,
) -> Callable[[Request], Awaitable[None]]:
    """A limiter.check(...) dependency for native FastAPI routes."""
    async def dependency(request: Request) -> None:
        await limiter.check(
            request,
            limit_value,
            scope,
            key_func,
            exempt_when,
        )
    return dependency


shared_otp_limit_dependency = rate_limit(
    "3 per minute",
    scope="otp",
    exempt_when=_is_private_ip,
)

