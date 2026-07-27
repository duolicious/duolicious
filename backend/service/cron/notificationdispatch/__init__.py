from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from database import api_tx
from service.cron.cronutil import (
    DISABLE_MOBILE_NOTIFICATIONS_FILE,
    MAX_RANDOM_START_DELAY,
    disable_mobile_notifications,
    print_stacktrace,
)
from smtp import make_aws_smtp
from typing import Generic, Protocol, TypeVar
from unseennotificationcount import increment_unseen_notification_count
from util import Json
import asyncio
import notify
import random

class NotificationRow(Protocol):
    person_uuid: str
    email: str
    token: str | None

N = TypeVar('N', bound=NotificationRow)

@dataclass(frozen=True)
class NotificationKind(Generic[N]):
    name: str
    query: str
    row_type: type[N]
    poll_seconds: int
    subject: str
    screen: Json
    is_sendable: Callable[[N], bool]
    push_body: Callable[[N], str]
    email_body: Callable[[N], str]
    update_last_notification_time: Callable[[N], Awaitable[None]]

def do_send_email_notification(kind: NotificationKind[N], row: N) -> bool:
    is_example = row.email.lower().endswith('@example.com')

    return kind.is_sendable(row) and not is_example

async def send_email_notification(kind: NotificationKind[N], row: N) -> None:
    if not do_send_email_notification(kind, row):
        print('Email notification failed because it ends with @example.com')
        return

    subject = kind.subject
    body = kind.email_body(row)
    to_addr = row.email

    aws_smtp = make_aws_smtp()
    def send() -> None:
        aws_smtp.send(subject=subject, body=body, to_addr=to_addr)

    await asyncio.to_thread(send)

def send_mobile_notification(
    kind: NotificationKind[N],
    row: N,
    badge: int | None,
) -> None:
    if disable_mobile_notifications():
        print(
            'File prevented mobile notifications',
            str(DISABLE_MOBILE_NOTIFICATIONS_FILE.absolute())
        )
    else:
        notify.enqueue_mobile_notification(
            token=row.token,
            title=kind.subject,
            body=kind.push_body(row),
            data=kind.screen,
            badge=badge,
        )

async def compute_badges(
    kind: NotificationKind[N],
    rows: list[N],
) -> dict[str, int | None]:
    """
    A pending-notifications query fans a person out into one row per push
    token, but the unseen-notification count (the app-icon badge) must
    increment once per person, not once per device, so every device shows the
    same badge. The conditions here mirror the ones under which
    `maybe_send_notification` sends a push rather than an email or nothing.
    """
    badges: dict[str, int | None] = {}

    for row in rows:
        if not row.token:
            continue
        if not kind.is_sendable(row):
            continue
        if row.person_uuid in badges:
            continue

        badges[row.person_uuid] = await increment_unseen_notification_count(
                username=row.person_uuid)

    return badges

async def send_notification(
    kind: NotificationKind[N],
    row: N,
    badge: int | None,
) -> None:
    if not row.token:
        print(f'Sending {kind.name} email notification:', str(row))
        return await send_email_notification(kind, row)

    print(f'Sending {kind.name} mobile notification:', str(row))
    send_mobile_notification(kind, row, badge=badge)

async def maybe_send_notification(
    kind: NotificationKind[N],
    row: N,
    badge: int | None,
) -> None:
    if not kind.is_sendable(row):
        return

    await send_notification(kind, row, badge)
    await kind.update_last_notification_time(row)

async def send_pending_notifications_once(kind: NotificationKind[N]) -> None:
    async with api_tx('read committed') as tx:
        await tx.execute('SET LOCAL statement_timeout = 15000') # 15 seconds
        cur = await tx.execute(kind.query)
        rows = await cur.fetchall()

    parsed = [kind.row_type(**j) for j in rows]

    badges = await compute_badges(kind, parsed)

    for row in parsed:
        await maybe_send_notification(kind, row, badges.get(row.person_uuid))

async def send_pending_notifications_forever(kind: NotificationKind[N]) -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await print_stacktrace(
            lambda: send_pending_notifications_once(kind))
        await asyncio.sleep(kind.poll_seconds)
