from service.api.chatprotocol.inbound import RegisterPushToken
from service.api.chat.sessioncolumnbatch import (
    SessionColumnWrite,
    make_session_column_batcher,
)


Q_SET_TOKEN = """
UPDATE
    duo_session
SET
    push_token = %(value)s
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


_batcher = make_session_column_batcher(
    set_query=Q_SET_TOKEN,
    clear_query=Q_DELETE_TOKEN)


def register_push_token(
    request: RegisterPushToken,
    session_token_hash: str | None,
) -> bool:
    if not session_token_hash:
        return False

    _batcher.enqueue(SessionColumnWrite(
        session_token_hash=session_token_hash,
        value=request.token))

    return True
