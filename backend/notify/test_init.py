import unittest
from unittest.mock import patch, MagicMock, AsyncMock
from notify import enqueue_mobile_notification, _batcher
import asyncio
import json


def _mock_async_client(json_payload: object) -> tuple[MagicMock, MagicMock]:
    """Build a stand-in for `httpx.AsyncClient` and return (factory, client).

    The factory replaces `httpx.AsyncClient`; every `async with` block yields
    the same `client`, so `client.post` accumulates the calls across batches.
    """
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value=json_payload)

    client = MagicMock()
    client.post = AsyncMock(return_value=response)

    async_cm = MagicMock()
    async_cm.__aenter__ = AsyncMock(return_value=client)
    async_cm.__aexit__ = AsyncMock(return_value=False)

    factory = MagicMock(return_value=async_cm)
    return factory, client


class TestSendMobileNotification(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self) -> None:
        _batcher.set_flush_interval(1e-2)
        _batcher.start()
        # Let the consumer spin up and go idle (its flush window elapses), so
        # the first notification below flushes on its own.
        await asyncio.sleep(1e-1)

    async def asyncTearDown(self) -> None:
        _batcher.stop()
        await asyncio.sleep(5e-2)

    async def test_enqueue_mobile_notification_success(self) -> None:
        # Set up the mock response to simulate a successful notification
        factory, client = _mock_async_client({'data': [{'status': 'ok'}]})
        with patch('notify.make_http_client', factory):
            # Enqueued back-to-back: the first flushes on its own (the consumer
            # was idle, so its window had already elapsed), then the next two
            # are batched together in the following window.
            enqueue_mobile_notification(
                token='my-token',
                title='My title',
                body='My body 1',
            )

            enqueue_mobile_notification(
                token='my-token',
                title='My title',
                body='My body 2',
            )

            enqueue_mobile_notification(
                token='my-token',
                title='My title',
                body='My body 3',
            )

            # Wait for notifications to be sent
            await asyncio.sleep(2e-1)

        expected_data_call_1 = json.dumps(
            [
                {
                    "to": "my-token",
                    "title": "My title",
                    "body": "My body 1",
                    "sound": "default",
                    "priority": "high",
                },
            ]
        ).encode('utf-8')

        expected_data_call_2 = json.dumps(
            [
                {
                    "to": "my-token",
                    "title": "My title",
                    "body": "My body 2",
                    "sound": "default",
                    "priority": "high",
                },
                {
                    "to": "my-token",
                    "title": "My title",
                    "body": "My body 3",
                    "sound": "default",
                    "priority": "high",
                },
            ]
        ).encode('utf-8')

        self.assertEqual(len(client.post.call_args_list), 2)

        call = client.post.call_args_list[0]
        self.assertEqual(call.args[0], 'http://localhost')
        self.assertEqual(call.kwargs['content'], expected_data_call_1)
        self.assertEqual(call.kwargs['headers']['Content-type'], 'application/json')

        call = client.post.call_args_list[1]
        self.assertEqual(call.args[0], 'http://localhost')
        self.assertEqual(call.kwargs['content'], expected_data_call_2)
        self.assertEqual(call.kwargs['headers']['Content-type'], 'application/json')


    async def test_enqueue_mobile_notification_failure(self) -> None:
        # Set up the mock response to simulate a failed notification
        factory, client = _mock_async_client({'data': [{'status': 'error'}]})
        with patch('notify.make_http_client', factory):
            # Call the _enqueue_mobile_notification function
            enqueue_mobile_notification(
                token='my-token',
                title='My title',
                body='My body',
            )

            # Wait for notification be sent
            await asyncio.sleep(2e-1)

        # Assert that the URL and data sent are correct
        expected_data = json.dumps([{
            "to": "my-token",
            "title": "My title",
            "body": "My body",
            "sound": "default",
            "priority": "high",
        }]).encode('utf-8')

        call = client.post.call_args_list[0]
        self.assertEqual(call.args[0], 'http://localhost')
        self.assertEqual(call.kwargs['content'], expected_data)
        self.assertEqual(call.kwargs['headers']['Content-type'], 'application/json')


if __name__ == '__main__':
    unittest.main()
