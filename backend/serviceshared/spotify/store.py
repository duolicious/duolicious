"""
The write paths for a person's Spotify connection. The OAuth callback
creates the connection via `store_spotify_connection`; the refresh cron goes
through `update_spotify_connection`, which is update-only so a refresh in
flight while the person disconnects (or is revoked) can't resurrect the
connection. Both replace tokens and artists in the caller's one transaction,
so they can never drift out of step with each other.
"""

import dataclasses
import json

from serviceshared.database import Tx
from serviceshared.spotify import SpotifyArtist, SpotifyTokens
from serviceshared.spotify.sql import (
    Q_SET_SPOTIFY_ARTISTS,
    Q_TOUCH_PERSON_SPOTIFY,
    Q_UPDATE_PERSON_SPOTIFY,
    Q_UPSERT_PERSON_SPOTIFY,
)


async def store_spotify_connection(
    tx: Tx,
    person_id: int,
    tokens: SpotifyTokens,
    artists: list[SpotifyArtist] | None,
) -> None:
    """Create (or replace) the connection and, when `artists` is not None,
    replace the person's artist list. `artists=None` means the fetch failed;
    the stored tokens let the cron backfill later."""
    await tx.execute(Q_UPSERT_PERSON_SPOTIFY, dict(
        person_id=person_id,
        access_token=tokens.access_token,
        expires_in=tokens.expires_in,
        refresh_token=tokens.refresh_token,
    ))

    if artists is not None:
        await _replace_artists(tx, person_id, artists)


async def update_spotify_connection(
    tx: Tx,
    person_id: int,
    tokens: SpotifyTokens | None,
    artists: list[SpotifyArtist] | None,
) -> bool:
    """Update `tokens` (or just bump `refreshed_at` when None, so the cron
    queue rotates) and, when `artists` is not None, replace the person's
    artist list. Returns False without writing anything when the person no
    longer has a connection."""
    if tokens is not None:
        cur = await tx.execute(Q_UPDATE_PERSON_SPOTIFY, dict(
            person_id=person_id,
            access_token=tokens.access_token,
            expires_in=tokens.expires_in,
            refresh_token=tokens.refresh_token,
        ))
    else:
        cur = await tx.execute(Q_TOUCH_PERSON_SPOTIFY, dict(
            person_id=person_id,
        ))

    if await cur.fetchone() is None:
        return False

    if artists is not None:
        await _replace_artists(tx, person_id, artists)

    return True


async def _replace_artists(
    tx: Tx,
    person_id: int,
    artists: list[SpotifyArtist],
) -> None:
    await tx.execute(Q_SET_SPOTIFY_ARTISTS, dict(
        person_id=person_id,
        top_artists=json.dumps([
            dataclasses.asdict(artist) for artist in artists
        ]),
    ))
