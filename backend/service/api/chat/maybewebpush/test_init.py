import json
import unittest
from service.api.chatprotocol.inbound import RegisterWebPushSubscription
from service.api.chat.sessioncolumnbatch import SessionColumnWrite
from service.api.chat.maybewebpush import (
    _is_valid_subscription,
    _batcher,
    register_web_push_subscription,
)


VALID_SUBSCRIPTION = json.dumps(dict(
    endpoint='https://push.example.com/abc',
    keys=dict(p256dh='p', auth='a'),
))


class TestIsValidSubscription(unittest.TestCase):
    def test_valid(self) -> None:
        self.assertTrue(_is_valid_subscription(VALID_SUBSCRIPTION))

    def test_not_json(self) -> None:
        self.assertFalse(_is_valid_subscription('not json'))

    def test_missing_endpoint(self) -> None:
        self.assertFalse(_is_valid_subscription(json.dumps(dict(keys={}))))

    def test_missing_keys(self) -> None:
        self.assertFalse(_is_valid_subscription(
            json.dumps(dict(endpoint='https://push.example.com/abc'))))

    def test_json_array(self) -> None:
        self.assertFalse(_is_valid_subscription('[]'))

    def test_non_https_endpoint(self) -> None:
        self.assertFalse(_is_valid_subscription(json.dumps(dict(
            endpoint='http://push.example.com/abc',
            keys=dict(p256dh='p', auth='a')))))

    def test_schemeless_endpoint(self) -> None:
        self.assertFalse(_is_valid_subscription(json.dumps(dict(
            endpoint='//push.example.com/abc',
            keys=dict(p256dh='p', auth='a')))))


class TestRegisterWebPushSubscription(unittest.TestCase):
    def setUp(self) -> None:
        self._drain()

    def _drain(self) -> list[SessionColumnWrite]:
        drained = []
        while not _batcher._queue.empty():
            drained.append(_batcher._queue.get_nowait().item)
        return drained

    def _queued(self) -> list[SessionColumnWrite]:
        return self._drain()

    def test_no_session_token_hash_is_rejected(self) -> None:
        result = register_web_push_subscription(
            RegisterWebPushSubscription(subscription=VALID_SUBSCRIPTION),
            session_token_hash=None)
        self.assertFalse(result)
        self.assertEqual(self._queued(), [])

    def test_valid_subscription_is_queued(self) -> None:
        result = register_web_push_subscription(
            RegisterWebPushSubscription(subscription=VALID_SUBSCRIPTION),
            session_token_hash='hash1')
        self.assertTrue(result)
        self.assertEqual(
            self._queued(),
            [SessionColumnWrite(
                session_token_hash='hash1',
                value=VALID_SUBSCRIPTION)])

    def test_clear_is_queued_as_none(self) -> None:
        result = register_web_push_subscription(
            RegisterWebPushSubscription(subscription=None),
            session_token_hash='hash1')
        self.assertTrue(result)
        self.assertEqual(
            self._queued(),
            [SessionColumnWrite(session_token_hash='hash1', value=None)])

    def test_malformed_subscription_is_queued_as_none(self) -> None:
        result = register_web_push_subscription(
            RegisterWebPushSubscription(subscription='garbage'),
            session_token_hash='hash1')
        self.assertTrue(result)
        self.assertEqual(
            self._queued(),
            [SessionColumnWrite(session_token_hash='hash1', value=None)])


if __name__ == '__main__':
    unittest.main()
