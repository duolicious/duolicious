"""
Batches writes to a single `duo_session` column keyed by `session_token_hash`,
collapsing a burst of (re-)registrations into a few UPDATEs. Backs both the
mobile push-token path (`mayberegister`) and the web push-subscription path
(`maybewebpush`); each supplies its own SET/clear queries (parameterised on
`%(value)s` and `%(session_token_hash)s`). Within a batch only the last write
per session is applied, so a set+clear (in either order) in one window ends in
the state the session last asked for.
"""
from dataclasses import dataclass
from typing import Iterable
from serviceshared.batcher import Batcher
from serviceshared.database import api_tx


@dataclass(frozen=True)
class SessionColumnWrite:
    session_token_hash: str
    value: str | None


def make_session_column_batcher(
    set_query: str,
    clear_query: str,
) -> Batcher[SessionColumnWrite]:
    async def execute(
        writes: Iterable[SessionColumnWrite],
        set_value: bool,
    ) -> None:
        params_seq = [
                dict(
                    session_token_hash=w.session_token_hash,
                    value=w.value)
                for w in writes]

        if not params_seq:
            return

        q = set_query if set_value else clear_query

        async with api_tx('read committed') as tx:
            await tx.executemany(q, params_seq)

    async def process_batch(batch: Iterable[SessionColumnWrite]) -> None:
        latest = {w.session_token_hash: w for w in batch}

        for set_value in (True, False):
            writes = [
                w
                for w in latest.values()
                if bool(w.value) is set_value]

            await execute(writes, set_value)

    return Batcher[SessionColumnWrite](
        process_fn=process_batch,
        flush_interval=1.0,
        min_batch_size=1,
        max_batch_size=100,
        retry=False,
    )
