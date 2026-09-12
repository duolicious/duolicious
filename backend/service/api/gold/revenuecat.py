import service.api.duotypes as t
from serviceshared.database import api_tx, row_int
from serviceshared.gold import sync_gold
from service.api.auth.bearer import bearer_token
from service.api.duohash import sha512
from service.api.gold.sql import Q_SELECT_REVENUECAT_AUTHORIZED
from starlette.requests import Request

from serviceshared.gold.sql import Q_GRANT_GOLD, Q_REVOKE_GOLD


def _grants_and_revokes(
    event: t.RevenuecatEvent | None,
) -> tuple[list[str], list[str]]:
    match event:
        case (
            t.InitialPurchaseEvent(app_user_id=app_user_id) |
            t.RenewalEvent(app_user_id=app_user_id)
        ):
            return [app_user_id], []
        case t.ExpirationEvent(app_user_id=app_user_id):
            return [], [app_user_id]
        case t.TransferEvent(
                transferred_to=transferred_to,
                transferred_from=transferred_from):
            return transferred_to, transferred_from

    return [], []


async def post_revenuecat(
    req: t.PostRevenuecat,
    request: Request,
) -> tuple[str, int] | dict[str, list[str]]:
    token = bearer_token(request)

    grant_uuids, revoke_uuids = _grants_and_revokes(req.event)
    all_uuids = set(grant_uuids) | set(revoke_uuids)

    async with api_tx() as tx:
        await tx.execute(
            Q_SELECT_REVENUECAT_AUTHORIZED,
            dict(token_hash_revenuecat=sha512(token)),
        )
        if not await tx.fetchone():
            return 'Unauthorized', 401

        if not all_uuids:
            return 'Payload ignored because of its format', 200

        updated: dict[str, int] = {}
        for query, uuid in (
            [(Q_REVOKE_GOLD, u) for u in revoke_uuids] +
            [(Q_GRANT_GOLD, u) for u in grant_uuids]
        ):
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
