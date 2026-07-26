import json
import traceback
import notify
from commonsql import Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME
from constants import (
    IMMEDIATE_VISITOR_NOTIFICATION_BODY,
    IMMEDIATE_VISITOR_NOTIFICATION_TITLE,
)
from database import api_tx, row_str_or_none
from pushtokens import fetch_push_tokens
from redisclient import make_redis_client
from chatprotocol.outbound import Visitor, to_bus
from unseennotificationcount import increment_unseen_notification_count
from visitorsql import (
    Q_IMMEDIATE_VISITOR_NOTIFICATION,
    Q_VISITOR_ITEM,
)

_redis = make_redis_client()


async def _publish(channel: str, section: str, item: dict) -> None:
    try:
        await _redis.publish(
            channel,
            to_bus(Visitor(
                section=section,
                item_json=json.dumps(item),
                last_visited_at=item.get('time'),
            )),
        )
    except Exception:
        print(traceback.format_exc())


async def _immediate_visitor_name(
    viewer_id: int,
    prospect_id: int,
) -> str | None:
    """
    The visitor's name when this visit is worth pushing about right now, and
    None when it isn't.
    """
    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(
            Q_IMMEDIATE_VISITOR_NOTIFICATION,
            dict(viewer_id=viewer_id, prospect_id=prospect_id))

        row = await tx.fetchone()

    return row_str_or_none(row, 'name') if row else None


async def notify_immediately(
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
    name = await _immediate_visitor_name(viewer_id, prospect_id)

    if not name:
        return

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
            title=IMMEDIATE_VISITOR_NOTIFICATION_TITLE.format(name=name),
            body=IMMEDIATE_VISITOR_NOTIFICATION_BODY,
            data={'screen': 'Home', 'params': {'screen': 'Visitors'}},
            badge=badge,
        )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(
            Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
            dict(username=prospect_uuid))


async def publish_visit(
    viewer_id: int,
    viewer_uuid: str,
    prospect_id: int,
    prospect_uuid: str,
    prospect_online: bool,
) -> None:
    if prospect_id == viewer_id:
        return

    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_VISITOR_ITEM, dict(
                person_id=viewer_id,
                subject_person_id=viewer_id,
                object_person_id=prospect_id,
            ))
            viewer_row = await tx.fetchone()
            viewer_item = viewer_row.get('j') if viewer_row else None

            owner_item = None
            if prospect_online:
                await tx.execute(Q_VISITOR_ITEM, dict(
                    person_id=prospect_id,
                    subject_person_id=viewer_id,
                    object_person_id=prospect_id,
                ))
                owner_row = await tx.fetchone()
                owner_item = owner_row.get('j') if owner_row else None

        if viewer_item:
            await _publish(viewer_uuid, 'you_visited', viewer_item)

        if owner_item:
            await _publish(prospect_uuid, 'visited_you', owner_item)

        await notify_immediately(
            viewer_id=viewer_id,
            prospect_id=prospect_id,
            prospect_uuid=prospect_uuid,
            prospect_online=prospect_online,
        )
    except Exception:
        print(traceback.format_exc())
