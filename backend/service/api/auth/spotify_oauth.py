from urllib.parse import urlencode

from starlette.responses import RedirectResponse

from serviceshared import spotify
from serviceshared.database import api_tx
from serviceshared.duoenv.spotify import SPOTIFY_CLIENT_ID
from serviceshared.util import append_query
from serviceshared.util.coerce import integer

from serviceshared.spotify.sql import (
    Q_TAKE_SPOTIFY_OAUTH_STATE,
    Q_UPSERT_PERSON_SPOTIFY,
)

from serviceshared.duoenv.api import (
    SPOTIFY_APP_REDIRECT_URL,
    SPOTIFY_AUTHORIZE_URL,
    SPOTIFY_REDIRECT_URI,
    SPOTIFY_WEB_REDIRECT_URL,
)


_REDIRECT_TARGETS = {
    'web': SPOTIFY_WEB_REDIRECT_URL,
    'app': SPOTIFY_APP_REDIRECT_URL,
}


def build_authorize_url(state: str) -> str:
    return SPOTIFY_AUTHORIZE_URL + '?' + urlencode(dict(
        client_id=SPOTIFY_CLIENT_ID,
        response_type='code',
        redirect_uri=SPOTIFY_REDIRECT_URI,
        scope='user-top-read',
        state=state,
    ))


def _resolve_target(state: str) -> str | None:
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

    async with api_tx() as tx:
        cur = await tx.execute(Q_TAKE_SPOTIFY_OAUTH_STATE, dict(state=state))
        row = await cur.fetchone()

    if row is None:
        return _redirect(target_url, spotify_error='invalid_state')

    if error:
        return _redirect(target_url, spotify_error=error)

    if not code:
        return _redirect(target_url, spotify_error='missing_code')

    tokens = await spotify.exchange_code(code, SPOTIFY_REDIRECT_URI)
    if tokens is None:
        return _redirect(target_url, spotify_error='exchange_failed')

    artists = await spotify.fetch_top_artists(tokens.access_token)

    async with api_tx() as tx:
        cur = await tx.execute(Q_UPSERT_PERSON_SPOTIFY, dict(
            person_id=integer(row['person_id']),
            refresh_token=tokens.refresh_token,
            top_artists=spotify.artists_json(artists),
        ))
        stored = await cur.fetchone()

    if stored is None:
        return _redirect(target_url, spotify_error='invalid_state')

    return _redirect(target_url, spotify='connected')
