"""
Apple Sign In with Apple — web/Android OAuth callback.

iOS uses the native Sign In with Apple API (expo-apple-authentication)
and never hits this endpoint. Android and web have no native Apple SDK,
so they use the OAuth web flow against a Services ID:

    1. Client builds an authorize URL pointing at appleid.apple.com.
    2. User signs in.
    3. Apple POSTs the result (form-encoded) back to a Return URL
       registered on the Services ID.
    4. Browsers can't navigate to a POST response, so the Return URL has
       to be a server endpoint that converts POST -> 302 redirect.

This module is that converter. It pulls the `id_token` out of the form
post and 302s back to a client-controlled URL with the token in a query
parameter, so the originating client can hand it to /sign-in-with-apple.

The redirect target is *not* picked by the client URL-side — that would
be an open redirect. Instead, the client encodes a target name (`web`
or `android`) inside the OAuth `state` parameter, which Apple echoes
back unchanged. We resolve that name against an env-configured
allow-list.

Env vars:
    DUO_APPLE_WEB_REDIRECT_URL      Final redirect target after a web
                                    sign-in. Typically the SPA root.
    DUO_APPLE_ANDROID_REDIRECT_URL  Final redirect target after an
                                    Android sign-in. Must be the
                                    Universal Link / App Link the
                                    Android client passes to
                                    expo-web-browser as `returnUrl`.
"""

import os
from typing import Optional

from starlette.responses import RedirectResponse

from util import append_query


APPLE_WEB_REDIRECT_URL = os.environ.get('DUO_APPLE_WEB_REDIRECT_URL', '').strip()
APPLE_ANDROID_REDIRECT_URL = os.environ.get('DUO_APPLE_ANDROID_REDIRECT_URL', '').strip()


_REDIRECT_TARGETS = {
    'web': APPLE_WEB_REDIRECT_URL,
    'android': APPLE_ANDROID_REDIRECT_URL,
}


def _resolve_target(state: str) -> Optional[str]:
    # `state` is `<csrf-nonce>.<target>`; we only care about the target
    # suffix. The nonce is verified client-side after the redirect.
    try:
        _, _, target = state.rpartition('.')
    except:
        return None
    return _REDIRECT_TARGETS.get(target) or None


def handle_callback(
    *,
    id_token: str,
    state: str,
    error: Optional[str],
) -> object:
    target_url = _resolve_target(state)
    if not target_url:
        return 'Invalid Apple sign-in state', 400

    if error:
        return RedirectResponse(append_query(target_url, dict(
            apple_error=error,
            apple_state=state,
        )), status_code=302)

    if not id_token:
        return RedirectResponse(append_query(target_url, dict(
            apple_error='missing_id_token',
            apple_state=state,
        )), status_code=302)

    return RedirectResponse(append_query(target_url, dict(
        apple_id_token=id_token,
        apple_state=state,
    )), status_code=302)
