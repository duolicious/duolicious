from database import api_tx
from dataclasses import dataclass
from typing import Optional, Iterable
from batcher import Batcher
from chatprotocol.inbound import RegisterPushToken


Q_SET_TOKEN = """
UPDATE
    duo_session
SET
    push_token = %(token)s
WHERE
    session_token_hash = %(session_token_hash)s
"""


Q_DELETE_TOKEN = """
UPDATE
    duo_session
SET
    push_token = NULL
WHERE
    session_token_hash = %(session_token_hash)s
"""


@dataclass(frozen=True)
class DuoPushToken:
    session_token_hash: str
    token: Optional[str]


async def execute_query(tokens: Iterable[DuoPushToken], has_token: bool) -> None:
    if not tokens:
        return

    params_seq = [
            dict(
                session_token_hash=duo_push_token.session_token_hash,
                token=duo_push_token.token)
            for duo_push_token in tokens]

    q = Q_SET_TOKEN if has_token else Q_DELETE_TOKEN

    async with api_tx('read committed') as tx:
        await tx.executemany(q, params_seq)


async def process_batch(batch: Iterable[DuoPushToken]) -> None:
    for has_token in (True, False):
        tokens = set(
            duo_push_token
            for duo_push_token in batch
            if bool(duo_push_token.token) is has_token)

        await execute_query(tokens=tokens, has_token=has_token)


_batcher = Batcher[DuoPushToken](
    process_fn=process_batch,
    flush_interval=1.0,
    min_batch_size=1,
    max_batch_size=100,
    retry=False,
)


def register_push_token(
    request: RegisterPushToken,
    session_token_hash: str | None,
) -> bool:
    if not session_token_hash:
        return False

    _batcher.enqueue(DuoPushToken(
        session_token_hash=session_token_hash,
        token=request.token))

    return True
