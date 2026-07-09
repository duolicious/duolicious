import base64
import uuid
from typing import List

from database import api_tx
from duohash import sha512
from chatprotocol.jid import LSERVER
from chatprotocol.inbound import (
    IqBind,
    IqSession,
    SaslAuth,
    SessionRequest,
    StreamOpenReq,
)
from chatprotocol.outbound import (
    AuthFailure,
    AuthSuccess,
    BindResult,
    Outbound,
    SessionResult,
    StreamClose,
    StreamFeatures,
    StreamOpenResponse,
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


def handle_open(req: StreamOpenReq, session: Session) -> List[Outbound]:
    """
    Handles an <open> stanza in the XMPP framing namespace.

    - When unauthenticated, offers STARTTLS and SASL (mechanism PLAIN).
    - When authenticated, offers session and bind.
    """
    return [
        StreamOpenResponse(
            version=req.version,
            id=str(uuid.uuid4()),
            from_=req.to,
        ),
        StreamFeatures(authenticated=bool(session.username)),
    ]


async def handle_auth(req: SaslAuth, session: Session) -> List[Outbound]:
    """
    Handles an <auth> stanza in the SASL namespace.
    """
    if await is_authorized(req.payload_b64, session):
        return [AuthSuccess()]

    return [AuthFailure(), StreamClose()]


def handle_iq_bind(iq_id: str, session: Session) -> List[Outbound]:
    if session.username is None:
        return []  # Ignore requests from unauthenticated clients

    return [BindResult(iq_id=iq_id, jid=f'{session.username}@{LSERVER}')]


def handle_iq_session(iq_id: str, session: Session) -> List[Outbound]:
    if session.username is None:
        return []

    return [SessionResult(iq_id=iq_id)]


async def maybe_get_session_response(
    request: SessionRequest,
    session: Session,
) -> List[Outbound]:
    if isinstance(request, StreamOpenReq):
        return handle_open(request, session)
    if isinstance(request, SaslAuth):
        return await handle_auth(request, session)
    if isinstance(request, IqBind):
        return handle_iq_bind(request.iq_id, session)
    if isinstance(request, IqSession):
        return handle_iq_session(request.iq_id, session)
    return []
