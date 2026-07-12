import inspect
import unittest
from unittest.mock import patch
import service.api.chat.sessioncolumnbatch as sessioncolumnbatch
from service.api.chat.sessioncolumnbatch import (
    SessionColumnWrite,
    make_session_column_batcher,
)


SET = 'SET-QUERY'
CLEAR = 'CLEAR-QUERY'


class _FakeTx:
    def __init__(self, calls: list) -> None:
        self._calls = calls

    async def executemany(self, query: str, params_seq: list) -> None:
        self._calls.append((query, list(params_seq)))


class _FakeApiTx:
    """Records every `executemany` in place of a real `database.api_tx`."""
    def __init__(self) -> None:
        self.calls: list = []

    def __call__(self, isolation: str) -> '_FakeApiTx':
        return self

    async def __aenter__(self) -> _FakeTx:
        return _FakeTx(self.calls)

    async def __aexit__(self, *exc: object) -> bool:
        return False


class TestSessionColumnBatch(unittest.IsolatedAsyncioTestCase):
    async def _process(self, batch: list[SessionColumnWrite]) -> list:
        batcher = make_session_column_batcher(set_query=SET, clear_query=CLEAR)
        fake = _FakeApiTx()
        with patch.object(sessioncolumnbatch, 'api_tx', fake):
            result = batcher._process_fn(batch)
            if inspect.isawaitable(result):
                await result
        return fake.calls

    async def test_set_then_clear_same_session_ends_cleared(self) -> None:
        calls = await self._process([
            SessionColumnWrite(session_token_hash='h', value='token'),
            SessionColumnWrite(session_token_hash='h', value=None),
        ])
        self.assertEqual(
            calls,
            [(CLEAR, [dict(session_token_hash='h', value=None)])])

    async def test_clear_then_set_same_session_ends_set(self) -> None:
        calls = await self._process([
            SessionColumnWrite(session_token_hash='h', value=None),
            SessionColumnWrite(session_token_hash='h', value='token'),
        ])
        self.assertEqual(
            calls,
            [(SET, [dict(session_token_hash='h', value='token')])])

    async def test_distinct_sessions_split_across_queries(self) -> None:
        calls = await self._process([
            SessionColumnWrite(session_token_hash='a', value='token'),
            SessionColumnWrite(session_token_hash='b', value=None),
        ])
        self.assertEqual(calls, [
            (SET, [dict(session_token_hash='a', value='token')]),
            (CLEAR, [dict(session_token_hash='b', value=None)]),
        ])

    async def test_empty_batch_runs_no_query(self) -> None:
        self.assertEqual(await self._process([]), [])


if __name__ == '__main__':
    unittest.main()
