import service.api.duotypes as t
from serviceshared.database import api_tx, row_int
from serviceshared.gold import sync_gold
from serviceshared.gold.sql import Q_GRANT_GOLD, Q_REVOKE_GOLD
from service.api.auth.bearer import bearer_token
from service.api.duohash import sha512
from service.api.gold.sql import Q_SELECT_REVENUECAT_AUTHORIZED
from starlette.requests import Request


def _updates(event: t.RevenuecatEvent | None) -> list[tuple[str, str]]:
    match event:
        case (
            t.InitialPurchaseEvent(app_user_id=app_user_id) |
            t.RenewalEvent(app_user_id=app_user_id)
        ):
            return [(Q_GRANT_GOLD, app_user_id)]
        case t.ExpirationEvent(app_user_id=app_user_id):
            return [(Q_REVOKE_GOLD, app_user_id)]
        case t.TransferEvent(
                transferred_to=transferred_to,
                transferred_from=transferred_from):
            return (
                [(Q_REVOKE_GOLD, uuid) for uuid in transferred_from] +
                [(Q_GRANT_GOLD, uuid) for uuid in transferred_to]
            )

    return []


async def post_revenuecat(
    req: t.PostRevenuecat,
    request: Request,
) -> tuple[str, int] | dict[str, list[str]]:
    token = bearer_token(request)
    updates = _updates(req.event)
    all_uuids = {uuid for _, uuid in updates}

    async with api_tx() as tx:
        await tx.execute(
            Q_SELECT_REVENUECAT_AUTHORIZED,
            dict(token_hash_revenuecat=sha512(token)),
        )
        if not await tx.fetchone():
            return 'Unauthorized', 401

        if not updates:
            return 'Payload ignored because of its format', 200

        updated: dict[str, int] = {}
        for query, uuid in updates:
            await tx.execute(query, dict(
                provider='revenuecat',
                provider_subscription_id=uuid,
                person_uuid=uuid,
                expires_at='infinity',
            ))
            row = await tx.fetchone()
            if row is not None:
                updated[uuid] = row_int(row, 'person_id')

        await sync_gold(tx, updated.values())

    return dict(
        all_uuids=sorted(all_uuids),
        updated_uuids=sorted(updated),
        ignored_uuids=sorted(all_uuids - updated.keys()),
    )
