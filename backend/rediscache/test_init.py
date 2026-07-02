import unittest
import uuid
from decimal import Decimal
from unittest.mock import patch

import rediscache
from rediscache import redis_cache


class FakeRedis:
    """In-memory stand-in for the async redis client used by rediscache."""

    def __init__(self) -> None:
        self.store: dict[object, object] = {}
        self.expirations: dict[object, object] = {}

    async def get(self, key: object) -> object:
        return self.store.get(key)

    async def set(self, key: object, value: object, ex: object = None) -> object:
        self.store[key] = value
        self.expirations[key] = ex
        return True


class ExplodingRedis:
    """Stand-in whose every operation raises, like an unreachable Redis."""

    async def get(self, key: object) -> None:
        raise ConnectionError("redis down")

    async def set(self, key: object, value: object, ex: object = None) -> None:
        raise ConnectionError("redis down")


class TestRedisCache(unittest.IsolatedAsyncioTestCase):

    def setUp(self) -> None:
        self.fake = FakeRedis()
        patcher = patch.object(rediscache, "_redis", self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_caches_result(self) -> None:
        call_count = 0

        @redis_cache(ttl=600)
        async def fetch() -> object:
            nonlocal call_count
            call_count += 1
            return {"value": call_count}

        self.assertEqual(await fetch(), {"value": 1})  # miss
        self.assertEqual(await fetch(), {"value": 1})  # hit, not recomputed
        self.assertEqual(call_count, 1)

    async def test_distinct_args_cached_separately(self) -> None:
        call_count = 0

        @redis_cache(ttl=600)
        async def fetch(x: int, y: int = 0) -> object:
            nonlocal call_count
            call_count += 1
            return x + y

        self.assertEqual(await fetch(1), 1)        # miss
        self.assertEqual(await fetch(1), 1)        # hit
        self.assertEqual(await fetch(2), 2)        # miss (different positional)
        self.assertEqual(await fetch(1, y=5), 6)   # miss (different kwarg)
        self.assertEqual(await fetch(1, y=5), 6)   # hit
        self.assertEqual(call_count, 3)

    async def test_ttl_passed_to_redis(self) -> None:
        @redis_cache(ttl=600)
        async def fetch() -> object:
            return "x"

        await fetch()
        self.assertEqual(list(self.fake.expirations.values()), [600])

    async def test_serializes_db_types(self) -> None:
        u = uuid.uuid4()

        @redis_cache(ttl=600)
        async def fetch() -> object:
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

        @redis_cache(ttl=600)
        async def fetch() -> object:
            nonlocal call_count
            call_count += 1
            return call_count

        with patch.object(rediscache, "_redis", ExplodingRedis()):
            self.assertEqual(await fetch(), 1)  # get raises -> miss; set raises -> swallowed
            self.assertEqual(await fetch(), 2)  # still uncached, recomputed
        self.assertEqual(call_count, 2)

    async def test_unserializable_arg_skips_cache(self) -> None:
        call_count = 0

        @redis_cache(ttl=600)
        async def fetch(obj: object) -> object:
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
