"""Route plumbing: the return convention and the opt-out default rate limit.

Endpoints are written as idiomatic `async def` FastAPI routes but keep a
plain-value return convention (dict/list -> JSON, str -> text/html,
`(body, status)`, None -> empty); `DuoRoute` wraps every route so handlers get
that convention -- and the global default rate limit -- for free.
"""

from collections.abc import Awaitable, Callable
from typing import ParamSpec

from fastapi import Depends, params
from fastapi.routing import APIRoute
from functools import wraps
from starlette.responses import Response

from service.api.ratelimit import default_rate_limit
from service.api.responses import make_response

_P = ParamSpec('_P')

# Endpoints opted out of the global default rate limit (see `rate_limit_exempt`).
# Membership is by function identity, checked in `DuoRoute.__init__`.
_rate_limit_exempt: set[object] = set()


def duo_route(
    func: Callable[_P, Awaitable[object]],
) -> Callable[_P, Awaitable[Response]]:
    """Adapt an async handler's plain return value into a `Response` via
    `make_response`. Returning a `Response` also makes FastAPI skip its
    `jsonable_encoder`, so serialization stays byte-for-byte under our control.
    `wraps` keeps the signature visible so FastAPI still resolves `Depends(...)`.

    Handlers must be `async def`. `DuoRoute` wraps every endpoint in this async
    wrapper, so FastAPI always sees a coroutine and never offloads to its
    threadpool -- a plain `def` handler would run its body on the event loop and
    block it."""
    @wraps(func)
    async def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> Response:
        return make_response(await func(*args, **kwargs))
    return wrapper


def rate_limit_exempt(func: Callable[_P, object]) -> Callable[_P, object]:
    """Opt a route out of the global default rate limit that `DuoRoute`
    otherwise applies to every endpoint (the FastAPI analogue of
    flask_limiter's `limiter.exempt`). Use only on handlers that must stay
    unthrottled (e.g. `GET /health`)."""
    _rate_limit_exempt.add(func)
    return func


class DuoRoute(APIRoute):
    """Route class that applies `duo_route` to every endpoint automatically, so
    handlers keep the plain-value return convention without repeating the
    decorator on each route.

    It also makes the per-endpoint default rate limit **opt-out** rather than
    opt-in: every route gets `default_rate_limit()` injected as a dependency
    (mirroring flask_limiter's `default_limits`), so a forgotten dependency
    can't silently leave an endpoint unthrottled. Mark a handler
    `@rate_limit_exempt` to skip it; endpoints needing extra or bespoke limits
    still declare those explicitly."""
    def __init__(
        self,
        path: str,
        endpoint: Callable[_P, Awaitable[object]],
        dependencies: list[params.Depends] | None = None,
        **kwargs: object,
    ) -> None:
        dependencies = list(dependencies or [])
        if endpoint not in _rate_limit_exempt:
            dependencies.append(Depends(default_rate_limit()))
        # `**kwargs: object` forwarded into APIRoute's precisely-typed __init__;
        # the alternative to this one ignore is spelling out all ~25 params.
        super().__init__(
            path, duo_route(endpoint),
            dependencies=dependencies, **kwargs)  # type: ignore[arg-type]
