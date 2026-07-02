import unittest
from unittest.mock import MagicMock, call
import asyncio
from batcher import Batcher

class TestBatcher(unittest.IsolatedAsyncioTestCase):
    batcher: Batcher[int]

    def setUp(self) -> None:
        self.process_fn = MagicMock()

    async def asyncTearDown(self) -> None:
        # Stop the batcher after each test
        if hasattr(self, 'batcher'):
            self.batcher.stop()
            await asyncio.sleep(0.05)  # Let the cancellation settle

    async def test_enqueue_and_process(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.1,
            min_batch_size=1,
            max_batch_size=10,
            retry=False
        )
        self.batcher.start()

        # Enqueue a single item
        self.batcher.enqueue(1)

        # Allow some time for the batch to be processed
        await asyncio.sleep(0.2)

        # Check that the process_fn was called with the expected batch
        self.process_fn.assert_called_once_with([1])

    async def test_flush_interval_respected(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.2,
            min_batch_size=1,
            max_batch_size=10,
            retry=False
        )
        self.batcher.start()

        # Enqueue an item
        self.batcher.enqueue(1)

        # Check that the batch is not processed immediately
        self.process_fn.assert_not_called()

        # Wait for the flush interval to expire
        await asyncio.sleep(0.3)

        # Check that the batch was processed
        self.process_fn.assert_called_once_with([1])

    async def test_dynamic_flush_interval(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.2,
            min_batch_size=1,
            max_batch_size=10,
            retry=False
        )
        self.batcher.start()

        # Enqueue an item
        self.batcher.enqueue(1)

        # Change the flush interval after enqueuing the item
        self.batcher.set_flush_interval(0.1)

        await asyncio.sleep(0.3)  # New flush interval will take effect next batch

        # Check that the batch was processed earlier due to the old interval
        self.process_fn.assert_called_once_with([1])

        # Enqueue an item
        self.batcher.enqueue(2)

        # Allow time for the batch to be processed with the new flush interval
        await asyncio.sleep(0.2)

        # Check that the batch was processed earlier due to the old interval
        self.process_fn.assert_has_calls([call([1]), call([2])])

    async def test_max_batch_size_respected(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=10.0,  # Long flush interval so we rely on batch size
            min_batch_size=1,
            max_batch_size=3,
            retry=False
        )
        self.batcher.start()

        # Enqueue multiple items
        self.batcher.enqueue(1)
        self.batcher.enqueue(2)
        self.batcher.enqueue(3)

        # Allow some time for the batch to be processed
        await asyncio.sleep(0.1)

        # Check that the batch was processed due to reaching max_batch_size
        self.process_fn.assert_called_once_with([1, 2, 3])

    async def test_retry_on_failure(self) -> None:
        # Mock the process_fn to raise an exception on the first call
        def failing_process(batch: object) -> None:
            if not hasattr(failing_process, 'called'):
                setattr(failing_process, 'called', True)
                raise Exception("Simulated failure")
            self.process_fn(batch)

        process_fn = MagicMock(side_effect=failing_process)

        self.batcher = Batcher(
            process_fn=process_fn,
            flush_interval=0.1,
            min_batch_size=1,
            max_batch_size=10,
            retry=True
        )
        self.batcher.start()

        # Enqueue an item
        self.batcher.enqueue(1)

        # Allow time for the batch to be processed twice
        await asyncio.sleep(0.3)

        # Check that the batch was retried and processed successfully
        self.process_fn.assert_called_once_with([1])

    async def test_no_items_enqueued_during_flush_interval(self) -> None:
        self.batcher = Batcher(
            process_fn=self.process_fn,
            flush_interval=0.1,
            min_batch_size=1,
            max_batch_size=10,
            retry=False
        )
        self.batcher.start()

        # Wait for the flush interval to pass without enqueuing any items
        await asyncio.sleep(0.2)

        # Ensure that process_fn was not called since no items were enqueued
        self.process_fn.assert_not_called()

    async def test_empty_batch_processing(self) -> None:
        def process_fn(batch: list[object]) -> None:
            # Ensure that the batch is never empty
            self.assertTrue(len(batch) > 0, "Batch should not be empty")
            self.process_fn(batch)

        self.batcher = Batcher(
            process_fn=process_fn,
            flush_interval=0.1,
            min_batch_size=0,  # Allow processing of empty batches if it happens
            max_batch_size=10,
            retry=False
        )
        self.batcher.start()

        # Enqueue and process normally
        self.batcher.enqueue(1)
        await asyncio.sleep(0.2)

        # Ensure process_fn was called once with non-empty batch
        self.process_fn.assert_called_once_with([1])

if __name__ == '__main__':
    unittest.main()
