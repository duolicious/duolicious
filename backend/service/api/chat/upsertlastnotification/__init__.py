from typing import Iterable
from dataclasses import dataclass
from database import api_tx
from commonsql import (
    Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME,
    Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME,
)
from batcher import Batcher


@dataclass
class LastNotification:
    username: str
    is_intro: bool


async def execute_query(usernames: Iterable[str], is_intro: bool) -> None:
    if not usernames:
        return

    q = (
            Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME
            if is_intro
            else Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME)

    params_seq = [dict(username=username) for username in usernames]

    async with api_tx('read committed') as tx:
        await tx.executemany(q, params_seq)


async def process_batch(last_notifications: Iterable[LastNotification]) -> None:
    for is_intro in (True, False):
        usernames = set(
                n.username
                for n in last_notifications
                if n.is_intro is is_intro)

        await execute_query(usernames=usernames, is_intro=is_intro)


_batcher = Batcher[LastNotification](
    process_fn=process_batch,
    flush_interval=1.0,
    min_batch_size=1,
    max_batch_size=1000,
    retry=False,
)


def upsert_last_notification(username: str, is_intro: bool) -> None:
    _batcher.enqueue(LastNotification(username=username, is_intro=is_intro))
