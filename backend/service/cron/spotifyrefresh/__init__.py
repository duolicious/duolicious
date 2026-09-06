import asyncio
import logging
import random
from typing import Literal

from serviceshared import spotify
from serviceshared.database import Row, api_tx
from service.cron.cronutil import MAX_RANDOM_START_DELAY, log_stacktrace
from service.cron.spotifyrefresh.sql import Q_STALE_PERSON_SPOTIFY_BATCH
from serviceshared.spotify.sql import Q_DISCONNECT_SPOTIFY
from serviceshared.spotify.store import update_spotify_connection
from serviceshared.util.coerce import boolean, integer, string

from serviceshared.duoenv.cron import (
    SPOTIFY_BATCH_SIZE,
    SPOTIFY_CONCURRENCY,
    SPOTIFY_MAX_AGE_DAYS,
    SPOTIFY_POLL_SECONDS,
    SPOTIFY_RETRY_SECONDS,
)

logger = logging.getLogger(__name__)


async def _refresh_and_fetch(
    refresh_token: str,
) -> Literal['revoked'] | tuple[
    spotify.SpotifyTokens | None,
    list[spotify.SpotifyArtist] | Literal['unauthorized'] | None,
]:
    refreshed = await spotify.refresh_tokens(refresh_token)

    if refreshed == 'revoked':
        return 'revoked'

    if refreshed is None:
        # Transient refresh failure; retry after the backoff.
        return None, None

    return refreshed, await spotify.fetch_top_artists(refreshed.access_token)


async def _fetch_latest(
    row: Row,
) -> Literal['revoked'] | tuple[
    spotify.SpotifyTokens | None,
    list[spotify.SpotifyArtist] | None,
]:
    fetched_with_stored = (
        None
        if boolean(row['needs_refresh'])
        else await spotify.fetch_top_artists(string(row['access_token']))
    )

    if isinstance(fetched_with_stored, list):
        return None, fetched_with_stored

    # The stored access token is expired, was rejected, or the fetch failed.
    # A 401/403 alone doesn't prove the grant is gone (Spotify invalidates
    # access tokens early on e.g. password changes, and 403 also covers
    # dev-mode allow-list removal); only `invalid_grant` from the token
    # endpoint does. Refresh and retry before concluding anything.
    outcome = await _refresh_and_fetch(string(row['refresh_token']))

    if outcome == 'revoked':
        return 'revoked'

    tokens, fetched = outcome

    # A fetch that still fails on a just-refreshed token — even with
    # 401/403 — is anomalous, not revocation: the refresh proved the grant
    # alive. Keep the tokens and defer the artists.
    return tokens, fetched if isinstance(fetched, list) else None


async def _refresh_one_person(
    row: Row,
    semaphore: asyncio.Semaphore,
) -> None:
    person_id = integer(row['person_id'])

    # Only the Spotify calls are gated by the semaphore; the DB work either
    # side of them is cheap and benefits from running unblocked.
    async with semaphore:
        outcome = await _fetch_latest(row)

    if outcome == 'revoked':
        # Spotify policy requires deleting the user's content when
        # authorization ends, so revocation behaves exactly like
        # /disconnect-spotify.
        async with api_tx() as tx:
            await tx.execute(Q_DISCONNECT_SPOTIFY, dict(person_id=person_id))
        logger.info(f'Revoked; disconnected person {person_id}')
        return

    tokens, artists = outcome

    async with api_tx() as tx:
        stored = await update_spotify_connection(tx, person_id, tokens, artists)

    if not stored:
        logger.info(f'Person {person_id} disconnected mid-refresh; skipping')
        return

    if artists is None:
        logger.warning(f'Fetch failed for person {person_id}; deferring')
    else:
        logger.info(f'Stored {len(artists)} artists for person {person_id}')


async def refresh_spotify_once() -> None:
    async with api_tx('READ COMMITTED') as tx:
        cur = await tx.execute(Q_STALE_PERSON_SPOTIFY_BATCH, dict(
            batch_size=SPOTIFY_BATCH_SIZE,
            max_age_days=SPOTIFY_MAX_AGE_DAYS,
            retry_seconds=SPOTIFY_RETRY_SECONDS,
        ))
        rows = await cur.fetchall()

    if not rows:
        return

    semaphore = asyncio.Semaphore(SPOTIFY_CONCURRENCY)
    # return_exceptions so one person's failure doesn't cancel the others;
    # `_refresh_one_person` already handles expected Spotify errors, so
    # anything that surfaces here is unexpected and worth logging.
    results = await asyncio.gather(
        *(_refresh_one_person(row, semaphore) for row in rows),
        return_exceptions=True,
    )
    for row, res in zip(rows, results):
        if isinstance(res, BaseException):
            logger.error(
                f"Unexpected error for person {row['person_id']}",
                exc_info=res,
            )


async def refresh_spotify_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(refresh_spotify_once)
        await asyncio.sleep(SPOTIFY_POLL_SECONDS)
