import redis.asyncio as redis
import traceback
from service.api.chat.chatutil import (
    fetch_is_public,
    fetch_is_skipped,
    fetch_id_from_username,
    redis_has_subscribers,
)
from enum import Enum
from commonsql import Q_UPDATE_LAST
from batcher import Batcher
from service.api.chat.session import Session
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

_TEST_INPUT_DIR = Path(__file__).parents[4] / 'test' / 'input'


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


Q_UPDATE_CAME_ONLINE = """
UPDATE
    person
SET
    came_online_time = NOW(),
    unseen_notification_count = 0
WHERE
    uuid = %(person_uuid)s
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

    stored: OnlineEvent | None = None

    if isinstance(val, str):
        try:
            event = from_bus(val)
            if isinstance(event, OnlineEvent):
                stored = event
        except Exception:
            pass

    if stored is None:
        return OnlineEvent(username=username, status=OnlineStatus.OFFLINE.value)

    # The stored status can misreport whether the user is connected *right
    # now*: a crashed worker never demotes 'online' (the key just expires,
    # ONLINE_RECENTLY_SECONDS later). Whether any of the user's websocket
    # connections is subscribed to their username channel is authoritative --
    # it's the same subscription message delivery uses, and Redis drops it
    # when a connection dies -- so it decides between 'online' and
    # 'online-recently'. The stored event then only attests that the user was
    # seen within the last ONLINE_RECENTLY_SECONDS. Pushed OnlineEvents need
    # no such correction: connection lifecycle emits them, and the disconnect
    # path performs this same subscriber check so a multi-device user stays
    # 'online' until their last connection drops.
    status = (
        OnlineStatus.ONLINE.value
        if await redis_has_subscribers(redis_client, username)
        else OnlineStatus.ONLINE_RECENTLY.value)

    return OnlineEvent(username=username, status=status)


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


async def update_came_online_if_first_client(
    redis_client: redis.Redis,
    session: Session,
) -> None:
    """
    Stamp `person.came_online_time` and zero the unseen-notification count (the
    app-icon badge) if this session's user is going from zero connected clients
    to one. Zeroing only on that transition is enough in practice: the count
    only increments while the user has no connected clients, so it stays zero
    while another client is connected — except when a notification's
    subscriber check races a connecting client and the increment lands just
    after the zeroing. Such a leftover survives until the next zero-to-one
    transition, which the badge's best-effort precision tolerates; don't build
    on the count being exactly zero while a client is connected. Must run when
    a connection authenticates, before the connection subscribes to its own
    username channel, since that subscription is what counts as a connected
    client.
    """
    if session.username is None:
        return

    if await redis_has_subscribers(redis_client, session.username):
        return

    async with api_tx('read committed') as tx:
        await tx.execute(
            Q_UPDATE_CAME_ONLINE,
            dict(person_uuid=session.username))


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
