import redis.asyncio as redis
import traceback
from service.chat.chatutil import (
    fetch_is_public,
    fetch_is_skipped,
    fetch_id_from_username,
)
from enum import Enum
from commonsql import Q_UPDATE_LAST
from batcher import Batcher
from service.chat.session import Session
from chatprotocol.outbound import (
    OnlineEvent,
    Outbound,
    SubscribeBad,
    SubscribeOk,
    UnsubscribeBad,
    UnsubscribeOk,
    from_bus,
    to_bus,
)
from database import api_tx
import asyncio
import time
from functools import lru_cache
from pathlib import Path
from dataclasses import dataclass
from constants import (
    LAST_UPDATE_INTERVAL_SECONDS,
    MAX_ONLINE_SUBSCRIPTIONS,
    ONLINE_RECENTLY_SECONDS,
)

_TEST_INPUT_DIR = Path(__file__).parents[3] / 'test' / 'input'


def _read_test_input(name: str) -> str | None:
    try:
        return (_TEST_INPUT_DIR / name).read_text().strip()
    except:
        return None


@lru_cache(maxsize=1)
def _max_online_subscriptions(ttl_hash: int) -> int:
    if _read_test_input('enable-mocking') != '1':
        return MAX_ONLINE_SUBSCRIPTIONS

    override = _read_test_input('max-online-subscriptions')

    try:
        return MAX_ONLINE_SUBSCRIPTIONS if override is None else int(override)
    except ValueError:
        return MAX_ONLINE_SUBSCRIPTIONS


def max_online_subscriptions() -> int:
    return _max_online_subscriptions(ttl_hash=round(time.time()))

FMT_KEY = 'online-{username}'


class OnlineStatus(Enum):
    ONLINE = 'online'
    ONLINE_RECENTLY = 'online-recently'
    OFFLINE = 'offline'


Q_UPDATE_SESSION_LAST_ONLINE = """
UPDATE
    duo_session
SET
    last_online_time = NOW()
WHERE
    session_token_hash = %(session_token_hash)s
"""


@dataclass(frozen=True)
class UpdateLastJob:
    session_username: str
    session_token_hash: str
    do_update_last_event: bool


async def _redis_subscribe_online(
    redis_client: redis.Redis,
    pubsub: redis.client.PubSub,
    username: str,
) -> OnlineEvent:
    key = FMT_KEY.format(username=username)
    val = await redis_client.get(key)

    await pubsub.subscribe(key)

    if isinstance(val, bytes):
        val = val.decode()

    if isinstance(val, str):
        try:
            event = from_bus(val)
            if isinstance(event, OnlineEvent):
                return event
        except Exception:
            pass

    return OnlineEvent(username=username, status=OnlineStatus.OFFLINE.value)


async def _redis_unsubscribe_online(
    pubsub: redis.client.PubSub,
    username: str,
) -> None:
    key = FMT_KEY.format(username=username)
    await pubsub.unsubscribe(key)

async def redis_publish_online(
    redis_client: redis.Redis,
    username: str,
    online: bool
) -> None:
    status = (
        OnlineStatus.ONLINE.value
        if online
        else OnlineStatus.ONLINE_RECENTLY.value)

    key = FMT_KEY.format(username=username)
    val = to_bus(OnlineEvent(username=username, status=status))

    async with redis_client.pipeline(transaction=True) as pipe:
        pipe.publish(key, val)
        pipe.set(key, val, ex=ONLINE_RECENTLY_SECONDS)
        await pipe.execute()

async def should_subscribe(from_username: str | None, to_username: str) -> bool:
    if from_username is None:
        to_id = await fetch_id_from_username(to_username)

        return (
                to_id is not None and
                await fetch_is_public(to_id))
    else:
        from_id, to_id = (
                await fetch_id_from_username(from_username),
                await fetch_id_from_username(to_username))

        return (
                from_id is not None and
                to_id is not None and
                not await fetch_is_skipped(
                    from_id=from_id, to_id=to_id))


async def _evict_oldest_online_subscriptions(
    pubsub: redis.client.PubSub,
    session: Session,
    limit: int,
) -> None:
    # Unsubscribe the earliest subscriptions until there's room for one more.
    while (
        session.online_subscriptions and
        len(session.online_subscriptions) >= limit
    ):
        oldest = next(iter(session.online_subscriptions))
        del session.online_subscriptions[oldest]
        await _redis_unsubscribe_online(pubsub=pubsub, username=oldest)


async def maybe_redis_subscribe_online(
    from_username: str | None,
    to_username: str,
    redis_client: redis.Redis,
    pubsub: redis.client.PubSub,
    session: Session,
) -> list[Outbound]:
    try:
        if not await should_subscribe(
                from_username=from_username,
                to_username=to_username):
            return [SubscribeBad(username=to_username)]

        if to_username not in session.online_subscriptions:
            await _evict_oldest_online_subscriptions(
                    pubsub=pubsub,
                    session=session,
                    limit=max_online_subscriptions())
            session.online_subscriptions[to_username] = None

        return [
            SubscribeOk(username=to_username),
            await _redis_subscribe_online(
                    redis_client=redis_client,
                    pubsub=pubsub,
                    username=to_username),
        ]
    except:
        print(traceback.format_exc())
        return [SubscribeBad(username=to_username)]


async def maybe_redis_unsubscribe_online(
    username: str,
    pubsub: redis.client.PubSub,
    session: Session,
) -> list[Outbound]:
    try:
        session.online_subscriptions.pop(username, None)

        await _redis_unsubscribe_online(
                pubsub=pubsub,
                username=username)

        return [UnsubscribeOk(username=username)]
    except:
        print(traceback.format_exc())
        return [UnsubscribeBad(username=username)]



async def process_batch(jobs: list[UpdateLastJob]) -> None:
    update_last_params_seq = [
        dict(person_uuid=job.session_username)
        for job in jobs
    ]

    session_params_seq = [
        dict(session_token_hash=job.session_token_hash)
        for job in jobs
    ]

    async with api_tx('read committed') as tx:
        await tx.executemany(Q_UPDATE_LAST, update_last_params_seq)
        await tx.executemany(Q_UPDATE_SESSION_LAST_ONLINE, session_params_seq)


def update_last_once(
    session_username: str,
    session_token_hash: str,
    do_update_last_event: bool,
) -> None:
    _batcher.enqueue(
        UpdateLastJob(
            session_username=session_username,
            session_token_hash=session_token_hash,
            do_update_last_event=do_update_last_event,
        )
    )


async def update_online_once(
    redis_client: redis.Redis,
    session: Session,
    online: bool,
    do_update_last_event: bool = False,
) -> None:
    if session.username is None or session.session_token_hash is None:
        return

    update_last_once(
        session_username=session.username,
        session_token_hash=session.session_token_hash,
        do_update_last_event=do_update_last_event,
    )

    await redis_publish_online(
        redis_client=redis_client,
        username=session.username,
        online=online,
    )


async def update_online_forever(
    redis_client: redis.Redis,
    session: Session,
    online: bool
) -> None:
    try:
        await update_online_once(
            redis_client=redis_client,
            session=session,
            online=online,
            do_update_last_event=True,
        )

        while True:
            await asyncio.sleep(LAST_UPDATE_INTERVAL_SECONDS)

            await update_online_once(
                redis_client=redis_client,
                session=session,
                online=online,
            )
    except asyncio.exceptions.CancelledError:
        pass
    except:
        print(traceback.format_exc())
        raise


_batcher = Batcher[UpdateLastJob](
    process_fn=process_batch,
    flush_interval=1.0,
    min_batch_size=1,
    max_batch_size=1000,
    retry=False,
)
