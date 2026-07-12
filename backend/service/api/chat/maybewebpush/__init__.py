"""
Stores and reads a web session's Web Push subscription on `duo_session`, the
web-only counterpart to `mayberegister` (which stores mobile Expo push tokens).
Writes are batched via `sessioncolumnbatch` so a burst of (re-)registrations
collapses into a few UPDATEs; `fetch_web_push_subscriptions` reads back the live
subscriptions for a recipient when a push is about to be sent.
"""
import json
from urllib.parse import urlparse
from async_lru_cache import AsyncLruCache
from database import api_tx, row_str
from util import Json
from chatprotocol.inbound import RegisterWebPushSubscription
from service.api.chat.sessioncolumnbatch import (
    SessionColumnWrite,
    make_session_column_batcher,
)


Q_SELECT_WEB_PUSH_SUBSCRIPTIONS = """
SELECT
    duo_session.session_token_hash,
    duo_session.web_push_subscription
FROM
    duo_session
JOIN
    person
ON
    person.id = duo_session.person_id
WHERE
    person.uuid = uuid_or_null(%(username)s)
AND
    duo_session.signed_in
AND
    duo_session.web_push_subscription IS NOT NULL
"""


Q_SET_SUBSCRIPTION = """
UPDATE
    duo_session
SET
    web_push_subscription = %(value)s::jsonb
WHERE
    session_token_hash = %(session_token_hash)s
"""


Q_DELETE_SUBSCRIPTION = """
UPDATE
    duo_session
SET
    web_push_subscription = NULL
WHERE
    session_token_hash = %(session_token_hash)s
"""


_batcher = make_session_column_batcher(
    set_query=Q_SET_SUBSCRIPTION,
    clear_query=Q_DELETE_SUBSCRIPTION)


@AsyncLruCache(ttl=10)
async def fetch_web_push_subscriptions(
    username: str,
) -> list[tuple[str, Json]]:
    async with api_tx('read committed') as tx:
        await tx.execute(
            Q_SELECT_WEB_PUSH_SUBSCRIPTIONS,
            dict(username=username))
        rows = await tx.fetchall()

    return [
        (row_str(row, 'session_token_hash'), row['web_push_subscription'])
        for row in rows
    ]


async def clear_web_push_subscription(session_token_hash: str) -> None:
    async with api_tx('read committed') as tx:
        await tx.execute(
            Q_DELETE_SUBSCRIPTION,
            dict(session_token_hash=session_token_hash))


def _is_valid_endpoint(endpoint: Json) -> bool:
    if not isinstance(endpoint, str):
        return False

    parsed = urlparse(endpoint)

    return parsed.scheme == 'https' and bool(parsed.hostname)


def _is_valid_subscription(subscription: str) -> bool:
    try:
        parsed = json.loads(subscription)
    except (ValueError, TypeError):
        return False

    return (
        isinstance(parsed, dict)
        and _is_valid_endpoint(parsed.get('endpoint'))
        and isinstance(parsed.get('keys'), dict))


def register_web_push_subscription(
    request: RegisterWebPushSubscription,
    session_token_hash: str | None,
) -> bool:
    if not session_token_hash:
        return False

    subscription = (
        request.subscription
        if request.subscription and _is_valid_subscription(request.subscription)
        else None)

    _batcher.enqueue(SessionColumnWrite(
        session_token_hash=session_token_hash,
        value=subscription))

    return True
