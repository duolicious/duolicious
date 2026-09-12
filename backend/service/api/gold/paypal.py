import logging
from collections.abc import Iterable

from starlette.requests import Request
from starlette.responses import RedirectResponse

import service.api.duotypes as t
from serviceshared import paypal
from serviceshared.database import Tx, api_tx, row_bool, row_str
from serviceshared.gold.sql import Q_GRANT_GOLD, Q_HAS_GOLD
from serviceshared.util import Json
from serviceshared.util.coerce import integer, string
from service.api.async_lru_cache import AsyncLruCache
from service.api.auth.oauth_redirect import redirect
from service.api.gold.sql import Q_LIVE_PAYPAL_SUBSCRIPTION_IDS
from serviceshared.duoenv.api import (
    PAYPAL_APEX_REDIRECT_URL,
    PAYPAL_RETURN_URL,
    PAYPAL_WEB_REDIRECT_URL,
)

logger = logging.getLogger(__name__)

@AsyncLruCache(ttl=60 * 60, cache_condition=lambda plan: plan is not None)
async def _plan() -> paypal.PaypalPlan | None:
    return await paypal.fetch_plan()


async def get_plan() -> tuple[str, int] | dict[str, Json]:
    plan = await _plan()
    if plan is None:
        return 'PayPal request failed', 502

    return plan.model_dump()


async def live_subscription_ids(tx: Tx, person_ids: Iterable[int]) -> list[str]:
    cur = await tx.execute(
        Q_LIVE_PAYPAL_SUBSCRIPTION_IDS, dict(person_ids=list(person_ids)))
    return [row_str(r, 'provider_subscription_id') for r in await cur.fetchall()]


async def _apply(subscription: paypal.PaypalSubscription) -> bool:
    plan = await _plan()
    if plan is None:
        raise RuntimeError('PayPal plan is unavailable')

    expires_at = paypal.paid_until(subscription, plan)
    if expires_at is None:
        return False

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_GRANT_GOLD, dict(
            provider='paypal',
            provider_subscription_id=subscription.id,
            person_uuid=subscription.custom_id,
            expires_at=expires_at,
        ))
        if await tx.fetchone() is not None:
            return True

    if expires_at == 'infinity':
        logger.warning(
            f'Cancelling PayPal subscription {subscription.id}: '
            'nobody can hold it')
        await paypal.cancel_subscription(subscription.id)
    return False


async def post_subscribe(
    req: t.PostPaypalSubscribe,
    s: t.SessionInfo,
) -> tuple[str, int] | dict[str, str]:
    async with api_tx() as tx:
        row = await tx.require_one(Q_HAS_GOLD, dict(person_id=s.person_id))
    if row_bool(row, 'has_gold'):
        return 'Already subscribed', 409

    approve_url = await paypal.create_subscription(
        string(s.person_uuid),
        f'{PAYPAL_RETURN_URL}/{req.redirect_target}',
    )
    if approve_url is None:
        return 'PayPal request failed', 502

    return dict(approve_url=approve_url)


async def get_return(
    target: str,
    subscription_id: str,
) -> RedirectResponse | tuple[str, int]:
    target_url = (
        PAYPAL_WEB_REDIRECT_URL if target == 'web' else PAYPAL_APEX_REDIRECT_URL)

    if not subscription_id:
        return redirect(target_url, paypal='cancelled')

    subscription = await paypal.fetch_subscription(subscription_id)
    if subscription and subscription.status == 'APPROVAL_PENDING':
        return redirect(target_url, paypal='cancelled')

    if subscription and await _apply(subscription):
        return redirect(target_url, paypal='subscribed')

    return redirect(target_url, paypal='pending')


async def post_cancel(s: t.SessionInfo) -> tuple[str, int] | None:
    async with api_tx() as tx:
        subscription_ids = await live_subscription_ids(tx, [integer(s.person_id)])

    if not subscription_ids:
        return 'No PayPal subscription to cancel', 404

    (subscription_id,) = subscription_ids
    if not await paypal.cancel_subscription(subscription_id):
        return 'PayPal request failed', 502

    subscription = await paypal.fetch_subscription(subscription_id)
    if subscription is not None:
        await _apply(subscription)

    return None


async def post_webhook(
    req: t.PostPaypalWebhook,
    request: Request,
) -> tuple[str, int] | dict[str, bool]:
    if not await paypal.verify_webhook(request.headers, await request.json()):
        return 'Unauthorized', 401

    return dict(ignored=not await _apply(req.resource))
