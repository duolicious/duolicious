"""
Factory for the `redis.asyncio` client used across the API service.

Several modules (`sessioncache`, `rediscache`, `visitorspush`) each need their
own dedicated connection pool but want identical connection settings, so the
construction lives here rather than being copy-pasted three ways.

The timeouts are not optional. Every caller treats Redis as a best-effort
accelerator and swallows errors, degrading to a cache miss / no-op -- but that
fallback only works if a call actually *returns*. Without socket timeouts a
slow or unreachable Redis blocks the caller indefinitely, stalling every other
coroutine on the worker's event loop with it. Bounding both timeouts turns a
Redis stall into a fast, swallowed error.

This is intentionally separate from the chat service, which constructs its own
`redis.asyncio` clients.
"""


import redis.asyncio as async_redis

from serviceshared.duoenv.api import REDIS_HOST, REDIS_PORT


def make_redis_client() -> async_redis.Redis:
    """Return a dedicated async Redis client with bounded timeouts."""
    return async_redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
