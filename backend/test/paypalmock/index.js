const express = require('express');

const PORT = process.env.PORT || 3004;

const expectedAuthorization = 'Basic ' + Buffer.from(
  process.env.PAYPAL_MOCK_CLIENT_ID + ':' + process.env.PAYPAL_MOCK_CLIENT_SECRET
).toString('base64');

const plan = {
  id: 'P-TEST',
  name: 'Gold',
  description: 'Dark mode, custom themes and more',
  billing_cycles: [
    {
      tenure_type: 'TRIAL',
      total_cycles: 1,
      frequency: { interval_unit: 'DAY', interval_count: 7 },
      pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } },
    },
    {
      tenure_type: 'REGULAR',
      total_cycles: 0,
      frequency: { interval_unit: 'MONTH', interval_count: 1 },
      pricing_scheme: { fixed_price: { value: '4.99', currency_code: 'USD' } },
    },
  ],
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
  start_time: sub.start_time,
  billing_info: sub.last_payment_time === null
    ? {}
    : { last_payment: { time: sub.last_payment_time } },
  links: [
    {
      rel: 'approve',
      href: `http://localhost:${PORT}/approve?subscription_id=${sub.id}`,
      method: 'GET',
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

app.post('/v1/billing/subscriptions', requireBearer, (req, res) => {
  subscriptionCounter += 1;
  const sub = {
    id: `I-MOCK-${subscriptionCounter}`,
    status: 'APPROVAL_PENDING',
    custom_id: req.body.custom_id ?? null,
    start_time: new Date().toISOString(),
    last_payment_time: null,
    return_url: req.body.application_context?.return_url,
  };
  subscriptions[sub.id] = sub;
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
  if (req.params.id !== plan.id) {
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
  const sub = subscriptions[req.params.id] ?? {
    id: req.params.id,
    status: 'ACTIVE',
    custom_id: null,
    start_time: new Date().toISOString(),
    last_payment_time: null,
    return_url: null,
  };
  subscriptions[sub.id] = Object.assign(sub, req.body);
  res.status(200).send();
});

app.delete('/control', (req, res) => {
  subscriptions = {};
  res.status(200).send();
});

app.listen(PORT, () => {
  console.log(`PayPal mock running on port ${PORT}`);
});
