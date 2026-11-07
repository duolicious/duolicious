from typing import Callable
import unittest
from unittest.mock import MagicMock, call
import asyncio
import time
from serviceshared.batcher import Batcher, drain_all, track

class TestBatcher(unittest.IsolatedAsyncioTestCase):
    batcher: Batcher[int]

    def setUp(self) -> None:
        self.process_fn = MagicMock()

    async def asyncTearDown(self) -> None:
        # Stop the batcher after each test
        if hasattr(self, 'batcher'):
            self.batcher.stop()
            await asyncio.sleep(0.05)  # Let the cancellation settle

    async def assertEventually(
        self,
        assertion: Callable[[], None],
        timeout: float = 5.0,
    ) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                return assertion()
            except AssertionError:
                await asyncio.sleep(0.01)
        assertion()

    async def test_enqueue_and_process(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.1,
            max_batch_size=10,
        )
        self.batcher.start()

        # Enqueue a single item
        self.batcher.enqueue(1)

        # Allow some time for the batch to be processed
        # Check that the process_fn was called with the expected batch
        await self.assertEventually(
            lambda: self.process_fn.assert_called_once_with([1]))

    async def test_flush_interval_respected(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.2,
            max_batch_size=10,
        )
        self.batcher.start()

        # Enqueue an item
        self.batcher.enqueue(1)

        # Check that the batch is not processed immediately
        self.process_fn.assert_not_called()

        # Check that the batch was processed
        await self.assertEventually(
            lambda: self.process_fn.assert_called_once_with([1]))

    async def test_dynamic_flush_interval(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.2,
            max_batch_size=10,
        )
        self.batcher.start()

        # Enqueue an item
        self.batcher.enqueue(1)

        # Change the flush interval after enqueuing the item
        self.batcher.set_flush_interval(0.1)

        # Check that the batch was processed earlier due to the old interval
        await self.assertEventually(
            lambda: self.process_fn.assert_called_once_with([1]))

        # Enqueue an item
        self.batcher.enqueue(2)

        # Check that the batch was processed with the new flush interval
        await self.assertEventually(
            lambda: self.process_fn.assert_has_calls([call([1]), call([2])]))

    async def test_max_batch_size_respected(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=10.0,  # Long flush interval so we rely on batch size
            max_batch_size=3,
        )
        self.batcher.start()

        # Enqueue multiple items
        self.batcher.enqueue(1)
        self.batcher.enqueue(2)
        self.batcher.enqueue(3)

        # Check that the batch was processed due to reaching max_batch_size
        await self.assertEventually(
            lambda: self.process_fn.assert_called_once_with([1, 2, 3]))

    async def test_no_items_enqueued_during_flush_interval(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.1,
            max_batch_size=10,
        )
        self.batcher.start()

        # Wait for the flush interval to pass without enqueuing any items
        await asyncio.sleep(0.2)

        # Ensure that process_fn was not called since no items were enqueued
        self.process_fn.assert_not_called()

    async def test_drain_all_follows_chained_enqueues(self) -> None:
        downstream: Batcher[int] = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.1,
        )

        def forward(batch: list[int]) -> None:
            for item in batch:
                downstream.enqueue(item)

        self.batcher = Batcher(process_fn=forward, flush_interval=0.1)
        downstream.start()
        self.batcher.start()

        self.batcher.enqueue(1, callback=lambda: downstream.enqueue(2))
        await drain_all()

        self.process_fn.assert_called_once_with([1, 2])

    async def test_drain_all_skips_flush_interval(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=60.0,
        )
        self.batcher.start()

        self.batcher.enqueue(1)
        self.batcher.enqueue(2)
        await asyncio.sleep(0.05)
        await asyncio.wait_for(drain_all(), 1)

        self.process_fn.assert_called_once_with([1, 2])

    async def test_drain_all_batches_a_backlog(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=60.0,
            max_batch_size=2,
        )
        self.batcher.start()

        for item in range(5):
            self.batcher.enqueue(item)
        await drain_all()

        self.assertEqual(
            self.process_fn.call_args_list,
            [call([0, 1]), call([2, 3]), call([4])])

    async def test_drain_all_waits_for_tracked_tasks(self) -> None:
        async def send() -> None:
            await asyncio.sleep(0.2)
            self.process_fn()

        track(asyncio.create_task(send()))
        await drain_all()

        self.process_fn.assert_called_once()

if __name__ == '__main__':
    unittest.main()
