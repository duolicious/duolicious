"""
Verify ID tokens from Google and Apple.

Both providers issue signed JWTs after a successful sign-in. Rather than
calling each provider's `/userinfo` endpoint (extra round-trip, possible
rate limits), we verify the JWT signature locally against the provider's
JWKS — same trust model, $0 cost, and no external dependency at request
time after the JWKS is cached.

Env vars:
    DUO_GOOGLE_CLIENT_IDS  Comma-separated allowed `aud` values for Google.
                           Include every OAuth client ID that ships in a
                           client (Web, iOS, Android).
    DUO_APPLE_CLIENT_IDS   Comma-separated allowed `aud` values for Apple.
                           Bundle ID for native iOS, Services ID for web.
"""

import os
import secrets
import time
from typing import TypedDict
import duotypes as t

import jwt
from jwt import PyJWKClient
from google.auth.transport.requests import Request as _GoogleRequest
from google.oauth2 import id_token as _google_id_token

from service.api.decorators import enable_mocking


# Bound on JWKS / certs HTTP fetches. Without this, a slow upstream pins
# a worker indefinitely on the cold-start fetch.
_PROVIDER_HTTP_TIMEOUT_SECONDS = 5


class SocialAuthError(Exception):
    """Raised when a provider token fails verification."""


def _split_csv(env_name: str) -> list[str]:
    raw = os.environ.get(env_name, '')
    return [s.strip() for s in raw.split(',') if s.strip()]


_GOOGLE_CLIENT_IDS = _split_csv('DUO_GOOGLE_CLIENT_IDS')
_APPLE_CLIENT_IDS = _split_csv('DUO_APPLE_CLIENT_IDS')

_GOOGLE_ISSUERS = ('https://accounts.google.com', 'accounts.google.com')
_APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys'
_APPLE_ISSUER = 'https://appleid.apple.com'

# `PyJWKClient` does its own in-process caching with a 1-hour TTL, so a
# module-level singleton is fine.
_apple_jwks_client = PyJWKClient(
    _APPLE_JWKS_URL,
    cache_keys=True,
    lifespan=3600,
    timeout=_PROVIDER_HTTP_TIMEOUT_SECONDS,
)


# `google-auth`'s `Request` accepts a per-call timeout via __call__, but
# `verify_oauth2_token` doesn't expose that. Subclass to set a default.
class _BoundedTimeoutGoogleRequest(_GoogleRequest):
    def __call__(
        self,
        url: str,
        method: str = 'GET',
        body: object = None,
        headers: object = None,
        timeout: object = _PROVIDER_HTTP_TIMEOUT_SECONDS,
        **kwargs: object,
    ) -> object:
        return super().__call__(
            url, method, body, headers, timeout=timeout, **kwargs
        )


# `google-auth` caches its certs on the Request object.
_google_request = _BoundedTimeoutGoogleRequest()


def _decode_unverified(
    token: str,
    *,
    allowed_issuers: tuple[str, ...],
    allowed_audiences: list[str],
) -> dict:
    """
    Decode a JWT *without* signature verification, then enforce the
    same iss/aud/exp/required-claim checks that the real verifiers do.
    Used only when `enable_mocking()` is True — in production this path
    is never reached because the mocking flag file isn't shipped in the
    Docker image (`api.Dockerfile` excludes the `test/` directory).
    """
    try:
        claims = jwt.decode(
            token,
            options={
                'verify_signature': False,
                'require': ['sub', 'iss', 'aud', 'exp'],
            },
        )
    except jwt.PyJWTError as e:
        raise SocialAuthError(f'Mock token malformed: {e}')

    iss = claims.get('iss')
    if iss not in allowed_issuers:
        raise SocialAuthError(f'Mock token has unexpected iss: {iss!r}')

    aud_claim = claims.get('aud')
    aud_list = [aud_claim] if isinstance(aud_claim, str) else list(aud_claim or [])
    if not any(a in allowed_audiences for a in aud_list):
        raise SocialAuthError(f'Mock token has unexpected aud: {aud_claim!r}')

    exp = claims.get('exp')
    if not isinstance(exp, (int, float)) or exp < time.time():
        raise SocialAuthError('Mock token has expired or invalid exp')

    return claims


def verify_google_id_token(id_token: str) -> t.SocialClaims:
    """
    Validate a Google ID token. Returns the canonical claims we need.

    Raises SocialAuthError on any verification failure.
    """
    if not _GOOGLE_CLIENT_IDS:
        raise SocialAuthError('DUO_GOOGLE_CLIENT_IDS is not configured')

    if enable_mocking():
        claims = _decode_unverified(
            id_token,
            allowed_issuers=_GOOGLE_ISSUERS,
            allowed_audiences=_GOOGLE_CLIENT_IDS,
        )
    else:
        try:
            # `verify_oauth2_token` checks signature, exp, iss
            # ('accounts.google.com' or 'https://accounts.google.com'), and
            # `aud` against the supplied list.
            claims = _google_id_token.verify_oauth2_token(
                id_token, _google_request, audience=_GOOGLE_CLIENT_IDS,
            )
        except ValueError as e:
            raise SocialAuthError(f'Invalid Google token: {e}')

    sub = claims.get('sub')
    email = claims.get('email')
    if not sub or not email:
        raise SocialAuthError('Google token missing sub or email')

    # Google sometimes returns email_verified as bool, sometimes as string
    raw_verified = claims.get('email_verified', False)
    email_verified = (
        raw_verified is True or
        (isinstance(raw_verified, str) and raw_verified.lower() == 'true')
    )

    return t.SocialClaims(
        sub=sub,
        email=email,
        email_verified=email_verified,
    )


def verify_apple_identity_token(
    identity_token: str,
    *,
    expected_nonce: str,
) -> t.SocialClaims:
    """
    Validate an Apple `identity_token` (the JWT returned to the client by
    Sign In with Apple). Returns the canonical claims.

    `expected_nonce` is the random string the client passed to Apple as the
    `nonce` (native `signInAsync({ nonce })` on iOS, `&nonce=` URL param on
    web/Android). Apple echoes it verbatim into the JWT's `nonce` claim; we
    compare the two to bind the token to the originating client session.

    Raises SocialAuthError on any verification failure.
    """
    if not _APPLE_CLIENT_IDS:
        raise SocialAuthError('DUO_APPLE_CLIENT_IDS is not configured')

    if enable_mocking():
        claims = _decode_unverified(
            identity_token,
            allowed_issuers=(_APPLE_ISSUER,),
            allowed_audiences=_APPLE_CLIENT_IDS,
        )
    else:
        try:
            signing_key = _apple_jwks_client.get_signing_key_from_jwt(identity_token)
            claims = jwt.decode(
                identity_token,
                signing_key.key,
                algorithms=['RS256'],
                audience=_APPLE_CLIENT_IDS,
                issuer=_APPLE_ISSUER,
                options={'require': ['exp', 'iat', 'sub', 'iss', 'aud', 'nonce']},
            )
        except (jwt.PyJWTError, jwt.exceptions.PyJWKClientError) as e:
            raise SocialAuthError(f'Invalid Apple token: {e}')

    # Constant-time nonce comparison. An attacker who controls neither the
    # client nor Apple can't forge a JWT with a known nonce, but failing
    # closed here protects against bug-class issues if a nonce ever leaks.
    token_nonce = claims.get('nonce')
    if not isinstance(token_nonce, str) or not secrets.compare_digest(
        token_nonce, expected_nonce
    ):
        raise SocialAuthError('Apple token nonce did not match the expected value')

    sub = claims.get('sub')
    email = claims.get('email')
    if not sub:
        raise SocialAuthError('Apple token missing sub')
    if not email:
        # Apple usually includes `email` in every identity token, but if it
        # ever omits it (e.g. token from a re-auth path) we cannot link a
        # new account from email — only an existing `social_identity` row
        # via sub will work. Caller handles that case.
        email = ''

    # Apple's `email_verified` is a string ("true"/"false") and is always
    # "true" when the field is present (relay or real). When the claim is
    # absent we trust the issuer: Apple wouldn't include an email it hasn't
    # verified, so an unset claim alongside a present `email` is treated as
    # verified. The only false case is an explicit "false" / False.
    raw_verified = claims.get('email_verified')
    email_verified = (
        raw_verified is None or
        raw_verified is True or
        (isinstance(raw_verified, str) and raw_verified.lower() == 'true')
    )

    return t.SocialClaims(
        sub=sub,
        email=email,
        email_verified=email_verified,
    )
