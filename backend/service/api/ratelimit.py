"""Rate limiting for the API.

flask_limiter has no FastAPI equivalent, so we reimplement the slice of its API
the app uses directly on top of the `limits` library it wrapped: a fixed-window
strategy over Redis. We use `limits`' async storage (the `async+redis://`
scheme, backed by coredis) so `Limiter.hit` awaits the Redis round-trip on the
event loop instead of blocking. Limits are enforced as route dependencies (see
the factories below) or inline from a handler (`check`, `check_ip_and_account`).

Every limit string the app enforces is named as a policy constant here, so the
values can be retuned in one place rather than hunting literals in the routes.
"""

import ipaddress
from collections.abc import Awaitable, Callable

from limits import parse_many
from limits.aio.strategies import FixedWindowRateLimiter
from limits.storage import storage_from_string
from starlette.requests import HTTPConnection, Request

from serviceshared.antiabuse.antispam.signupemail import normalize_email
from service.api.mocking import (
    disable_account_rate_limit,
    disable_ip_rate_limit,
    mock_ip_address,
)

from serviceshared.duoenv.api import REDIS_HOST, REDIS_PORT


# ---------------------------------------------------------------------------
# Request address helpers
# ---------------------------------------------------------------------------

def client_ip(request: HTTPConnection) -> str | None:
    """The requesting client's IP, honouring X-Forwarded-For with a single
    trusted hop (the right-most entry, matching the old werkzeug
    ProxyFix(x_for=1)), falling back to the socket peer. No mock override --
    this is the real address used for ban / firehol checks. Accepts websockets
    too (`HTTPConnection` is the base of both `Request` and `WebSocket`)."""
    xff = request.headers.get('x-forwarded-for')
    if xff:
        parts = [p.strip() for p in xff.split(',') if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else None


def _is_private_ip(request: HTTPConnection) -> bool:
    """Whether the requesting IP is private (and so exempt from the default
    per-endpoint limits)."""
    if disable_ip_rate_limit():
        return True

    remote_addr = mock_ip_address() or client_ip(request) or "127.0.0.1"
    try:
        return ipaddress.ip_address(remote_addr).is_private
    except ValueError:
        return False


def _get_remote_address(request: HTTPConnection) -> str:
    """The IP used for rate-limit keys (mock-aware, 127.0.0.1 if none found)."""
    return mock_ip_address() or client_ip(request) or "127.0.0.1"


# ---------------------------------------------------------------------------
# Limiter
# ---------------------------------------------------------------------------

class RateLimitExceeded(Exception):
    pass


LimitValue = str | Callable[[], str]
ScopeArg = str | Callable[[], str] | None
KeyFunc = Callable[[HTTPConnection], str]
ExemptWhen = Callable[[HTTPConnection], bool]


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

    async def check(
        self,
        request: HTTPConnection,
        limit_value: LimitValue,
        scope: ScopeArg = None,
        key_func: KeyFunc | None = None,
        exempt_when: ExemptWhen | None = None,
    ) -> None:
        """Enforce `limit_value`, raising `RateLimitExceeded` if the bucket is
        spent."""
        if exempt_when is not None and exempt_when(request):
            return

        value = limit_value() if callable(limit_value) else limit_value
        scope_str = scope() if callable(scope) else scope
        key = key_func(request) if key_func else _get_remote_address(request)

        for item in parse_many(value):
            if not await self._strategy.hit(item, scope_str or '', key):
                raise RateLimitExceeded()

    async def check_default(self, request: Request, endpoint_name: str) -> None:
        """Apply the global per-endpoint default limits, keyed on the remote
        address."""
        if self._default_exempt_when(request):
            return

        key = self._default_key_func(request)
        for value in self._default_limits:
            for item in parse_many(value):
                if not await self._strategy.hit(item, endpoint_name, key):
                    raise RateLimitExceeded()


# ---------------------------------------------------------------------------
# Policies
# ---------------------------------------------------------------------------

default_limits = "60 per minute; 12 per second"

# Cap shared by every auth endpoint (/request-otp, /resend-otp, /check-otp,
# /sign-in-with-*, /auth/apple/callback), enforced per-IP everywhere and
# additionally per-email (OTP sends) or per-account (/check-otp), so rotating
# IPs can't mint unlimited OTP emails for one address. Each endpoint scopes
# its buckets separately so they don't double-bill against the same
# allowance -- change this string to retune them all at once.
auth_rate_limit = "3 per minute; 40 per day"

# Per (search-type, club) cap on uncached /search queries.
search_rate_limit = "15 per 2 minutes"

# Cap on lodging a report via /skip (enforced only when a reason is given).
report_rate_limit = "1 per 5 seconds; 20 per day"

# Cap on /verify submissions, keyed per-IP and per-account.
verify_rate_limit = "8 per day"

# Cap on minting a data-export token (/export-data-token), per-IP and
# per-account.
export_data_rate_limit = "3 per day"

# Per-IP cap on /chat websocket connection attempts. A healthy client holds
# one connection, so this is generous even for NAT-shared addresses, but it
# stops a flapping client from reconnecting once a second indefinitely.
chat_connect_rate_limit = "20 per minute"

limiter = Limiter(
    _get_remote_address,
    default_limits=[default_limits],
    storage_uri=f"async+redis://{REDIS_HOST}:{REDIS_PORT}",
    default_limits_exempt_when=_is_private_ip,
)


def limiter_account(request: HTTPConnection) -> str:
    email = getattr(request.state, 'normalized_email', None)
    return email if isinstance(email, str) else _get_remote_address(request)


# ---------------------------------------------------------------------------
# Dependency factories
# ---------------------------------------------------------------------------

def default_rate_limit(
    endpoint_name: str | None = None,
) -> Callable[[Request], Awaitable[None]]:
    """The global per-endpoint default limit, as a dependency. `DuoRoute`
    injects this into every route (see `service.api.routing`).

    `endpoint_name` scopes the limit's bucket; when omitted it defaults to the
    matched route's name (the handler function's name)."""
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
    """A `limiter.check(...)` call as a route dependency."""
    async def dependency(request: Request) -> None:
        await limiter.check(request, limit_value, scope, key_func, exempt_when)
    return dependency


async def check_ip_and_account(
    request: Request,
    limit_value: LimitValue,
    scope: ScopeArg = None,
) -> None:
    """Enforce `limit_value` twice for the current request: once keyed on the
    client IP and once on the authenticated account, each honouring its own
    mock-mode disable toggle. Called inline from handlers that rate-limit only
    some requests (uncached searches, reports)."""
    await limiter.check(
        request, limit_value, scope=scope, exempt_when=disable_ip_rate_limit)
    await limiter.check(
        request, limit_value, scope=scope,
        key_func=limiter_account, exempt_when=disable_account_rate_limit)


async def check_otp_send_limits(request: Request, email: str) -> None:
    """Enforce `auth_rate_limit` twice for an OTP send: once keyed on the
    client IP and once on the normalized email. `/request-otp` and
    `/resend-otp` call this inline (with the email from the request body or
    session respectively) since the email key can't compose as a dependency:
    `limiter_account` is only populated for authenticated requests."""
    await limiter.check(
        request,
        auth_rate_limit,
        scope='otp',
        exempt_when=_is_private_ip,
    )
    await limiter.check(
        request,
        auth_rate_limit,
        scope='otp_email',
        key_func=lambda _: normalize_email(email),
        exempt_when=disable_account_rate_limit,
    )


async def check_chat_connect_limit(websocket: HTTPConnection) -> None:
    """Enforce `chat_connect_rate_limit` for a websocket handshake, keyed on
    the client IP. Called before the connection is accepted."""
    await limiter.check(
        websocket,
        chat_connect_rate_limit,
        scope='chat_connect',
        exempt_when=_is_private_ip,
    )


def ip_rate_limit(
    limit_value: LimitValue,
    scope: ScopeArg = None,
) -> Callable[[Request], Awaitable[None]]:
    """Per-IP limit dependency with the standard mock-mode disable toggle, for
    the unauthenticated auth endpoints."""
    return rate_limit(limit_value, scope=scope, exempt_when=disable_ip_rate_limit)


def account_rate_limit(
    limit_value: LimitValue,
    scope: ScopeArg = None,
) -> Callable[[Request], Awaitable[None]]:
    """Per-account limit dependency with the standard mock-mode disable
    toggle."""
    return rate_limit(
        limit_value, scope=scope,
        key_func=limiter_account, exempt_when=disable_account_rate_limit)


def ip_and_account_rate_limit(
    limit_value: LimitValue,
    scope: ScopeArg = None,
) -> Callable[[Request], Awaitable[None]]:
    """`check_ip_and_account` as a route dependency, for endpoints that always
    apply the IP+account pair (rather than conditionally, inline)."""
    async def dependency(request: Request) -> None:
        await check_ip_and_account(request, limit_value, scope)
    return dependency
