import base64
import uuid
from typing import List

from serviceshared.database import api_tx
from service.api.duohash import sha512
from service.api.chatprotocol.inbound import SaslAuth
from service.api.chatprotocol.outbound import (
    AuthFailure,
    AuthSuccess,
    Outbound,
    StreamClose,
)


Q_CHECK_AUTH = """
SELECT
    1
FROM
    duo_session
JOIN
    person
ON
    person.id = duo_session.person_id
WHERE
    duo_session.session_token_hash = %(session_token_hash)s
AND
    person.uuid = %(auth_username)s
AND
    duo_session.signed_in IS TRUE
AND
    duo_session.session_expiry > NOW()
"""


class Session:
    def __init__(self) -> None:
        self.connection_uuid = str(uuid.uuid4())
        self.username: str | None = None
        self.session_token_hash: str | None = None
        # Ordered set (oldest first) of usernames whose online status this
        # connection is subscribed to. When the per-connection cap is reached,
        # the earliest subscriptions are evicted to make room for new ones.
        self.online_subscriptions: dict[str, None] = {}


async def is_authorized(payload_b64: str | None, session: Session) -> bool:
    if session.username is not None:
        return False

    try:
        if payload_b64 is None:
            return False

        decoded_bytes = base64.b64decode(payload_b64)
        decoded_string = decoded_bytes.decode('utf-8')

        _, auth_username, auth_token = decoded_string.split('\0')

        # Validates that `auth_username` is a valid UUID
        uuid.UUID(auth_username)

        auth_token_hash = sha512(auth_token)

        params = dict(
            auth_username=auth_username,
            session_token_hash=auth_token_hash,
        )

        async with api_tx('read committed') as tx:
            await tx.execute(Q_CHECK_AUTH, params)
            assert await tx.fetchone()

        session.username = auth_username
        session.session_token_hash = auth_token_hash

        return True
    except Exception:
        pass

    return False


async def handle_auth(req: SaslAuth, session: Session) -> List[Outbound]:
    """
    Handles an <auth> stanza in the SASL namespace.
    """
    if await is_authorized(req.payload_b64, session):
        return [AuthSuccess()]

    return [AuthFailure(), StreamClose()]
