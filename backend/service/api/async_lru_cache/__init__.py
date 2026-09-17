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
        cache: OrderedDict[tuple[object, ...], asyncio.Future[R]] = OrderedDict()

        def evict(key: tuple[object, ...], future: asyncio.Future[R]) -> None:
            if cache.get(key) is future:
                del cache[key]

        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            key: tuple[object, ...] = args + tuple(sorted(kwargs.items()))

            if key in cache:
                cache.move_to_end(key)
                return await asyncio.shield(cache[key])

            future = asyncio.ensure_future(func(*args, **kwargs))

            def on_done(future: asyncio.Future[R]) -> None:
                if (
                    future.cancelled() or
                    future.exception() is not None or
                    (
                        self.cache_condition is not None and
                        not self.cache_condition(future.result())
                    )
                ):
                    evict(key, future)
                elif self.ttl is not None:
                    future.get_loop().call_later(self.ttl, evict, key, future)

            future.add_done_callback(on_done)

            cache[key] = future
            if len(cache) > self.maxsize:
                cache.popitem(last=False)

            return await asyncio.shield(future)

        return wrapper
