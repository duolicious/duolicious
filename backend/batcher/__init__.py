from dataclasses import dataclass
from typing import Awaitable, Callable, Generic, TypeVar
import asyncio
import inspect
import time
import traceback

T = TypeVar('T')

ProcessFn = Callable[[list[T]], None] | Callable[[list[T]], Awaitable[None]]
Callback = Callable[[], None] | Callable[[], Awaitable[None]] | None

# Every Batcher registers itself here on construction. The consumer tasks can't
# be started at import time because there's no running event loop yet, so the
# application entrypoints (the FastAPI lifespan and the cron `main()`) call
# `start_all()` once their loop is running.
_batchers: list["Batcher"] = []


async def start_all() -> None:
    for batcher in _batchers:
        batcher.start()


@dataclass
class BatchItem(Generic[T]):
    item: T
    callback: Callback = None


class Batcher(Generic[T]):
    def __init__(
        self,
        process_fn: ProcessFn,
        flush_interval: float,
        min_batch_size: int = 1,
        max_batch_size: int = 100,
        retry: bool = False
    ):
        self._queue: asyncio.Queue[BatchItem[T]] = asyncio.Queue()
        self._process_fn = process_fn
        self._flush_interval = flush_interval
        self._min_batch_size = min_batch_size
        self._max_batch_size = max_batch_size
        self._retry = retry
        self._task: asyncio.Task[None] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        _batchers.append(self)

    def enqueue(self, item: T, callback: Callback = None) -> None:
        batch_item = BatchItem(item, callback)

        # `asyncio.Queue` is not thread-safe, so if the consumer is running we
        # hand the item to the loop thread. `call_soon_threadsafe` is safe to
        # call from the loop thread itself, so this works for every caller.
        if self._loop is None:
            self._queue.put_nowait(batch_item)
        else:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, batch_item)

    def set_flush_interval(self, flush_interval: float) -> None:
        self._flush_interval = flush_interval

    async def _wait_for_next_batch(self) -> list[BatchItem[T]] | None:
        # The flush window is anchored at the start of the wait, not at the
        # first item. This is deliberate: while the consumer sits idle the
        # window elapses, so the next item to arrive flushes ~immediately (low
        # latency), while a steady stream still batches within each window
        # (throughput). Anchoring on the first item instead would make every
        # batch wait a full `flush_interval`, adding latency callers rely on not
        # being there (e.g. push-token registration).
        batch: list[BatchItem[T]] = []
        deadline = time.time() + self._flush_interval

        while len(batch) < self._max_batch_size:
            remaining = deadline - time.time()
            if remaining <= 0 and len(batch) >= self._min_batch_size:
                break

            timeout = remaining if remaining >= 0 else None

            try:
                batch_item = await asyncio.wait_for(
                    self._queue.get(),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                continue

            batch.append(batch_item)

        return batch or None

    async def _run_callback(self, callback: Callback) -> None:
        if not callback:
            return
        try:
            result = callback()
            if inspect.isawaitable(result):
                await result
        except Exception:
            print(traceback.format_exc())

    async def _process_batch(self, batch: list[BatchItem[T]]) -> None:
        try:
            items = [bi.item for bi in batch]
            result = self._process_fn(items)
            if inspect.isawaitable(result):
                await result
        except Exception:
            print(traceback.format_exc())
            if self._retry:
                for bi in batch:
                    self._queue.put_nowait(bi)
            return

        for bi in batch:
            await self._run_callback(bi.callback)

    async def _process_batches_forever(self) -> None:
        while True:
            batch = await self._wait_for_next_batch()
            if batch is not None:
                await self._process_batch(batch)

    def start(self) -> None:
        # Create the queue here, on the running loop, so it binds to the loop
        # that actually drains it (rather than whatever loop happened to exist
        # at import time).
        self._queue = asyncio.Queue()
        self._loop = asyncio.get_running_loop()
        self._task = self._loop.create_task(self._process_batches_forever())

    def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None
