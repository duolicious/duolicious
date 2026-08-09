import redis.asyncio as redis

from async_lru_cache import AsyncLruCache
from collections.abc import Iterable
from database import api_tx

# Re-exported from the dependency-light module so existing
# `from service.api.chat.chatutil import ...` imports keep working.
from chatprotocol.jid import (
    LSERVER,
    to_bare_jid,
)
from chatprotocol.outbound import (
    Outbound,
    to_bus,
)
from chatprotocol.timestamp import (
    FMT_ISO_8601_TIMESTAMP,
    format_datetime,
    format_timestamp,
    now_microseconds,
)


from duoenv.api import REDIS_HOST, REDIS_PORT
REDIS_WORKER_CLIENT: redis.Redis = redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        decode_responses=True)


async def redis_publish(channel: str, message: str) -> None:
    await REDIS_WORKER_CLIENT.publish(channel, message)


async def redis_publish_many(
    channel: str,
    messages: Iterable[Outbound],
) -> object | None:
    for message in messages:
        await redis_publish(channel, to_bus(message))
    return None


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


Q_FETCH_HIDES_ONLINE_STATUS = """
SELECT show_my_online_status FROM person WHERE id = %(person_id)s
"""


async def redis_has_subscribers(
    redis_client: redis.Redis,
    channel: str,
) -> bool:
    """
    True when at least one websocket connection (on any chat worker; they all
    share one Redis) is subscribed to `channel`.
    """
    [(_, count)] = await redis_client.pubsub_numsub(channel)
    return count > 0


async def is_online(username: str, has_subscribers: bool | None) -> bool:
    if has_subscribers is not None:
        return has_subscribers

    return await redis_has_subscribers(REDIS_WORKER_CLIENT, username)


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


@AsyncLruCache(ttl=5)  # 5 seconds
async def fetch_hides_online_status(person_id: int) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_HIDES_ONLINE_STATUS, dict(person_id=person_id))
        row = await tx.fetchone()

    return row is not None and not row.get('show_my_online_status')


@AsyncLruCache(ttl=60)  # 60 seconds
async def fetch_has_gold(username: str) -> bool:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_HAS_GOLD, dict(username=username))
        row = await tx.fetchone()

    return bool(row and row.get('has_gold'))
