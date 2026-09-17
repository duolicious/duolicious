"""
Generic Redis-backed result cache, exposed as the `redis_cache(ttl)` decorator.

Wrap any async function whose result is worth memoizing across requests/processes:

    @redis_cache(ttl=60)
    async def get_public_search():
        ...
"""

import asyncio
import functools
import json
import logging
import uuid
from contextlib import suppress
from datetime import date, datetime
from decimal import Decimal
from typing import Awaitable, Callable, Coroutine, ParamSpec, TypeVar

from service.api.duohash import sha512
from service.api.redisclient import make_redis_client

logger = logging.getLogger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

_KEY_PREFIX = "cached_result:"

_LOCK_SECONDS = 5

_POLL_SECONDS = 1

# Dedicated async client (see `redisclient.make_redis_client`): bounded timeouts
# so an unreachable or slow Redis turns into a fast, swallowed error rather than
# blocking the caller indefinitely.
_redis = make_redis_client()

_refreshes: set[asyncio.Task[None]] = set()


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


async def _may_compute(lock_key: str) -> bool:
    try:
        return bool(await _redis.set(lock_key, "1", nx=True, ex=_LOCK_SECONDS))
    except Exception:
        return True


def _spawn(refresh: Coroutine[object, object, None]) -> None:
    task = asyncio.create_task(refresh)
    _refreshes.add(task)
    task.add_done_callback(_refreshes.discard)


def redis_cache(ttl: int) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Serve the wrapped async function's result from Redis, recomputing it in
    the background once it is older than `ttl` seconds."""
    def decorator(func: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        async def read(key: str) -> tuple[R, bool] | None:
            with suppress(Exception):
                value, fresh = await _redis.mget(key, f"{key}:fresh")
                if value is not None:
                    return json.loads(value), fresh is not None
            return None

        async def compute(key: str, *args: P.args, **kwargs: P.kwargs) -> R:
            result = await func(*args, **kwargs)
            with suppress(Exception):
                async with _redis.pipeline() as pipe:
                    pipe.set(key, json.dumps(result, default=_default), ex=ttl * 2)
                    pipe.set(f"{key}:fresh", "1", ex=ttl)
                    await pipe.execute()
            return result

        async def refresh(key: str, *args: P.args, **kwargs: P.kwargs) -> None:
            try:
                await compute(key, *args, **kwargs)
            except Exception:
                logger.exception("Background refresh of %s failed", func.__qualname__)

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            try:
                key = _key(func, args, kwargs)
            except TypeError:
                # Arguments don't encode into a stable key; skip the cache
                # rather than risk a collision serving the wrong result.
                return await func(*args, **kwargs)

            lock_key = f"{key}:lock"

            while (cached := await read(key)) is None:
                if await _may_compute(lock_key):
                    return await compute(key, *args, **kwargs)
                await asyncio.sleep(_POLL_SECONDS)

            result, fresh = cached
            if not fresh and await _may_compute(lock_key):
                _spawn(refresh(key, *args, **kwargs))
            return result

        return wrapper

    return decorator
