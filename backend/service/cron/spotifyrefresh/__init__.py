import asyncio
import logging
import random

from serviceshared import spotify
from serviceshared.database import Row, api_tx
from service.cron.cronutil import MAX_RANDOM_START_DELAY, log_stacktrace
from service.cron.spotifyrefresh.sql import Q_STALE_PERSON_SPOTIFY_BATCH
from serviceshared.util.coerce import integer, string

from serviceshared.spotify.sql import (
    Q_DISCONNECT_SPOTIFY,
    Q_UPDATE_PERSON_SPOTIFY,
)

from serviceshared.duoenv.cron import (
    SPOTIFY_BATCH_SIZE,
    SPOTIFY_CONCURRENCY,
    SPOTIFY_MAX_AGE_DAYS,
    SPOTIFY_POLL_SECONDS,
    SPOTIFY_RETRY_SECONDS,
)

logger = logging.getLogger(__name__)


async def _refresh_one_person(
    row: Row,
    semaphore: asyncio.Semaphore,
) -> None:
    person_id = integer(row['person_id'])

    async with semaphore:
        tokens = await spotify.refresh_tokens(string(row['refresh_token']))
        artists = (
            await spotify.fetch_top_artists(tokens.access_token)
            if isinstance(tokens, spotify.SpotifyTokens)
            else None
        )

    if tokens == 'revoked':
        async with api_tx() as tx:
            await tx.execute(Q_DISCONNECT_SPOTIFY, dict(person_id=person_id))
        logger.info(f'Revoked; disconnected person {person_id}')
        return

    async with api_tx() as tx:
        cur = await tx.execute(Q_UPDATE_PERSON_SPOTIFY, dict(
            person_id=person_id,
            refresh_token=tokens.refresh_token if tokens else None,
            top_artists=spotify.artists_json(artists),
        ))
        stored = await cur.fetchone()

    if stored is None:
        logger.info(f'Person {person_id} disconnected mid-refresh; skipping')
    elif artists is None:
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

    semaphore = asyncio.Semaphore(SPOTIFY_CONCURRENCY)
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
