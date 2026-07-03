"""Route plumbing: the return convention and the opt-out default rate limit.

Endpoints are written as idiomatic `async def` FastAPI routes but keep a
plain-value return convention (dict/list -> JSON, str -> text/html,
`(body, status)`, None -> empty); `DuoRoute` wraps every route so handlers get
that convention -- and the global default rate limit -- for free.
"""

import inspect
from collections.abc import Awaitable, Callable
from typing import ParamSpec, cast

from fastapi import Depends
from fastapi.routing import APIRoute
from functools import wraps
from starlette.responses import Response

from service.api.ratelimit import default_rate_limit
from service.api.responses import make_response

_P = ParamSpec('_P')


def duo_route(func: Callable[_P, object]) -> Callable[_P, Awaitable[Response]]:
    """Adapt a handler's plain return value into a `Response` via
    `make_response`. Returning a `Response` also makes FastAPI skip its
    `jsonable_encoder`, so serialization stays byte-for-byte under our control.
    `wraps` keeps the signature visible so FastAPI still resolves `Depends(...)`.
    Handles sync or async handlers."""
    @wraps(func)
    async def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> Response:
        result = func(*args, **kwargs)
        if inspect.isawaitable(result):
            result = await result
        return make_response(result)
    return wrapper


def rate_limit_exempt(func: Callable[_P, object]) -> Callable[_P, object]:
    """Opt a route out of the global default rate limit that `DuoRoute`
    otherwise applies to every endpoint (the FastAPI analogue of
    flask_limiter's `limiter.exempt`). Use only on handlers that must stay
    unthrottled (e.g. `GET /health`)."""
    func._rate_limit_exempt = True  # type: ignore[attr-defined]
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
        endpoint: Callable[_P, object],
        **kwargs: object,
    ) -> None:
        if not getattr(endpoint, '_rate_limit_exempt', False):
            dependencies = list(cast(
                'list[object]', kwargs.get('dependencies') or []))
            dependencies.append(Depends(default_rate_limit()))
            kwargs['dependencies'] = dependencies
        super().__init__(path, duo_route(endpoint), **kwargs)  # type: ignore[arg-type]
