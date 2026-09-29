'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const { verifyWebhook, sign, subscriptionChange, planForProduct } = require('./polar');
const { createApp } = require('./server');
const { loadConfig } = require('./config');
const { MemoryRepository } = require('./repository');

// A Standard Webhooks secret: whsec_ + base64 key.
const SECRET = `whsec_${crypto.randomBytes(24).toString('base64')}`;
const NOW = 1_800_000_000;

function signed(body, { secret = SECRET, id = 'msg_1', timestamp = NOW, legacy = false } = {}) {
  const key = legacy ? Buffer.from(secret, 'utf8') : Buffer.from(secret.slice(6), 'base64');
  return { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': `v1,${sign(key, id, timestamp, body)}` };
}

const subscription = (overrides = {}) => ({
  id: 'sub_1', status: 'active', cancel_at_period_end: false, current_period_end: '2026-10-29T00:00:00Z',
  recurring_interval: 'month', customer_id: 'cus_1', product_id: 'prod_team_m',
  customer: { id: 'cus_1', external_id: 'google_u1', email: 'a@b.c' },
  product: { id: 'prod_team_m', metadata: { plan: 'team' } },
  metadata: {},
  ...overrides,
});

test('webhook signatures: Standard Webhooks and legacy Polar keys, tampering and replay rejected', () => {
  const body = JSON.stringify({ type: 'subscription.active', data: subscription() });
  assert.equal(verifyWebhook(body, signed(body), SECRET, NOW).event.type, 'subscription.active');
  assert.equal(verifyWebhook(body, signed(body, { legacy: true }), SECRET, NOW).id, 'msg_1');
  assert.throws(() => verifyWebhook(`${body} `, signed(body), SECRET, NOW), /Invalid Polar webhook signature/);
  assert.throws(() => verifyWebhook(body, signed(body), `whsec_${crypto.randomBytes(24).toString('base64')}`, NOW), /Invalid/);
  assert.throws(() => verifyWebhook(body, signed(body, { timestamp: NOW - 600 }), SECRET, NOW), /tolerance/);
  assert.throws(() => verifyWebhook(body, {}, SECRET, NOW), /Invalid/);
  // Several signatures (secret rotation): any valid one is enough.
  const headers = signed(body);
  headers['webhook-signature'] = `v1,AAAA ${headers['webhook-signature']}`;
  assert.ok(verifyWebhook(body, headers, SECRET, NOW));
});

test('subscription events map to KUA plans; revoked and ended subscriptions remove access', () => {
  const change = subscriptionChange({ type: 'subscription.updated', data: subscription() });
  assert.equal(change.userId, 'google_u1');
  assert.deepEqual(
    { plan: change.subscription.plan, status: change.subscription.status, end: change.subscription.currentPeriodEnd, provider: change.subscription.provider },
    { plan: 'team', status: 'active', end: '2026-10-29T00:00:00Z', provider: 'polar' },
  );
  // Cancel at period end keeps access until Polar revokes the subscription.
  assert.equal(subscriptionChange({ type: 'subscription.canceled', data: subscription({ cancel_at_period_end: true }) }).subscription.cancelAtPeriodEnd, true);
  assert.deepEqual(subscriptionChange({ type: 'subscription.revoked', data: subscription({ status: 'canceled' }) }), { userId: 'google_u1', remove: true });
  assert.equal(subscriptionChange({ type: 'order.paid', data: {} }), null);
  assert.equal(subscriptionChange({ type: 'subscription.active', data: subscription({ customer: {}, metadata: {} }) }), null);
  assert.equal(planForProduct({ id: 'p_y' }, { proYearly: 'p_y' }), 'pro');
  assert.equal(planForProduct({ id: 'unknown' }, {}), null);
});

async function fixture(polarClient, env = {}) {
  const config = loadConfig({
    NODE_ENV: 'test', PORT: '0', CONTROL_PLANE_URL: 'http://127.0.0.1', FRONTEND_URL: 'https://kuadashboard.navarrocarter.com',
    GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs', GOOGLE_REDIRECT_URI: 'http://127.0.0.1/cb', KUA_SESSION_SECRET: 'session',
    POLAR_ACCESS_TOKEN: 'polar_oat_test', POLAR_WEBHOOK_SECRET: SECRET,
    POLAR_PRODUCT_PRO: 'prod_pro_m', POLAR_PRODUCT_TEAM: 'prod_team_m', POLAR_PRODUCT_PRO_YEARLY: 'prod_pro_y', POLAR_PRODUCT_TEAM_YEARLY: 'prod_team_y',
    ...env,
  });
  const repository = new MemoryRepository();
  const clock = { now: NOW * 1000 };
  const app = createApp({ config, repository, polarClient, now: () => clock.now });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await repository.upsertUser({ id: 'google_u1', email: 'a@b.c', name: 'A', googleSub: 'u1' });
  const token = 'raw-session-token';
  await repository.createSession({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: 'google_u1', createdAt: '', expiresAt: '' });
  const request = async (path, { method = 'GET', body, headers = {}, raw } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return { request, repository, config, close: () => new Promise(resolve => server.close(resolve)) };
}

test('Polar checkout, webhooks and portal drive the entitlements', async () => {
  const calls = [];
  const polarClient = {
    async createCheckout(input) { calls.push(['checkout', input]); return { id: 'co_1', url: 'https://sandbox.polar.sh/checkout/co_1' }; },
    async createCustomerSession(input) { calls.push(['portal', input]); return { customer_portal_url: 'https://sandbox.polar.sh/portal/x' }; },
  };
  const subject = await fixture(polarClient);
  try {
    assert.equal(subject.config.billingProvider, 'polar');
    const checkout = await subject.request('/api/billing/checkout', { method: 'POST', body: { plan: 'team', interval: 'year' } });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.url, 'https://sandbox.polar.sh/checkout/co_1');
    assert.deepEqual(calls[0][1].products, ['prod_team_y']);
    assert.equal(calls[0][1].external_customer_id, 'google_u1');

    const send = async (event, id) => {
      const raw = JSON.stringify(event);
      return subject.request('/webhooks/polar', { method: 'POST', raw, headers: { 'Content-Type': 'application/json', ...signed(raw, { id }) } });
    };
    const active = await send({ type: 'subscription.active', data: subscription() }, 'msg_a');
    assert.deepEqual(active.body, { received: true, duplicate: false });
    assert.equal((await send({ type: 'subscription.active', data: subscription() }, 'msg_a')).body.duplicate, true);
    assert.equal((await subject.request('/api/entitlements')).body.plan, 'team');

    const bad = await subject.request('/webhooks/polar', { method: 'POST', raw: '{}', headers: { 'Content-Type': 'application/json', ...signed('{"x":1}') } });
    assert.equal(bad.status, 400);

    await send({ type: 'subscription.revoked', data: subscription({ status: 'canceled' }) }, 'msg_r');
    assert.equal((await subject.request('/api/entitlements')).body.plan, 'free');

    const portal = await subject.request('/api/billing/portal', { method: 'POST' });
    assert.equal(portal.body.url, 'https://sandbox.polar.sh/portal/x');
    assert.equal(calls[1][1].external_customer_id, 'google_u1');
  } finally { await subject.close(); }
});

test('Polar: missing products answer 503 and a customer without purchases gets 400 from the portal', async () => {
  const polarClient = {
    async createCheckout() { throw new Error('should not be called'); },
    async createCustomerSession() { throw Object.assign(new Error('Polar API 404: Customer not found'), { statusCode: 404 }); },
  };
  const subject = await fixture(polarClient, { POLAR_PRODUCT_TEAM_YEARLY: '' });
  try {
    const checkout = await subject.request('/api/billing/checkout', { method: 'POST', body: { plan: 'team', interval: 'year' } });
    assert.equal(checkout.status, 503);
    assert.deepEqual(checkout.body.missing, ['polarProducts.teamYearly']);
    const portal = await subject.request('/api/billing/portal', { method: 'POST' });
    assert.equal(portal.status, 400);
  } finally { await subject.close(); }
});

test('Stripe stays the provider without a Polar token', () => {
  assert.equal(loadConfig({}).billingProvider, 'stripe');
  assert.equal(loadConfig({ POLAR_ACCESS_TOKEN: 'x' }).billingProvider, 'polar');
  assert.equal(loadConfig({ POLAR_ACCESS_TOKEN: 'x', BILLING_PROVIDER: 'stripe' }).billingProvider, 'stripe');
});
