from typing import Iterable

from serviceshared.constants import MAX_SESSIONS
from serviceshared.database import Row, Tx, api_tx
from service.api import sessioncache


Q_SIGN_OUT_SESSIONS = """
UPDATE
    duo_session
SET
    signed_in = FALSE
WHERE
    session_token_hash = ANY(%(session_token_hashes)s)
"""

Q_DELETE_OVER_LIMIT_SESSIONS = """
DELETE FROM
    duo_session
WHERE
    session_token_hash IN (
        SELECT
            session_token_hash
        FROM
            duo_session
        WHERE
            person_id = %(person_id)s
        AND
            session_token_hash <> %(current_session_token_hash)s
        ORDER BY
            signed_in DESC,
            signed_in_at IS NOT NULL DESC,
            last_online_time DESC,
            session_expiry DESC
        OFFSET
            %(keep)s
    )
RETURNING
    session_token_hash
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
    current_session_token_hash: str,
) -> None:
    """Delete the person's sessions beyond `MAX_SESSIONS`, always keeping the
    current one: sessions that were never signed in go first, then signed-out
    ones, then the least-recently-active signed-in ones."""
    if person_id is None:
        return

    async with api_tx('READ COMMITTED') as tx:
        over_limit_tx = await tx.execute(Q_DELETE_OVER_LIMIT_SESSIONS, dict(
            person_id=person_id,
            current_session_token_hash=current_session_token_hash,
            # The current session is excluded above and always kept, so keep
            # it plus the (MAX - 1) others that rank first.
            keep=MAX_SESSIONS - 1,
        ))
        over_limit: list[Row] = await over_limit_tx.fetchall()

    for row in over_limit:
        await sessioncache.delete_session(row['session_token_hash'])
