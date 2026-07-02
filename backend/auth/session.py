from typing import Iterable

from constants import MAX_SIGNED_IN_SESSIONS
from database import Row, Tx, api_tx
import sessioncache


Q_SIGN_OUT_SESSIONS = """
DELETE FROM
    duo_session
WHERE
    session_token_hash = ANY(%(session_token_hashes)s)
"""

Q_OVER_LIMIT_SESSIONS = """
SELECT
    session_token_hash
FROM
    duo_session
WHERE
    person_id = %(person_id)s
AND
    signed_in
AND
    session_token_hash <> %(current_session_token_hash)s
ORDER BY
    last_online_time DESC,
    session_expiry DESC
OFFSET
    %(keep)s
"""


async def sign_out(session_token_hashes: Iterable[str]) -> None:
    """Async counterpart to `sign_out` for native FastAPI routes."""
    hashes = [h for h in session_token_hashes if h]
    if not hashes:
        return

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_SIGN_OUT_SESSIONS, dict(session_token_hashes=hashes))

    for session_token_hash in hashes:
        await sessioncache.delete_session(session_token_hash)


async def enforce_session_limit(
    person_id: int | None,
    current_session_token_hash: object,
) -> None:
    """Async counterpart to `enforce_session_limit` for native routes."""
    if person_id is None:
        return

    async with api_tx('READ COMMITTED') as tx:
        over_limit_tx = await tx.execute(Q_OVER_LIMIT_SESSIONS, dict(
            person_id=person_id,
            current_session_token_hash=current_session_token_hash,
            # The current session is excluded above and always kept, so keep
            # it plus the (MAX - 1) most-recently-active others.
            keep=MAX_SIGNED_IN_SESSIONS - 1,
        ))
        over_limit: list[Row] = await over_limit_tx.fetchall()

    await sign_out(row['session_token_hash'] for row in over_limit)
