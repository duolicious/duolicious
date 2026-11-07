import base64
import hashlib
import hmac
from urllib.parse import urlencode

from serviceshared.duoenv.shared import UNSUBSCRIBE_SECRET


def _signature(person_uuid: str) -> bytes:
    digest = hmac.digest(
        UNSUBSCRIBE_SECRET.encode(), person_uuid.encode(), hashlib.sha256)
    return base64.urlsafe_b64encode(digest).rstrip(b'=')


def person_token(person_uuid: str) -> str:
    return f'{person_uuid}.{_signature(person_uuid).decode()}'


def unsubscribe_url(person_uuid: str) -> str:
    token = person_token(person_uuid)
    return f'https://api.duolicious.app/unsubscribe?{urlencode(dict(token=token))}'


def person_uuid_from_token(token: str) -> str | None:
    person_uuid, _, signature = token.partition('.')
    if hmac.compare_digest(signature.encode(), _signature(person_uuid)):
        return person_uuid
    return None
