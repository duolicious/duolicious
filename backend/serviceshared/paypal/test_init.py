import asyncio
import unittest
from datetime import datetime

import httpx

from serviceshared import paypal

MONTHLY = paypal.PaypalPlan(
    id='P-1',
    product_name='Gold',
    price='4.99',
    currency='USD',
    cycle=paypal.PaypalInterval(units=1, unit='month'),
    trial=paypal.PaypalInterval(units=7, unit='day'),
)
YEARLY = MONTHLY.model_copy(
    update=dict(cycle=paypal.PaypalInterval(units=1, unit='year')))
NO_TRIAL = MONTHLY.model_copy(update=dict(trial=None))


def _subscription(
    status: str,
    last_payment_time: str | None = None,
    start_time: str = '2026-10-01T00:00:00Z',
) -> paypal.PaypalSubscription:
    return paypal.PaypalSubscription.model_validate(dict(
        id='I-1',
        status=status,
        custom_id='uuid',
        plan_id='P-1',
        start_time=start_time,
        billing_info=dict(
            last_payment=last_payment_time and dict(time=last_payment_time)),
    ))


class TestPaypal(unittest.TestCase):
    def test_paid_until(self) -> None:
        cases = [
            (_subscription('ACTIVE'), MONTHLY, 'infinity'),
            (_subscription('APPROVED', last_payment_time='2026-01-01T00:00:00Z'),
             MONTHLY, None),
            (_subscription('CANCELLED', last_payment_time='2026-01-31T12:00:00+02:00'),
             MONTHLY, datetime(2026, 2, 28, 10)),
            (_subscription('SUSPENDED', last_payment_time='2024-02-29T00:00:00Z'),
             YEARLY, datetime(2025, 2, 28)),
            (_subscription('CANCELLED'), MONTHLY, datetime(2026, 10, 8)),
            (_subscription('CANCELLED'), NO_TRIAL, datetime(2026, 10, 1)),
        ]
        for subscription, plan, expected in cases:
            self.assertEqual(paypal.paid_until(subscription, plan), expected)

    def test_access_token_is_reused_until_it_expires(self) -> None:
        issued = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal issued
            issued += 1
            return httpx.Response(
                200, json=dict(access_token=f'token-{issued}', expires_in=3600))

        async def tokens() -> list[str]:
            async with httpx.AsyncClient(
                    transport=httpx.MockTransport(handler)) as client:
                return [await paypal._access_token(client) for _ in range(3)]

        self.assertEqual(asyncio.run(tokens()), ['token-1'] * 3)
