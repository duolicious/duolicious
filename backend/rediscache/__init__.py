"""
Generic Redis-backed result cache, exposed as the `redis_cache(ttl)` decorator.

Wrap any async function whose result is worth memoizing across requests/processes:

    @redis_cache(ttl=10 * 60)
    async def get_public_search():
        ...

The cache is keyed by the wrapped function's identity plus a stable hash of its
arguments, so different argument sets are cached separately. Results round-trip
through JSON, so a cache hit returns JSON-compatible types (e.g. a `uuid.UUID`
comes back as its string form) -- the same shape the API serializes into the
HTTP response anyway.

Like `sessioncache`, Redis is treated as a best-effort accelerator: any Redis
error -- or an argument/result that can't be encoded into a stable cache key --
degrades to simply calling the wrapped function, so callers keep working off the
database alone.
"""

import functools
import json
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Awaitable, Callable, ParamSpec, TypeVar

from duohash import sha512
from redisclient import make_redis_client

P = ParamSpec("P")
R = TypeVar("R")

_KEY_PREFIX = "cached_result:"

# Dedicated async client (see `redisclient.make_redis_client`): bounded timeouts
# so an unreachable or slow Redis turns into a fast, swallowed error rather than
# blocking the caller indefinitely.
_redis = make_redis_client()


def _default(o: object) -> str:
    """JSON encoder for the database types that show up in cached results,
    matching how the API's default JSON provider renders them."""
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, Decimal):
        return str(o)
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def _key(
    func: Callable[P, object],
    args: tuple[object, ...],
    kwargs: dict[str, object],
) -> str:
    arg_payload = json.dumps(
        [args, kwargs],
        default=_default,
        sort_keys=True,
        separators=(",", ":"),
    )
    return f"{_KEY_PREFIX}{func.__module__}.{func.__qualname__}:{sha512(arg_payload)}"


def redis_cache(ttl: int) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Cache the wrapped async function's result in Redis for `ttl` seconds."""
    def decorator(func: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            try:
                key = _key(func, args, kwargs)
            except TypeError:
                # Arguments don't encode into a stable key; skip the cache
                # rather than risk a collision serving the wrong result.
                return await func(*args, **kwargs)

            try:
                cached = await _redis.get(key)
            except Exception:
                cached = None

            if isinstance(cached, (str, bytes, bytearray)):
                try:
                    return json.loads(cached)
                except Exception:
                    pass

            result = await func(*args, **kwargs)

            try:
                await _redis.set(key, json.dumps(result, default=_default), ex=ttl)
            except Exception:
                pass

            return result

        return wrapper

    return decorator
