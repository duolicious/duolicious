import logging
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Annotated, Literal, TypeVar
from urllib.parse import quote

import httpx
from dateutil.relativedelta import relativedelta
from pydantic import AfterValidator, BaseModel, Field

from serviceshared.httpxclient import make_http_client
from serviceshared.util import Json

from serviceshared.duoenv.api import (
    PAYPAL_API_URL,
    PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET,
    PAYPAL_PLAN_ID,
    PAYPAL_WEBHOOK_ID,
)

logger = logging.getLogger(__name__)

T = TypeVar('T', bound=BaseModel)

UtcTime = Annotated[
    datetime,
    AfterValidator(lambda t: t.astimezone(timezone.utc).replace(tzinfo=None)),
]


class _LastPayment(BaseModel):
    time: UtcTime


class _BillingInfo(BaseModel):
    last_payment: _LastPayment | None = None


class PaypalSubscription(BaseModel):
    id: str
    status: Literal[
        'APPROVAL_PENDING',
        'APPROVED',
        'ACTIVE',
        'SUSPENDED',
        'CANCELLED',
        'EXPIRED',
    ]
    custom_id: str | None = None
    start_time: UtcTime | None = None
    billing_info: _BillingInfo = _BillingInfo()


class PaypalInterval(BaseModel):
    units: int
    unit: str


class _Frequency(BaseModel):
    interval_unit: Literal['DAY', 'WEEK', 'MONTH', 'YEAR']
    interval_count: int

    def interval(self, cycles: int = 1) -> PaypalInterval:
        return PaypalInterval(
            units=self.interval_count * cycles,
            unit=self.interval_unit.lower(),
        )


class _TrialCycle(BaseModel):
    tenure_type: Literal['TRIAL']
    total_cycles: int
    frequency: _Frequency


class _FixedPrice(BaseModel):
    value: str
    currency_code: str


class _PricingScheme(BaseModel):
    fixed_price: _FixedPrice


class _RegularCycle(BaseModel):
    tenure_type: Literal['REGULAR']
    frequency: _Frequency
    pricing_scheme: _PricingScheme


class _Plan(BaseModel):
    name: str
    description: str | None = None
    billing_cycles: list[
        Annotated[_TrialCycle | _RegularCycle, Field(discriminator='tenure_type')]
    ]


class PaypalPlan(BaseModel):
    product_name: str
    price: str
    currency: str
    cycle: PaypalInterval
    trial: PaypalInterval | None
    description: str


class _Token(BaseModel):
    access_token: str


class _Link(BaseModel):
    rel: str
    href: str


class _Created(BaseModel):
    links: list[_Link]


class _Verification(BaseModel):
    verification_status: str


class _Empty(BaseModel):
    pass


async def _request(
    method: str,
    path: str,
    model: type[T],
    json_body: Json = None,
) -> T | None:
    try:
        async with make_http_client() as client:
            token = await client.post(
                f'{PAYPAL_API_URL}/v1/oauth2/token',
                data=dict(grant_type='client_credentials'),
                auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
            )
            response = await client.request(
                method,
                f'{PAYPAL_API_URL}{path}',
                headers={
                    'Authorization': 'Bearer ' + _Token.model_validate(
                        token.raise_for_status().json()).access_token,
                    'Content-Type': 'application/json',
                },
                json=json_body,
            )
        return model.model_validate(
            response.raise_for_status().json() if response.content else {})
    except httpx.HTTPStatusError as e:
        logger.warning(
            f'PayPal {method} {path} returned HTTP {e.response.status_code}: '
            f'{e.response.text}')
        return None
    except (httpx.HTTPError, ValueError) as e:
        logger.warning(f'PayPal {method} {path} failed: {e}')
        return None


def _subscription_path(subscription_id: str) -> str:
    return f'/v1/billing/subscriptions/{quote(subscription_id, safe="")}'


def _plus(t: datetime, interval: PaypalInterval) -> datetime:
    return t + relativedelta(**{interval.unit + 's': interval.units})


def paid_until(
    subscription: PaypalSubscription,
    plan: PaypalPlan,
) -> datetime | str | None:
    if subscription.status == 'ACTIVE':
        return 'infinity'
    if subscription.status in ('APPROVAL_PENDING', 'APPROVED'):
        return None
    last_payment = subscription.billing_info.last_payment
    if last_payment is not None:
        return _plus(last_payment.time, plan.cycle)
    if plan.trial is not None and subscription.start_time is not None:
        return _plus(subscription.start_time, plan.trial)
    return None


async def create_subscription(person_uuid: str, return_url: str) -> str | None:
    created = await _request(
        'POST',
        '/v1/billing/subscriptions',
        _Created,
        json_body=dict(
            plan_id=PAYPAL_PLAN_ID,
            custom_id=person_uuid,
            application_context=dict(
                user_action='SUBSCRIBE_NOW',
                return_url=return_url,
                cancel_url=return_url,
            ),
        ),
    )
    if created is None:
        return None
    return next((l.href for l in created.links if l.rel == 'approve'), None)


async def fetch_subscription(subscription_id: str) -> PaypalSubscription | None:
    return await _request(
        'GET', _subscription_path(subscription_id), PaypalSubscription)


async def fetch_plan() -> PaypalPlan | None:
    plan = await _request('GET', f'/v1/billing/plans/{PAYPAL_PLAN_ID}', _Plan)
    if plan is None:
        return None
    regular = next(
        c for c in plan.billing_cycles if isinstance(c, _RegularCycle))
    trial = next(
        (c for c in plan.billing_cycles if isinstance(c, _TrialCycle)), None)
    return PaypalPlan(
        product_name=plan.name,
        price=regular.pricing_scheme.fixed_price.value,
        currency=regular.pricing_scheme.fixed_price.currency_code,
        cycle=regular.frequency.interval(),
        trial=None if trial is None else trial.frequency.interval(
            trial.total_cycles),
        description=plan.description or '',
    )


async def cancel_subscription(subscription_id: str) -> bool:
    return await _request(
        'POST',
        f'{_subscription_path(subscription_id)}/cancel',
        _Empty,
        json_body=dict(reason='Cancelled from the app'),
    ) is not None


async def verify_webhook(headers: Mapping[str, str], event: Json) -> bool:
    fields = ['auth_algo', 'cert_url', 'transmission_id', 'transmission_sig', 'transmission_time']
    transmission: dict[str, Json] = {
        f: headers.get('paypal-' + f.replace('_', '-'), '') for f in fields}
    if not all(transmission.values()):
        return False

    verification = await _request(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        _Verification,
        transmission | dict(webhook_id=PAYPAL_WEBHOOK_ID, webhook_event=event),
    )
    return (
        verification is not None and
        verification.verification_status == 'SUCCESS'
    )
