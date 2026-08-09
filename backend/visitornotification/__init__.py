import logging
import notify
from commonsql import Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME
from constants import (
    IMMEDIATE_VISITOR_NOTIFICATION_BODY,
    IMMEDIATE_VISITOR_NOTIFICATION_TITLE,
)
from database import api_tx
from pushtokens import fetch_push_tokens
from unseennotificationcount import increment_unseen_notification_count
from visitorsql import (
    Q_VISITOR_ITEM,
    Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION,
)

logger = logging.getLogger(__name__)


async def _wants_immediate_notification(prospect_id: int) -> bool:
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(
            Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION,
            dict(person_id=prospect_id))

        return await tx.fetchone() is not None


async def _visitor_name(viewer_id: int, prospect_id: int) -> str | None:
    """
    The visitor's name as the prospect's own visitors tab would show it, or
    None when the tab wouldn't show the visit at all -- made invisibly, by
    somebody skipped or shadow banned, and so on. A notification about a visit
    the tab hides is one the reader can't act on.
    """
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_VISITOR_ITEM, dict(
            person_id=prospect_id,
            subject_person_id=viewer_id,
            object_person_id=prospect_id,
        ))

        row = await tx.fetchone()

    item = row.get('j') if row else None
    name = item.get('name') if item else None

    return name if isinstance(name, str) and name else None


async def _push(
    prospect_uuid: str,
    visitor_name: str,
    prospect_online: bool,
) -> None:
    tokens = await fetch_push_tokens(username=prospect_uuid)

    # No device is reachable by push, or the person was last seen on the web.
    # Leaving their visitor clock untouched hands the visit to the periodic
    # check, which emails them once it's ten minutes old.
    if not tokens:
        return

    # A push sent while the person has a client open carries no badge: they can
    # see the visit arrive in their visitors tab themselves.
    badge = (
        None
        if prospect_online
        else await increment_unseen_notification_count(username=prospect_uuid))

    for token in tokens:
        notify.enqueue_mobile_notification(
            token=token,
            title=IMMEDIATE_VISITOR_NOTIFICATION_TITLE.format(name=visitor_name),
            body=IMMEDIATE_VISITOR_NOTIFICATION_BODY,
            data={'screen': 'Home', 'params': {'screen': 'Visitors'}},
            badge=badge,
        )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(
            Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
            dict(username=prospect_uuid))


async def notify_of_visit(
    viewer_id: int,
    prospect_id: int,
    prospect_uuid: str,
    prospect_online: bool,
) -> None:
    """
    Push the moment the visit happens, for people who asked to hear about
    visitors immediately. Everyone else -- and anyone no push can reach -- is
    left to the periodic check, which waits ten minutes and may email instead.
    """
    if prospect_id == viewer_id:
        return

    try:
        # Cheapest question first: most people are on the weekly default, and
        # for them nothing else here needs asking.
        if not await _wants_immediate_notification(prospect_id):
            return

        name = await _visitor_name(viewer_id, prospect_id)

        if not name:
            return

        await _push(prospect_uuid, name, prospect_online)
    except Exception:
        logger.exception('Sending visitor notification failed')
