import unittest
import asyncio
from service.api.async_lru_cache import AsyncLruCache

class TestAsyncLRUCache(unittest.IsolatedAsyncioTestCase):

    async def test_cache_basic_functionality(self) -> None:
        call_count = 0

        @AsyncLruCache(maxsize=2)
        async def fetch(x: int) -> int:
            nonlocal call_count
            call_count += 1
            return x * 2

        self.assertEqual(await fetch(1), 2)  # Cache miss
        self.assertEqual(await fetch(1), 2)  # Cache hit, should not increment call_count
        self.assertEqual(call_count, 1)  # Confirm only called once

        self.assertEqual(await fetch(2), 4)  # Cache miss
        self.assertEqual(await fetch(3), 6)  # Cache miss, should evict key 1
        self.assertEqual(await fetch(1), 2)  # Cache miss, as it was evicted
        self.assertEqual(call_count, 4)  # Function should have been called 4 times now

    async def test_cache_with_ttl(self) -> None:
        call_count = 0

        @AsyncLruCache(maxsize=2, ttl=0.1)  # very short TTL
        async def fetch(x: int) -> int:
            nonlocal call_count
            call_count += 1
            return x * 3

        self.assertEqual(await fetch(1), 3)  # Cache miss
        self.assertEqual(await fetch(1), 3)  # Cache hit
        self.assertEqual(call_count, 1)  # Confirm only called once

        await asyncio.sleep(0.2)  # Wait to ensure TTL expires
        self.assertEqual(await fetch(1), 3)  # Cache miss, as TTL expired
        self.assertEqual(call_count, 2)  # Function should have been called again

    async def test_cache_with_condition(self) -> None:
        call_count = 0

        def is_multiple_of_four(x: object) -> bool:
            return isinstance(x, int) and x % 4 == 0

        @AsyncLruCache(maxsize=2, cache_condition=is_multiple_of_four)
        async def fetch(x: int) -> int:
            nonlocal call_count
            call_count += 1
            return x * 2

        self.assertEqual(await fetch(2), 4)   # Result 4 is a multiple of 4, should cache
        self.assertEqual(await fetch(2), 4)   # Should use cache, no increment in call_count
        self.assertEqual(call_count, 1)       # Function called once

        self.assertEqual(await fetch(1), 2)   # Result 2 is not a multiple of 4, should not cache
        self.assertEqual(await fetch(1), 2)   # Should recompute, as not cached
        self.assertEqual(call_count, 3)       # Function called three times

    async def test_cache_with_kwargs(self) -> None:
        call_count = 0

        @AsyncLruCache(maxsize=2)
        async def fetch(x: int, y: int = 1) -> int:
            nonlocal call_count
            call_count += 1
            return x * y

        # Test with default keyword argument
        self.assertEqual(await fetch(2), 2)  # Cache miss (2*1)
        self.assertEqual(await fetch(2), 2)  # Cache hit
        self.assertEqual(call_count, 1)  # Function should be called once

        # Test changing keyword argument
        self.assertEqual(await fetch(2, y=2), 4)  # Cache miss (2*2)
        self.assertEqual(await fetch(2, y=2), 4)  # Cache hit
        self.assertEqual(call_count, 2)  # Function should be called twice

        # Test same positional with a different keyword argument
        self.assertEqual(await fetch(2, y=3), 6)  # Cache miss (2*3)
        self.assertEqual(await fetch(2, y=3), 6)  # Cache hit
        self.assertEqual(call_count, 3)  # Function should be called thrice

if __name__ == '__main__':
    unittest.main()
