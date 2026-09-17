import asyncio
import unittest
import uuid
from decimal import Decimal
from unittest.mock import patch

from service.api.search import rediscache
from service.api.search.rediscache import redis_cache


class FakeRedis:
    """In-memory stand-in for the async redis client used by rediscache."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.expirations: dict[str, int] = {}

    async def mget(self, *keys: str) -> list[str | None]:
        return [self.store.get(key) for key in keys]

    async def set(self, key: str, value: str, ex: int, nx: bool = False) -> bool | None:
        if nx and key in self.store:
            return None
        self.store[key] = value
        self.expirations[key] = ex
        return True

    def pipeline(self) -> "FakePipeline":
        return FakePipeline(self)

    def expire(self, suffix: str) -> None:
        for key in [k for k in self.store if k.endswith(suffix)]:
            del self.store[key]
            del self.expirations[key]


class ExplodingRedis:
    """Stand-in whose every operation raises, like an unreachable Redis."""

    async def mget(self, *keys: str) -> None:
        raise ConnectionError("redis down")

    async def set(self, key: str, value: str, ex: int, nx: bool = False) -> None:
        raise ConnectionError("redis down")

    def pipeline(self) -> "FakePipeline":
        return FakePipeline(self)


class FakePipeline:
    def __init__(self, redis: FakeRedis | ExplodingRedis) -> None:
        self.redis = redis
        self.commands: list[tuple[str, str, int]] = []

    def set(self, key: str, value: str, ex: int) -> None:
        self.commands.append((key, value, ex))

    async def execute(self) -> None:
        for key, value, ex in self.commands:
            await self.redis.set(key, value, ex)

    async def __aenter__(self) -> "FakePipeline":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None


class TestRedisCache(unittest.IsolatedAsyncioTestCase):

    def setUp(self) -> None:
        self.fake = FakeRedis()
        for name, value in [("_redis", self.fake), ("_POLL_SECONDS", 0.01)]:
            patcher = patch.object(rediscache, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def refreshes_done(self) -> None:
        await asyncio.gather(*rediscache._refreshes)

    async def test_caches_result(self) -> None:
        call_count = 0

        @redis_cache(ttl=600, stale=6000)
        async def fetch() -> dict[str, int]:
            nonlocal call_count
            call_count += 1
            return {"value": call_count}

        self.assertEqual(await fetch(), {"value": 1})  # miss
        self.assertEqual(await fetch(), {"value": 1})  # hit, not recomputed
        self.assertEqual(call_count, 1)

    async def test_distinct_args_cached_separately(self) -> None:
        call_count = 0

        @redis_cache(ttl=600, stale=6000)
        async def fetch(x: int, y: int = 0) -> int:
            nonlocal call_count
            call_count += 1
            return x + y

        self.assertEqual(await fetch(1), 1)        # miss
        self.assertEqual(await fetch(1), 1)        # hit
        self.assertEqual(await fetch(2), 2)        # miss (different positional)
        self.assertEqual(await fetch(1, y=5), 6)   # miss (different kwarg)
        self.assertEqual(await fetch(1, y=5), 6)   # hit
        self.assertEqual(call_count, 3)

    async def test_expirations_passed_to_redis(self) -> None:
        async def fetch() -> str:
            return "x"

        await redis_cache(ttl=600, stale=6000)(fetch)()
        key = rediscache._key(fetch, (), {})
        self.assertEqual(
            self.fake.expirations,
            {key: 6600, f"{key}:fresh": 600, f"{key}:lock": 5},
        )

    async def test_stale_hit_is_served_while_refreshed_once_in_background(self) -> None:
        call_count = 0

        @redis_cache(ttl=600, stale=6000)
        async def fetch() -> int:
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.01)
            return call_count

        self.assertEqual(await fetch(), 1)
        self.fake.expire(":fresh")
        self.fake.expire(":lock")

        self.assertEqual(await asyncio.gather(*[fetch() for _ in range(5)]), [1] * 5)

        await self.refreshes_done()
        self.assertEqual(call_count, 2)
        self.assertEqual(await fetch(), 2)
        self.assertEqual(call_count, 2)

    async def test_failed_background_refresh_is_logged_and_stale_still_served(self) -> None:
        call_count = 0

        @redis_cache(ttl=600, stale=6000)
        async def fetch() -> int:
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise ValueError()
            return call_count

        self.assertEqual(await fetch(), 1)
        self.fake.expire(":fresh")
        self.fake.expire(":lock")

        with self.assertLogs(rediscache.logger, level="ERROR"):
            self.assertEqual(await fetch(), 1)
            await self.refreshes_done()
        self.assertEqual(await fetch(), 1)
        self.assertEqual(call_count, 2)

    async def test_cold_misses_across_workers_share_one_call(self) -> None:
        call_count = 0

        async def fetch() -> dict[str, int]:
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.05)
            return {"value": call_count}

        worker_a = redis_cache(ttl=600, stale=6000)(fetch)
        worker_b = redis_cache(ttl=600, stale=6000)(fetch)

        self.assertEqual(
            await asyncio.gather(*[worker_a() for _ in range(5)], *[worker_b() for _ in range(5)]),
            [{"value": 1}] * 10,
        )
        self.assertEqual(call_count, 1)

    async def test_cold_waiter_computes_once_abandoned_lock_expires(self) -> None:
        call_count = 0

        async def fetch() -> int:
            nonlocal call_count
            call_count += 1
            return call_count

        await self.fake.set(f"{rediscache._key(fetch, (), {})}:lock", "1", ex=5)

        waiter = asyncio.ensure_future(redis_cache(ttl=600, stale=6000)(fetch)())
        await asyncio.sleep(0.05)
        self.assertEqual(call_count, 0)

        self.fake.expire(":lock")
        self.assertEqual(await waiter, 1)

    async def test_failed_cold_call_raises_and_caches_nothing(self) -> None:
        @redis_cache(ttl=600, stale=6000)
        async def fetch() -> int:
            raise ValueError()

        with self.assertRaises(ValueError):
            await fetch()
        self.assertEqual(list(self.fake.expirations.values()), [5])

    async def test_serializes_db_types(self) -> None:
        u = uuid.uuid4()

        @redis_cache(ttl=600, stale=6000)
        async def fetch() -> list[dict[str, uuid.UUID | Decimal | str]]:
            return [{"prospect_uuid": u, "age": Decimal("27"), "name": "Bob"}]

        # First call computes the real result.
        self.assertEqual(
            await fetch(),
            [{"prospect_uuid": u, "age": Decimal("27"), "name": "Bob"}],
        )
        # Cache hit returns the JSON-compatible round-trip (UUID/Decimal as str),
        # which is the same shape the API serializes into the response.
        self.assertEqual(
            await fetch(),
            [{"prospect_uuid": str(u), "age": "27", "name": "Bob"}],
        )

    async def test_redis_errors_degrade_to_calling_function(self) -> None:
        call_count = 0

        @redis_cache(ttl=600, stale=6000)
        async def fetch() -> int:
            nonlocal call_count
            call_count += 1
            return call_count

        with patch.object(rediscache, "_redis", ExplodingRedis()):
            self.assertEqual(await fetch(), 1)  # mget raises -> miss; set raises -> swallowed
            self.assertEqual(await fetch(), 2)  # still uncached, recomputed
        self.assertEqual(call_count, 2)

    async def test_unserializable_arg_skips_cache(self) -> None:
        call_count = 0

        @redis_cache(ttl=600, stale=6000)
        async def fetch(obj: object) -> int:
            nonlocal call_count
            call_count += 1
            return call_count

        unserializable = object()
        self.assertEqual(await fetch(unserializable), 1)
        self.assertEqual(await fetch(unserializable), 2)  # no stable key -> never cached
        self.assertEqual(call_count, 2)
        self.assertEqual(self.fake.store, {})


if __name__ == "__main__":
    unittest.main()
