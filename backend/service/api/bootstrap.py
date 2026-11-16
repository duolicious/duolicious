"""One-shot database bootstrap and migration for the API's `duo_api` database.

Run at deploy time via `service/api/initapi.py` (not during request serving) to
create the schema on a fresh database, apply migrations, and load the domain
and club seed data.
"""

import asyncio
import logging
import re
from pathlib import Path

import psycopg

from serviceshared.constants import (
    LAST_ONLINE_DEFAULT_NAME,
    LAST_ONLINE_DEFAULT_SECONDS,
    LAST_ONLINE_NOW_SECONDS,
)
from serviceshared.database import api_tx

logger = logging.getLogger(__name__)

_MIGRATION_LOCK_TIMEOUT_MS = 2000
_MIGRATION_ATTEMPTS = 10
_MIGRATION_RETRY_SECONDS = 3
_BACKFILL_BATCH_SIZE = 1000

_init_sql_file = (
    Path(__file__).parent.parent.parent / 'init-api.sql')

_migrations_sql_file = (
    Path(__file__).parent.parent.parent / 'migrations.sql')

_email_domains_bad_file = (
    Path(__file__).parent.parent.parent / 'email-domains-bad.sql')

_email_domains_good_file = (
    Path(__file__).parent.parent.parent / 'email-domains-good.sql')

_banned_club_file = (
    Path(__file__).parent.parent.parent / 'banned-club.sql')

_SQL_CONSTANTS = {
    'LAST_ONLINE_NOW_SECONDS': LAST_ONLINE_NOW_SECONDS,
    'LAST_ONLINE_DEFAULT_NAME': LAST_ONLINE_DEFAULT_NAME,
    'LAST_ONLINE_DEFAULT_SECONDS': LAST_ONLINE_DEFAULT_SECONDS,
}


def _read_sql(path: Path) -> str:
    sql = path.read_text()

    for name, value in _SQL_CONSTANTS.items():
        sql = sql.replace('{{' + name + '}}', str(value))

    unresolved = sorted(set(re.findall(r'\{\{(\w+)\}\}', sql)))
    if unresolved:
        raise RuntimeError(f'{path.name}: unresolved placeholders: {unresolved}')

    return sql


async def backfill_signed_in_at() -> None:
    updated = _BACKFILL_BATCH_SIZE
    while updated == _BACKFILL_BATCH_SIZE:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
            await tx.execute("""
            UPDATE duo_session
            SET signed_in_at = session_expiry - INTERVAL '6 months'
            WHERE session_token_hash IN (
                SELECT session_token_hash
                FROM duo_session
                WHERE signed_in
                AND signed_in_at IS NULL
                LIMIT %(batch_size)s
                FOR UPDATE SKIP LOCKED
            )
            """, dict(batch_size=_BACKFILL_BATCH_SIZE))
            updated = tx.rowcount


async def try_migrations(migrations_sql: str) -> None:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(
            f'SET LOCAL lock_timeout = {_MIGRATION_LOCK_TIMEOUT_MS}')
        await tx.execute(migrations_sql)


async def run_migrations(migrations_sql: str) -> None:
    for _ in range(_MIGRATION_ATTEMPTS - 1):
        try:
            return await try_migrations(migrations_sql)
        except (
            psycopg.errors.LockNotAvailable,
            psycopg.errors.DeadlockDetected,
        ):
            logger.warning('Migrations could not get a lock; retrying')
            await asyncio.sleep(_MIGRATION_RETRY_SECONDS)

    await try_migrations(migrations_sql)


async def maybe_run_init() -> None:
    async with api_tx() as tx:
        row = await tx.require_one("SELECT to_regclass('person')")

    if row ['to_regclass'] is not None:
        logger.info('Database already initialized')
        return

    init_sql_file = _read_sql(_init_sql_file)

    async with api_tx() as tx:
        await tx.execute(init_sql_file)

async def init_db() -> None:
    migrations_sql_file = _read_sql(_migrations_sql_file)

    with open(_email_domains_bad_file, 'r') as f:
        email_domains_bad_file = f.read()

    with open(_email_domains_good_file, 'r') as f:
        email_domains_good_file = f.read()

    with open(_banned_club_file, 'r') as f:
        banned_club_file = f.read()

    await maybe_run_init()

    await run_migrations(migrations_sql_file)

    await backfill_signed_in_at()

    async with api_tx() as tx:
        await tx.execute(email_domains_bad_file)

    async with api_tx() as tx:
        await tx.execute(email_domains_good_file)

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(banned_club_file)
