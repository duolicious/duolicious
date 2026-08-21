"""Render request-validation failures the way the pre-FastAPI app did.

FastAPI reports a body-validation failure as a 422 with a `{"detail": [...]}`
envelope. The old app reported a 400 with a bare pydantic error array
(`[{"type", "loc", "msg"}, ...]`), which clients parse to surface each `msg`
(e.g. `Base64File` rejecting an oversized image). These handlers preserve that
status and shape for both pydantic's own `RequestValidationError` and the
`FieldValidationError` that business code raises for checks that can't run
inside a synchronous pydantic validator (e.g. `person`'s async anti-abuse
lookups). Registered as the app's exception handlers in `service.api.asgi`.
"""

from collections.abc import Sequence

from fastapi.exceptions import RequestValidationError
from starlette.requests import Request
from starlette.responses import Response

from service.api.duotypes import FieldValidationError
from service.api.responses import make_response

# FastAPI prefixes a body error's `loc` with the part of the request it came
# from ("body"/"query"/...); the old app, which built the model straight from
# the JSON body, didn't, so drop the marker to match.
_LOC_MARKERS = frozenset({'body', 'query', 'path', 'header', 'cookie'})


def _client_error(
    error_type: str,
    loc: Sequence[str | int],
    msg: str,
) -> dict[str, object]:
    trimmed = loc[1:] if loc and loc[0] in _LOC_MARKERS else loc
    return {'type': error_type, 'loc': list(trimmed), 'msg': msg}


async def render_validation_error(
    request: Request, exc: RequestValidationError,
) -> Response:
    errors = [
        _client_error(error['type'], error['loc'], error['msg'])
        for error in exc.errors()
    ]
    return make_response((errors, 400))


async def render_field_validation_error(
    request: Request, exc: FieldValidationError,
) -> Response:
    # Mirror the shape a pydantic `value_error` validator would have produced
    # for this field, including its "Value error, " message prefix.
    error = _client_error(
        'value_error', (exc.field,), f'Value error, {exc.message}')
    return make_response(([error], 400))
