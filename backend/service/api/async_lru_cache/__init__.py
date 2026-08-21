import asyncio
from collections import OrderedDict
import functools
from typing import (
    Awaitable,
    Callable,
    ParamSpec,
    TypeVar,
)

P = ParamSpec("P")
R = TypeVar("R")

class AsyncLruCache:
    def __init__(
        self,
        maxsize: int = 1024,
        ttl: float | None = None,
        cache_condition: Callable[[object], bool] | None = None,
    ) -> None:
        self.maxsize = maxsize
        self.ttl = ttl  # seconds
        self.cache_condition = cache_condition

    def __call__(
        self,
        func: Callable[P, Awaitable[R]]
    ) -> Callable[P, Awaitable[R]]:
        cache: OrderedDict[
            tuple[object, ...],
            tuple[R, asyncio.TimerHandle | None],
        ] = OrderedDict()

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            key: tuple[object, ...] = args + tuple(sorted(kwargs.items()))

            # Return the cached result if available
            if key in cache:
                cache.move_to_end(key)  # Mark as recently used
                return cache[key][0]

            # Compute result as it's not cached
            result = await func(*args, **kwargs)

            # Determine if the result should be cached
            should_cache = self.cache_condition is None or self.cache_condition(result)
            if not should_cache:
                return result

            # Cache the result with optional TTL
            if self.ttl is not None:
                loop = asyncio.get_running_loop()
                timer = loop.call_later(self.ttl, lambda: cache.pop(key, None))
                cache[key] = (result, timer)
            else:
                cache[key] = (result, None)

            # Manage cache size
            if len(cache) > self.maxsize:
                oldest_key, oldest_value = cache.popitem(last=False)
                if oldest_value[1]:
                    oldest_value[1].cancel()  # Cancel the timer if it exists

            return result

        return wrapper
