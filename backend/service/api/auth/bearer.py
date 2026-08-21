"""Bearer-token authentication for the API, exposed as the `session(...)`
dependency factory.

`session()` resolves the request's bearer token to a `SessionInfo` (a
best-effort async `sessioncache` lookup, falling back to Postgres) and enforces
the expected onboarding / sign-in status, raising `AuthError` otherwise. The
resolved session is cached back into `sessioncache`; see that module for the
cache's correctness model.
"""

from collections.abc import Awaitable, Callable
from typing import Literal, overload

from service.api import duotypes
from service.api import sessioncache
from serviceshared.antiabuse.antispam.signupemail import normalize_email
from serviceshared.database import api_tx
from service.api.duohash import sha512
from starlette.requests import Request

Q_GET_SESSION = """
SELECT
    duo_session.person_id,
    person.uuid::TEXT AS person_uuid,
    duo_session.email,
    duo_session.signed_in,
    duo_session.pending_club_name,
    EXTRACT(EPOCH FROM duo_session.session_expiry)::double precision
        AS session_expiry_epoch
FROM
    duo_session
LEFT JOIN
    person
ON
    duo_session.person_id = person.id
WHERE
    session_token_hash = %(session_token_hash)s
AND
    session_expiry > NOW()
"""


class AuthError(Exception):
    """Raised by `session` on missing/invalid auth. Rendered by the app's
    exception handler to a plain-text body + status code (rather than
    FastAPI's default JSON `{"detail": ...}`)."""
    def __init__(self, message: str, status_code: int) -> None:
        self.message = message
        self.status_code = status_code


def _bearer_token(request: Request) -> str:
    """Extract the token from an `Authorization: Bearer <token>` header.

    Only the scheme is compared case-insensitively; the token is passed through
    verbatim, since it's a case-sensitive secret."""
    parts = (request.headers.get('Authorization') or '').split()
    if len(parts) != 2 or parts[0].lower() != 'bearer':
        raise AuthError('Missing or malformed authorization header', 400)
    return parts[1]


@overload
def session(
    expected_onboarding_status: bool | None = ...,
    expected_sign_in_status: bool | None = ...,
    *,
    optional: Literal[False] = False,
) -> Callable[[Request], Awaitable[duotypes.SessionInfo]]: ...


@overload
def session(
    expected_onboarding_status: bool | None = ...,
    expected_sign_in_status: bool | None = ...,
    *,
    optional: Literal[True],
) -> Callable[[Request], Awaitable[duotypes.SessionInfo | None]]: ...


def session(
    expected_onboarding_status: bool | None = True,
    expected_sign_in_status: bool | None = True,
    *,
    optional: bool = False,
) -> Callable[[Request], Awaitable[duotypes.SessionInfo | None]]:
    """Async auth dependency factory. Resolves the bearer token to a
    `SessionInfo` and enforces the expected onboarding/sign-in status, raising
    `AuthError` otherwise.

    With `optional=True`, any `AuthError` (missing/malformed header, unknown
    session, or status mismatch) yields `None` instead of propagating -- the
    overloads reflect this in the return type."""
    async def dependency(request: Request) -> duotypes.SessionInfo | None:
        try:
            session_token_hash = sha512(_bearer_token(request))

            # sessioncache is a fast, best-effort async Redis get/set. The
            # session-row fallback uses the async DB.
            session_info = await sessioncache.get_session(session_token_hash)

            if session_info is None:
                async with api_tx('READ COMMITTED') as tx:
                    await tx.execute(
                        Q_GET_SESSION,
                        dict(session_token_hash=session_token_hash))
                    row = await tx.fetchone()
                if row:
                    session_info = duotypes.SessionInfo(
                        email=row['email'],
                        person_id=row['person_id'],
                        person_uuid=row['person_uuid'],
                        signed_in=row['signed_in'],
                        session_token_hash=session_token_hash,
                        pending_club_name=row['pending_club_name'],
                    )
                    await sessioncache.put_session(
                        session_info,
                        row['session_expiry_epoch'])

            if session_info is None:
                raise AuthError('Invalid session token', 401)

            is_onboarded = session_info.person_id is not None
            ok_onboarding = (
                expected_onboarding_status is None
                or expected_onboarding_status == is_onboarded)
            ok_sign_in = (
                expected_sign_in_status is None
                or expected_sign_in_status == session_info.signed_in)
            if not (ok_onboarding and ok_sign_in):
                raise AuthError('Unauthorized', 401)

            # Set for account-scoped rate limiting (see `limiter_account`), so
            # an account-keyed limit can compose as another dependency.
            request.state.normalized_email = normalize_email(session_info.email)
            return session_info
        except AuthError:
            if optional:
                return None
            raise

    return dependency
