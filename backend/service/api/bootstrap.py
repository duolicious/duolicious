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
from serviceshared.database import api_tx, row_int, row_int_or_none

logger = logging.getLogger(__name__)

_MIGRATION_LOCK_TIMEOUT_MS = 2000
_MIGRATION_ATTEMPTS = 10
_MIGRATION_RETRY_SECONDS = 3

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


async def backfill_required_verification_level_id() -> None:
    async with api_tx('READ COMMITTED') as tx:
        old_column = await tx.require_one("""
        SELECT count(*) AS count
        FROM pg_attribute
        WHERE attrelid = 'person'::regclass
        AND attname = 'verification_required'
        AND NOT attisdropped
        """)

    if row_int(old_column, 'count') == 0:
        logger.info('`verification_required` already dropped')
        return

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        row = await tx.require_one("""
        SELECT min(id) AS min_id, max(id) AS max_id
        FROM person
        WHERE verification_required
        AND required_verification_level_id = 1
        """)

    if row_int_or_none(row, 'max_id') is None:
        logger.info('`required_verification_level_id` already backfilled')
        return

    batch_size = 1000
    logger.info('Backfilling `required_verification_level_id`')
    for start in range(row_int(row, 'min_id'), row_int(row, 'max_id') + 1, batch_size):
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute("""
            UPDATE person
            SET required_verification_level_id = 2
            WHERE id >= %(start)s
            AND id < %(end)s
            AND verification_required
            AND required_verification_level_id = 1
            """, dict(start=start, end=start + batch_size))
    logger.info('Done backfilling `required_verification_level_id`')

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

    await backfill_required_verification_level_id()

    async with api_tx() as tx:
        await tx.execute(email_domains_bad_file)

    async with api_tx() as tx:
        await tx.execute(email_domains_good_file)

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(banned_club_file)
