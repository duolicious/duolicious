"""Turn a handler's return value into a Starlette `Response`.

Handlers return plain values -- dict/list (-> JSON), str (-> text/html), bytes
(-> octet-stream), None (-> empty body), a `(body, status)` tuple, or a ready
`Response` (e.g. a redirect or file download). JSON is serialised the way
Flask's default provider did (Decimal/UUID -> str, dates -> HTTP-date, sorted
keys, trailing newline), including its dev/prod split: pretty-printed
(indent=2, matching `jq`) outside prod so the functionality test suite can diff
against it, and compact in prod so responses don't pay for indentation
whitespace on the wire.
"""

import json
from dataclasses import asdict, is_dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from email.utils import format_datetime
from uuid import UUID

from starlette.responses import Response

_HTML_MIME = 'text/html; charset=utf-8'

# Prod serves compact JSON; everywhere else pretty-prints so `jq`-based
# functionality tests can diff against it (matching Flask's debug-gated split).
from duoenv.api import ENV

_PRETTY = ENV != 'prod'


def _flask_json_default(o: object) -> object:
    if isinstance(o, datetime):
        if o.tzinfo is None:
            o = o.replace(tzinfo=timezone.utc)
        return format_datetime(o, usegmt=True)
    if isinstance(o, date):
        return format_datetime(
            datetime(o.year, o.month, o.day, tzinfo=timezone.utc), usegmt=True)
    if isinstance(o, (Decimal, UUID)):
        return str(o)
    if is_dataclass(o) and not isinstance(o, type):
        return asdict(o)
    if hasattr(o, '__html__'):
        return str(o.__html__())
    raise TypeError(
        f'Object of type {type(o).__name__} is not JSON serializable')


def _json_dumps(obj: object) -> str:
    body = json.dumps(
        obj,
        default=_flask_json_default,
        sort_keys=True,
        ensure_ascii=True,
        indent=2 if _PRETTY else None,
        separators=None if _PRETTY else (',', ':'),
    )
    return body + '\n'


def make_response(result: object) -> Response:
    status = 200

    # The `(body, status)` convention. `status` must be an int; a 2-tuple whose
    # second element isn't one is unpacked as the body only (status stays 200),
    # so don't return a 2-element tuple as JSON data -- wrap it in a list.
    if isinstance(result, tuple) and len(result) == 2:
        body, code = result
        result = body
        if isinstance(code, int):
            status = code

    if isinstance(result, Response):
        return result

    if result is None or isinstance(result, str):
        return Response(
            content=result or '', status_code=status, media_type=_HTML_MIME)

    if isinstance(result, bytes):
        return Response(
            content=result,
            status_code=status,
            media_type='application/octet-stream')

    return Response(
        content=_json_dumps(result),
        status_code=status,
        media_type='application/json',
    )
