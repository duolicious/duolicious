const express = require('express');

const PORT = process.env.PORT || 3004;

const expectedAuthorization = 'Basic ' + Buffer.from(
  process.env.PAYPAL_MOCK_CLIENT_ID + ':' + process.env.PAYPAL_MOCK_CLIENT_SECRET
).toString('base64');

const regularCycle = (interval_unit, interval_count, value) => ({
  tenure_type: 'REGULAR',
  total_cycles: 0,
  frequency: { interval_unit, interval_count },
  pricing_scheme: { fixed_price: { value, currency_code: 'USD' } },
});

const plans = {
  'P-TEST': {
    id: 'P-TEST',
    name: 'Gold',
    billing_cycles: [
      {
        tenure_type: 'TRIAL',
        total_cycles: 1,
        frequency: { interval_unit: 'DAY', interval_count: 7 },
        pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } },
      },
      regularCycle('WEEK', 1, '0.99'),
    ],
  },
  'P-WEEK': { id: 'P-WEEK', name: 'Gold', billing_cycles: [regularCycle('WEEK', 1, '1.99')] },
  'P-MONTH': { id: 'P-MONTH', name: 'Gold', billing_cycles: [regularCycle('MONTH', 1, '3.99')] },
  'P-QUARTER': { id: 'P-QUARTER', name: 'Gold', billing_cycles: [regularCycle('MONTH', 3, '9.99')] },
};

let subscriptions = {};
let subscriptionCounter = 0;

const app = express();
app.use(express.json());

const requireBearer = (req, res, next) => {
  if (req.headers.authorization !== 'Bearer mock-access-token') {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  next();
};

const subscriptionJson = (sub) => ({
  id: sub.id,
  status: sub.status,
  custom_id: sub.custom_id,
  plan_id: sub.plan_id,
  start_time: sub.start_time,
  billing_info: sub.last_payment_time === null
    ? {}
    : { last_payment: { time: sub.last_payment_time } },
  links: [
    {
      rel: 'approve',
      href: `http://localhost:${PORT}/approve?subscription_id=${sub.id}`,
    },
  ],
});

app.post('/v1/oauth2/token', (req, res) => {
  if (req.headers.authorization !== expectedAuthorization) {
    res.status(401).json({ error: 'invalid_client' });
    return;
  }
  res.status(200).json({ access_token: 'mock-access-token' });
});

const newSubscription = (id, fields) => subscriptions[id] = {
  id,
  status: 'ACTIVE',
  custom_id: null,
  plan_id: 'P-WEEK',
  start_time: new Date().toISOString(),
  last_payment_time: null,
  return_url: null,
  ...fields,
};

app.post('/v1/billing/subscriptions', requireBearer, (req, res) => {
  subscriptionCounter += 1;
  const sub = newSubscription(`I-MOCK-${subscriptionCounter}`, {
    status: 'APPROVAL_PENDING',
    custom_id: req.body.custom_id ?? null,
    plan_id: req.body.plan_id,
    return_url: req.body.application_context?.return_url,
  });
  res.status(201).json(subscriptionJson(sub));
});

app.get('/v1/billing/subscriptions/:id', requireBearer, (req, res) => {
  const sub = subscriptions[req.params.id];
  if (!sub) {
    res.status(404).json({ name: 'RESOURCE_NOT_FOUND' });
    return;
  }
  res.status(200).json(subscriptionJson(sub));
});

app.post('/v1/billing/subscriptions/:id/cancel', requireBearer, (req, res) => {
  const sub = subscriptions[req.params.id];
  if (!sub || !['ACTIVE', 'SUSPENDED'].includes(sub.status)) {
    res.status(422).json({ name: 'SUBSCRIPTION_STATUS_INVALID' });
    return;
  }
  sub.status = 'CANCELLED';
  res.status(204).send();
});

app.get('/v1/billing/plans/:id', requireBearer, (req, res) => {
  const plan = plans[req.params.id];
  if (!plan) {
    res.status(404).json({ name: 'RESOURCE_NOT_FOUND' });
    return;
  }
  res.status(200).json(plan);
});

app.post('/v1/notifications/verify-webhook-signature', requireBearer, (req, res) => {
  res.status(200).json({
    verification_status:
      req.body.transmission_sig === 'invalid' ? 'FAILURE' : 'SUCCESS',
  });
});

app.get('/approve', (req, res) => {
  const sub = subscriptions[req.query.subscription_id];
  sub.status = 'ACTIVE';
  const url = new URL(sub.return_url);
  url.searchParams.set('subscription_id', sub.id);
  res.redirect(302, url.toString());
});

app.post('/control/subscriptions/:id', (req, res) => {
  const { id } = req.params;
  Object.assign(subscriptions[id] ?? newSubscription(id), req.body);
  res.status(200).send();
});

app.delete('/control', (req, res) => {
  subscriptions = {};
  res.status(200).send();
});

app.listen(PORT, () => {
  console.log(`PayPal mock running on port ${PORT}`);
});
