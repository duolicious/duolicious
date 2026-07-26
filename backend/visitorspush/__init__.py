import json
import traceback
import notify
from commonsql import Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME
from constants import (
    IMMEDIATE_VISITOR_NOTIFICATION_BODY,
    IMMEDIATE_VISITOR_NOTIFICATION_TITLE,
)
from database import api_tx
from pushtokens import fetch_push_tokens
from redisclient import make_redis_client
from chatprotocol.outbound import Visitor, to_bus
from unseennotificationcount import increment_unseen_notification_count
from visitorsql import (
    Q_VISITOR_ITEM,
    Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION,
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


async def notify_immediately(
    prospect_uuid: str,
    visitor_name: str,
    prospect_online: bool,
) -> None:
    """
    Push the moment the visit happens, for people who asked to hear about
    visitors immediately. Anyone no push can reach is left to the periodic
    check, which waits ten minutes and may email instead.
    """
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

            await tx.execute(
                Q_WANTS_IMMEDIATE_VISITOR_NOTIFICATION,
                dict(person_id=prospect_id))
            wants_immediate = await tx.fetchone() is not None

            # The owner's view of the visit answers both "is this worth pushing
            # live" and "is this worth notifying about", so it's fetched for
            # either, and skipped when neither applies -- it's the expensive
            # query here, and most people are on the weekly default.
            owner_item = None
            if prospect_online or wants_immediate:
                await tx.execute(Q_VISITOR_ITEM, dict(
                    person_id=prospect_id,
                    subject_person_id=viewer_id,
                    object_person_id=prospect_id,
                ))
                owner_row = await tx.fetchone()
                owner_item = owner_row.get('j') if owner_row else None

        if viewer_item:
            await _publish(viewer_uuid, 'you_visited', viewer_item)

        if owner_item and prospect_online:
            await _publish(prospect_uuid, 'visited_you', owner_item)

        # No owner item means the visitors tab won't show this visit -- the
        # visitor is invisible, skipped, shadow banned, or otherwise hidden --
        # so there's nothing to notify about and nobody to name.
        visitor_name = owner_item.get('name') if owner_item else None

        if wants_immediate and isinstance(visitor_name, str) and visitor_name:
            await notify_immediately(
                prospect_uuid=prospect_uuid,
                visitor_name=visitor_name,
                prospect_online=prospect_online,
            )
    except Exception:
        print(traceback.format_exc())
