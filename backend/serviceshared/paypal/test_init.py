import unittest
from datetime import datetime

from serviceshared import paypal

MONTHLY = paypal.PaypalPlan(
    product_name='Gold',
    price='4.99',
    currency='USD',
    cycle=paypal.PaypalInterval(units=1, unit='month'),
    trial=paypal.PaypalInterval(units=7, unit='day'),
    description='',
)
YEARLY = MONTHLY.model_copy(
    update=dict(cycle=paypal.PaypalInterval(units=1, unit='year')))
NO_TRIAL = MONTHLY.model_copy(update=dict(trial=None))


def _subscription(
    status: str,
    start_time: str | None = None,
    last_payment_time: str | None = None,
) -> paypal.PaypalSubscription:
    return paypal.PaypalSubscription.model_validate(dict(
        id='I-1',
        status=status,
        custom_id='uuid',
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
            (_subscription('CANCELLED', start_time='2026-10-01T00:00:00Z'),
             MONTHLY, datetime(2026, 10, 8)),
            (_subscription('CANCELLED', start_time='2026-10-01T00:00:00Z'),
             NO_TRIAL, None),
        ]
        for subscription, plan, expected in cases:
            self.assertEqual(paypal.paid_until(subscription, plan), expected)
