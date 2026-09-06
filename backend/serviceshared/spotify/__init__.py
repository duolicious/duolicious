"""
Spotify Web API client for the "top artists on profiles" integration.

The OAuth flow is backend-callback: the client never sees the client ID or
secret. `build_authorize_url` mints the URL the user is sent to;
`exchange_code` / `refresh_tokens` talk to Spotify's token endpoint with the
client secret; `fetch_top_artists` reads the user's top artists with the
`user-top-read` scope.

The authorize/token/API base URLs are overridable so the functional tests can
point them at the `spotifymock` service (same pattern as
`DUO_NOTIFICATION_API_URL` -> pushmock).
"""

import base64
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlencode

import httpx

from serviceshared.httpxclient import make_http_client
from serviceshared.util.coerce import mapping, mapping_sequence, mapping_sequence_or_empty

from serviceshared.duoenv.shared import (
    SPOTIFY_API_URL,
    SPOTIFY_AUTHORIZE_URL,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI,
    SPOTIFY_TOKEN_URL,
)

TOP_ARTISTS_LIMIT = 10

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SpotifyTokens:
    access_token: str
    expires_in: int
    refresh_token: str


@dataclass(frozen=True)
class SpotifyArtist:
    spotify_id: str
    name: str
    image_url_small: str | None
    image_url_large: str | None


def _basic_auth_header() -> str:
    credentials = f'{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}'
    return 'Basic ' + base64.b64encode(credentials.encode()).decode()


def build_authorize_url(state: str) -> str:
    return SPOTIFY_AUTHORIZE_URL + '?' + urlencode(dict(
        client_id=SPOTIFY_CLIENT_ID,
        response_type='code',
        redirect_uri=SPOTIFY_REDIRECT_URI,
        scope='user-top-read',
        state=state,
    ))


def _parse_tokens(
    data: Mapping[str, object],
    fallback_refresh_token: str | None = None,
) -> SpotifyTokens | None:
    access_token = data.get('access_token')
    expires_in = data.get('expires_in')
    refresh_token = data.get('refresh_token') or fallback_refresh_token

    if not isinstance(access_token, str) or not access_token:
        return None
    if not isinstance(expires_in, int):
        return None
    if not isinstance(refresh_token, str) or not refresh_token:
        return None

    return SpotifyTokens(
        access_token=access_token,
        expires_in=expires_in,
        refresh_token=refresh_token,
    )


async def _post_token_request(
    form: dict[str, str],
) -> tuple[int, Mapping[str, object]] | None:
    try:
        async with make_http_client() as client:
            resp = await client.post(
                SPOTIFY_TOKEN_URL,
                data=form,
                headers={'Authorization': _basic_auth_header()},
            )
        data = mapping(resp.json())
    except (httpx.HTTPError, ValueError, RuntimeError) as e:
        logger.warning(f'Spotify token request failed: {e}')
        return None

    if data.get('error') == 'invalid_client':
        # Bad DUO_SPOTIFY_CLIENT_ID/SECRET can never succeed on retry, but
        # every caller treats a failed request as transient — make the
        # misconfiguration loud.
        logger.error('Spotify rejected the client credentials')

    return resp.status_code, data


async def exchange_code(code: str) -> SpotifyTokens | None:
    response = await _post_token_request(dict(
        grant_type='authorization_code',
        code=code,
        redirect_uri=SPOTIFY_REDIRECT_URI,
    ))

    if response is None:
        return None

    status_code, data = response

    if status_code != 200:
        logger.warning(f'Spotify code exchange returned HTTP {status_code}: {data}')
        return None

    return _parse_tokens(data)


async def refresh_tokens(
    refresh_token: str,
) -> SpotifyTokens | Literal['revoked'] | None:
    response = await _post_token_request(dict(
        grant_type='refresh_token',
        refresh_token=refresh_token,
    ))

    if response is None:
        return None

    status_code, data = response

    if data.get('error') == 'invalid_grant':
        return 'revoked'

    if status_code != 200:
        logger.warning(f'Spotify token refresh returned HTTP {status_code}: {data}')
        return None

    # Spotify may omit refresh_token on refresh; keep using the old one.
    return _parse_tokens(data, fallback_refresh_token=refresh_token)


def _pick_image_url(
    images: object,
    min_dimension: int,
) -> str | None:
    candidates = []
    for image in mapping_sequence_or_empty(images):
        url = image.get('url')
        height = image.get('height')
        width = image.get('width')
        if not isinstance(url, str) or not url:
            continue
        if not isinstance(height, int) or not isinstance(width, int):
            continue
        candidates.append((min(height, width), url))

    if not candidates:
        return None

    big_enough = [c for c in candidates if c[0] >= min_dimension]

    if big_enough:
        return min(big_enough)[1]

    return max(candidates)[1]


def _parse_artist(item: Mapping[str, object]) -> SpotifyArtist | None:
    spotify_id = item.get('id')
    name = item.get('name')

    if not isinstance(spotify_id, str) or not spotify_id:
        return None
    if not isinstance(name, str) or not name:
        return None

    return SpotifyArtist(
        spotify_id=spotify_id,
        name=name,
        image_url_small=_pick_image_url(item.get('images'), 160),
        image_url_large=_pick_image_url(item.get('images'), 320),
    )


async def fetch_top_artists(
    access_token: str,
) -> list[SpotifyArtist] | Literal['unauthorized'] | None:
    url = (
        f'{SPOTIFY_API_URL}/v1/me/top/artists'
        f'?limit={TOP_ARTISTS_LIMIT}&time_range=medium_term'
    )

    try:
        async with make_http_client() as client:
            resp = await client.get(
                url,
                headers={'Authorization': f'Bearer {access_token}'},
            )
    except httpx.HTTPError as e:
        logger.warning(f'Spotify top-artists request failed: {e}')
        return None

    if resp.status_code in (401, 403):
        return 'unauthorized'

    if resp.status_code != 200:
        logger.warning(f'Spotify top-artists returned HTTP {resp.status_code}')
        return None

    try:
        items = mapping_sequence(mapping(resp.json()).get('items'))
    except (ValueError, RuntimeError) as e:
        logger.warning(f'Spotify top-artists response is malformed: {e}')
        return None

    artists = []
    for item in items:
        artist = _parse_artist(item)
        if artist is None:
            # One unparseable artist marks the whole response malformed:
            # storing a partial (or empty) list would wipe good rows, while
            # keeping the stale list lets a later refresh repair it.
            logger.warning('Spotify top-artists item is malformed')
            return None
        artists.append(artist)

    return artists
