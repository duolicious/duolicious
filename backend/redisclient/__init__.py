"""
Factory for the `redis.asyncio` client used by the async (FastAPI API / cron)
side of the codebase.

Several modules (`sessioncache`, `rediscache`, `visitorspush`) each need their
own dedicated connection pool but want identical connection settings, so the
construction lives here rather than being copy-pasted three ways.

The timeouts are not optional. Every caller treats Redis as a best-effort
accelerator and swallows errors, degrading to a cache miss / no-op -- but that
fallback only works if a call actually *returns*. Without socket timeouts a
slow or unreachable Redis blocks the caller indefinitely. `autodeactivate2`
awaits into Redis from inside the cron's single asyncio event loop, where one
unbounded call would stall *every* cron job. Bounding both timeouts turns a
Redis stall into a fast, swallowed error.

This is intentionally separate from the chat service, which constructs its own
`redis.asyncio` clients.
"""

import os

import redis.asyncio as async_redis

REDIS_HOST: str = os.environ.get("DUO_REDIS_HOST", "redis")
REDIS_PORT: int = int(os.environ.get("DUO_REDIS_PORT", 6379))


def make_redis_client() -> async_redis.Redis:
    """Return a dedicated async Redis client with bounded timeouts."""
    return async_redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )
