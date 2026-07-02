from async_lru_cache import AsyncLruCache
from database import api_tx

# Re-exported from the dependency-light module so existing
# `from service.chat.chatutil import ...` imports keep working.
from chatprotocol.jid import (
    LSERVER,
    to_bare_jid,
)
from chatprotocol.timestamp import (
    FMT_ISO_8601_TIMESTAMP,
    format_datetime,
    format_timestamp,
    now_microseconds,
)


Q_IS_SKIPPED = """
SELECT
    1
FROM
    skipped
WHERE
    subject_person_id = %(from_id)s AND object_person_id  = %(to_id)s
OR
    subject_person_id = %(to_id)s   AND object_person_id  = %(from_id)s
"""


Q_FETCH_PERSON_ID = """
SELECT id FROM person WHERE uuid = uuid_or_null(%(username)s)
"""


Q_FETCH_HAS_GOLD = """
SELECT has_gold FROM person WHERE uuid = uuid_or_null(%(username)s)
"""


Q_FETCH_IS_SHADOW_BANNED = """
SELECT shadow_banned_at FROM person WHERE id = %(person_id)s
"""


Q_FETCH_IS_PUBLIC = """
SELECT public_profile FROM person WHERE id = %(person_id)s
"""


@AsyncLruCache(ttl=5)  # 5 seconds
async def fetch_is_skipped(from_id: int, to_id: int) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_IS_SKIPPED, dict(from_id=from_id, to_id=to_id))
        row = await tx.fetchone()

    return bool(row)


@AsyncLruCache()
async def fetch_id_from_username(username: str) -> int | None:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_PERSON_ID, dict(username=username))
        row = await tx.fetchone()

    return row.get('id') if row else None


@AsyncLruCache(ttl=5)  # 5 seconds
async def fetch_is_shadow_banned(person_id: int) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_IS_SHADOW_BANNED, dict(person_id=person_id))
        row = await tx.fetchone()

    return bool(row and row.get('shadow_banned_at'))


@AsyncLruCache(ttl=5)  # 5 seconds
async def fetch_is_public(person_id: int) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_IS_PUBLIC, dict(person_id=person_id))
        row = await tx.fetchone()

    return bool(row and row.get('public_profile'))


@AsyncLruCache(ttl=60)  # 60 seconds
async def fetch_has_gold(username: str) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_HAS_GOLD, dict(username=username))
        row = await tx.fetchone()

    return bool(row and row.get('has_gold'))
