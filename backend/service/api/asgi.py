"""The API's ASGI application: assembles the `app` from the routing, auth,
rate-limit, response, and middleware building blocks in this package.

The routes themselves are attached in `service.api` (the package `__init__`),
which imports this `app`. `service.api:app` is the uvicorn entry point.
"""

import logging

import constants
from duotypes import FieldValidationError
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response

from service.api.auth import AuthError
from service.api.errors import (
    render_field_validation_error,
    render_validation_error,
)
from service.api.middleware import (
    MaxBodySizeMiddleware,
    RequestEntityTooLarge,
    WorkerHeadersMiddleware,
)
from service.api.ratelimit import RateLimitExceeded
from service.api.responses import make_response
from service.api.routing import DuoRoute
from service.lifespan import app_lifespan

from duoenv.api import CORS_ORIGINS

# Uvicorn's log config only covers its own loggers; give the app's loggers a
# root handler in the same level-prefixed style.
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:     %(asctime)s %(name)s: %(message)s',
)

app = FastAPI(lifespan=app_lifespan)

# Match paths exactly; a trailing slash is a different route, not a redirect.
app.router.redirect_slashes = False

# Give every route the plain-value return convention + opt-out default limit.
app.router.route_class = DuoRoute

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS.split(','),
    allow_methods=['*'],
    allow_headers=['*'],
    expose_headers=['X-Duolicious-Worker', 'X-Duolicious-Commit'],
)
app.add_middleware(MaxBodySizeMiddleware, max_size=constants.MAX_CONTENT_LENGTH)
app.add_middleware(WorkerHeadersMiddleware)


# Render our exceptions to the plain-text bodies + status codes clients expect,
# rather than FastAPI's default JSON `{"detail": ...}`.
@app.exception_handler(AuthError)
async def _handle_auth_error(request: Request, exc: AuthError) -> Response:
    return make_response((exc.message, exc.status_code))


@app.exception_handler(RequestEntityTooLarge)
async def _handle_too_large(request: Request, exc: Exception) -> Response:
    return make_response(('Request entity too large', 413))


@app.exception_handler(RateLimitExceeded)
async def _handle_rate_limit(request: Request, exc: RateLimitExceeded) -> Response:
    return make_response(('Too Many Requests', 429))


# Validation failures (pydantic's own, and the business-raised kind) are
# rendered the way the pre-FastAPI app did; see `service.api.errors`.
app.exception_handler(RequestValidationError)(render_validation_error)
app.exception_handler(FieldValidationError)(render_field_validation_error)
