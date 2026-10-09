"""One-shot database bootstrap and migration for the API's `duo_api` database.

Run at deploy time via `service/api/initapi.py` (not during request serving) to
create the schema on a fresh database, apply migrations, load the domain and
club seed data, and backfill normalized emails.
"""

import logging
import re
from pathlib import Path

from serviceshared.antiabuse.antispam.signupemail import normalize_email
from serviceshared.constants import (
    LAST_ONLINE_DEFAULT_NAME,
    LAST_ONLINE_DEFAULT_SECONDS,
    LAST_ONLINE_NOW_SECONDS,
)
from serviceshared.database import (
    api_autocommit,
    api_tx,
    require_row,
    row_bool,
    row_int,
    row_int_or_none,
)

logger = logging.getLogger(__name__)

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


async def migrate_unnormalized_emails() -> None:
    """
    It'll probably be necessary to call this function again if/when
    `normalize_email` normalizes more address.
    """
    async with api_tx() as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        q = "SELECT 1 FROM person WHERE normalized_email ILIKE '%@googlemail.com' LIMIT 1"
        await tx.execute(q)
        if await tx.fetchone():
            logger.info('Unnormalized emails found. Normalizing...')
        else:
            logger.info('Emails already normalized. Not performing normalization.')
            return

    async with api_tx() as tx:
        logger.info('Selecting emails')
        q = "SELECT email FROM person"
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(q)
        rows = await tx.fetchall()
        logger.info('Done selecting emails')

    logger.info('Computing normalized emails')
    params_seq = [
        row | dict(normalized_email=normalize_email(row['email']))
        for row in rows
    ]
    logger.info('Done computing normalized emails')

    async with api_tx('read committed') as tx:
        q = """
        UPDATE person SET
        normalized_email = %(normalized_email)s
        WHERE email = %(email)s
        """
        logger.info('Updating normalized emails in `person` table')
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.executemany(q, params_seq)
        logger.info('Done updating normalized emails in `person` table')

        q = """
        UPDATE banned_person bp
        SET
            normalized_email = %(normalized_email)s
        WHERE
            normalized_email = %(email)s
        AND NOT EXISTS (
            SELECT
                1
            FROM
                banned_person
            WHERE
                normalized_email = %(normalized_email)s
            AND
                ip_address = bp.ip_address
        )
        """
        logger.info('Updating normalized emails in `banned_person` table')
        await tx.executemany(q, params_seq)
        logger.info('Done updating normalized emails in `banned_person` table')

async def backfill_looking_for_ids() -> None:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        row = await tx.require_one("""
        SELECT min(id) AS min_id, max(id) AS max_id
        FROM person
        WHERE looking_for_id <> 1
        AND looking_for_ids = '{1}'
        """)

    if row_int_or_none(row, 'max_id') is None:
        logger.info('`looking_for_ids` already backfilled')
        return

    batch_size = 1000
    logger.info('Backfilling `looking_for_ids`')
    for start in range(row_int(row, 'min_id'), row_int(row, 'max_id') + 1, batch_size):
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute("""
            UPDATE person
            SET looking_for_ids = ARRAY[looking_for_id]
            WHERE id >= %(start)s
            AND id < %(end)s
            AND looking_for_id <> 1
            AND looking_for_ids = '{1}'
            """, dict(start=start, end=start + batch_size))
    logger.info('Done backfilling `looking_for_ids`')

async def replace_club_name_trigram_index() -> None:
    async with api_autocommit() as conn:
        await conn.execute('SET statement_timeout = 300000')

        locked = await conn.execute(
            "SELECT pg_try_advisory_lock(hashtext('idx__club__name__trgm')) AS x")
        if not row_bool(require_row(await locked.fetchone()), 'x'):
            logger.info('Another instance is replacing `idx__club__name`')
            return

        invalid = await conn.execute("""
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass('idx__club__name__trgm')
        AND NOT indisvalid
        """)
        if await invalid.fetchone():
            await conn.execute('DROP INDEX CONCURRENTLY idx__club__name__trgm')

        await conn.execute("""
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx__club__name__trgm
            ON club USING GIST((name COLLATE "C") gist_trgm_ops)
            WHERE count_members > 0
        """)
        await conn.execute('DROP INDEX CONCURRENTLY IF EXISTS idx__club__name')

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

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(migrations_sql_file)

    await replace_club_name_trigram_index()

    async with api_tx() as tx:
        await tx.execute(email_domains_bad_file)

    async with api_tx() as tx:
        await tx.execute(email_domains_good_file)

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(banned_club_file)

    await migrate_unnormalized_emails()

    await backfill_looking_for_ids()
