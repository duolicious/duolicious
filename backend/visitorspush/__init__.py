import json
import traceback
from database import api_tx
from redisclient import make_redis_client
from chatprotocol.outbound import Visitor, to_bus
from visitorsql import Q_VISITOR_ITEM

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
            viewer_row_tx = await tx.execute(Q_VISITOR_ITEM, dict(
                person_id=viewer_id,
                subject_person_id=viewer_id,
                object_person_id=prospect_id,
            ))
            viewer_row = await viewer_row_tx.fetchone()
            viewer_item = viewer_row.get('j') if viewer_row else None

            owner_item = None
            if prospect_online:
                owner_row_tx = await tx.execute(Q_VISITOR_ITEM, dict(
                    person_id=prospect_id,
                    subject_person_id=viewer_id,
                    object_person_id=prospect_id,
                ))
                owner_row = await owner_row_tx.fetchone()
                owner_item = owner_row.get('j') if owner_row else None

        if viewer_item:
            await _publish(viewer_uuid, 'you_visited', viewer_item)

        if owner_item:
            await _publish(prospect_uuid, 'visited_you', owner_item)
    except Exception:
        print(traceback.format_exc())
