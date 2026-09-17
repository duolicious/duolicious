import asyncio
from collections import OrderedDict
import functools
import math
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
        cache: OrderedDict[tuple[object, ...], tuple[asyncio.Future[R], float]] = OrderedDict()

        def is_live(future: asyncio.Future[R], expires_at: float) -> bool:
            if not future.done():
                return True
            if future.cancelled() or future.exception() is not None:
                return False
            if self.cache_condition is not None and not self.cache_condition(future.result()):
                return False
            return expires_at > future.get_loop().time()

        def drop_if_dead(
            key: tuple[object, ...],
            entry: tuple[asyncio.Future[R], float],
        ) -> None:
            if cache.get(key) is entry and not is_live(*entry):
                del cache[key]

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            key: tuple[object, ...] = args + tuple(sorted(kwargs.items()))
            entry = cache.get(key)
            if entry is None or not is_live(*entry):
                loop = asyncio.get_running_loop()
                expires_at = math.inf if self.ttl is None else loop.time() + self.ttl
                entry = (asyncio.ensure_future(func(*args, **kwargs)), expires_at)
                cache[key] = entry
                entry[0].add_done_callback(lambda _: drop_if_dead(key, entry))
            cache.move_to_end(key)
            if len(cache) > self.maxsize:
                cache.popitem(last=False)
            return await asyncio.shield(entry[0])

        return wrapper
