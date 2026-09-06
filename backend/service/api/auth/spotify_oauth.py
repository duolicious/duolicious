"""
Spotify OAuth callback (GET /spotify/callback).

The flow is backend-callback (see `backend/spotify/__init__.py`):
`POST /spotify/authorize` mints a single-use `state` bound to the signed-in
person, Spotify sends the user back here with a `code`, and this module
exchanges the code with the client secret, fetches the user's top artists,
stores everything, then 302s the user back to the client.

Like `apple_oauth.py`, the redirect target is *not* picked by the client
URL-side — that would be an open redirect. The client encodes a target name
(`web` or `app`) inside the OAuth `state` parameter, which Spotify echoes
back unchanged; we resolve that name against an env-configured allow-list.

Env vars:
    DUO_SPOTIFY_WEB_REDIRECT_URL  Final redirect target after a web
                                  connect. Typically the SPA root.
    DUO_SPOTIFY_APP_REDIRECT_URL  Final redirect target after a native-app
                                  connect. Must be the Universal Link /
                                  App Link the native client passes to
                                  expo-web-browser as `returnUrl`.
"""


from starlette.responses import RedirectResponse

from serviceshared import spotify
from serviceshared.database import api_tx
from serviceshared.spotify.sql import Q_TAKE_SPOTIFY_OAUTH_STATE
from serviceshared.spotify.store import store_spotify_connection
from serviceshared.util import append_query

from serviceshared.duoenv.api import (
    SPOTIFY_APP_REDIRECT_URL,
    SPOTIFY_WEB_REDIRECT_URL,
)


_REDIRECT_TARGETS = {
    'web': SPOTIFY_WEB_REDIRECT_URL,
    'app': SPOTIFY_APP_REDIRECT_URL,
}


def _resolve_target(state: str) -> str | None:
    # `state` is `<csrf-nonce>.<target>`; the nonce half is consumed
    # server-side via `Q_TAKE_SPOTIFY_OAUTH_STATE`.
    _, _, target = state.rpartition('.')
    return _REDIRECT_TARGETS.get(target) or None


def _redirect(target_url: str, **params: str) -> RedirectResponse:
    return RedirectResponse(
        append_query(target_url, params),
        status_code=302,
    )


async def handle_callback(
    *,
    code: str,
    state: str,
    error: str | None,
) -> object:
    target_url = _resolve_target(state)
    if not target_url:
        return 'Invalid Spotify authorization state', 400

    # Atomically consume the state: single-use (replay protection) and bound
    # to the person who minted it (CSRF protection).
    async with api_tx() as tx:
        cur = await tx.execute(Q_TAKE_SPOTIFY_OAUTH_STATE, dict(state=state))
        rows = await cur.fetchall()

    if not rows:
        return _redirect(target_url, spotify_error='invalid_state')

    person_id = rows[0]['person_id']

    if error:
        return _redirect(target_url, spotify_error=error)

    if not code:
        return _redirect(target_url, spotify_error='missing_code')

    tokens = await spotify.exchange_code(code)
    if tokens is None:
        return _redirect(target_url, spotify_error='exchange_failed')

    fetched = await spotify.fetch_top_artists(tokens.access_token)
    # A failed fetch still stores the tokens; the refresh cron backfills the
    # artists later.
    artists = fetched if isinstance(fetched, list) else None

    async with api_tx() as tx:
        await store_spotify_connection(tx, person_id, tokens, artists)

    return _redirect(target_url, spotify='connected')
