import json
import traceback

from database import api_tx
from service.chat.chatutil import fetch_id_from_username
from chatprotocol.outbound import Outbound, VisitorsSnapshot
from visitorsql import Q_VISITORS, Q_MARK_VISITORS_CHECKED


async def get_visitors_snapshot(username: str) -> list[Outbound]:
    try:
        person_id = await fetch_id_from_username(username)
        if person_id is None:
            return []

        async with api_tx('READ COMMITTED') as tx:
            row = await tx.require_one(Q_VISITORS, dict(person_id=person_id))

        return [VisitorsSnapshot(payload_json=json.dumps(row['j']))]
    except Exception:
        print(traceback.format_exc())
        return []


async def mark_visitors_checked(username: str, when: str | None) -> None:
    try:
        person_id = await fetch_id_from_username(username)
        if person_id is None:
            return

        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(
                Q_MARK_VISITORS_CHECKED,
                dict(person_id=person_id, when=when),
            )
    except Exception:
        print(traceback.format_exc())
