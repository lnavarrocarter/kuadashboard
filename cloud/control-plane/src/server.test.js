'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createApp } = require('./server');
const { loadConfig } = require('./config');
const { MemoryRepository } = require('./repository');

async function fixture({ googleClient, stripeClient, env = {} } = {}) {
  const config = loadConfig({
    NODE_ENV: 'test', PORT: '0', CONTROL_PLANE_URL: 'http://127.0.0.1', FRONTEND_URL: 'https://kuadashboard.navarrocarter.com',
    GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret', GOOGLE_REDIRECT_URI: 'http://127.0.0.1/auth/google/callback',
    KUA_SESSION_SECRET: 'test-session-secret', STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_TEAM: 'price_team', ...env,
  });
  const repository = new MemoryRepository();
  const app = createApp({ config, repository, googleClient, stripeClient });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(path, { method = 'GET', body, rawBody, cookie, redirect = 'follow', headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      redirect,
      headers: {
        ...(body === undefined && rawBody === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: rawBody === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : rawBody,
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    return { response, body: text && contentType.includes('json') ? JSON.parse(text) : null, text };
  }

  return {
    repository,
    request,
    async close() { await new Promise(resolve => server.close(resolve)); },
  };
}

test('health is public and authenticated endpoints reject anonymous requests', async () => {
  const subject = await fixture();
  try {
    const health = await subject.request('/healthz');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { ok: true, service: 'kua-control-plane', version: '0.1.0' });
    const me = await subject.request('/api/me');
    assert.equal(me.response.status, 401);
  } finally { await subject.close(); }
});

test('Google OIDC creates a secure session and Stripe updates team entitlements idempotently', async () => {
  let oauthOptions;
  const googleClient = {
    generateAuthUrl(options) {
      oauthOptions = options;
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(options.state)}`;
    },
    async getToken(code) {
      assert.equal(code, 'authorization-code');
      return { tokens: { id_token: 'id-token' } };
    },
    async verifyIdToken() {
      return { getPayload: () => ({
        sub: 'google-sub-1', email: 'User@Example.com', email_verified: true, name: 'KUA User', nonce: oauthOptions.nonce,
      }) };
    },
  };
  const stripeClient = {
    customers: { async create(input) { return { id: 'cus_1', input }; } },
    checkout: { sessions: { async create(input) { return { id: 'cs_1', url: 'https://checkout.stripe.com/cs_1', input }; } } },
    billingPortal: { sessions: { async create() { return { url: 'https://billing.stripe.com/session_1' }; } } },
    webhooks: { constructEvent(body) {
      return { id: `evt_${JSON.parse(body.toString()).id}`, type: 'customer.subscription.updated', data: { object: {
        id: 'sub_1', customer: 'cus_1', status: 'active', cancel_at_period_end: false, current_period_end: 1800000000,
        metadata: { userId: 'google_google-sub-1', plan: 'team' }, items: { data: [{ price: { id: 'price_team' } }] },
      } } };
    } },
  };
  const subject = await fixture({ googleClient, stripeClient });
  try {
    const start = await subject.request('/auth/google/start?returnTo=https%3A%2F%2Fevil.example%2Fsteal', { redirect: 'manual' });
    assert.equal(start.response.status, 302);
    const location = new URL(start.response.headers.get('location'));
    assert.equal(location.origin, 'https://accounts.google.com');
    const state = location.searchParams.get('state');

    const callback = await subject.request(`/auth/google/callback?code=authorization-code&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(callback.response.status, 302);
    assert.match(callback.response.headers.get('location'), /^https:\/\/kuadashboard\.navarrocarter\.com\/\?auth=complete$/);
    const cookie = callback.response.headers.get('set-cookie').split(';')[0];
    assert.match(callback.response.headers.get('set-cookie'), /HttpOnly/);

    const me = await subject.request('/api/me', { cookie });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.user.email, 'user@example.com');
    assert.equal(me.body.entitlements.plan, 'free');

    const checkout = await subject.request('/api/billing/checkout', { method: 'POST', cookie, body: { plan: 'team' } });
    assert.equal(checkout.response.status, 201);
    assert.equal(checkout.body.url, 'https://checkout.stripe.com/cs_1');
    assert.equal(subject.repository.users.get('google_google-sub-1').stripeCustomerId, 'cus_1');

    const webhookBody = JSON.stringify({ id: 'team-1' });
    const webhook = await subject.request('/webhooks/stripe', {
      method: 'POST', rawBody: webhookBody, headers: { 'Stripe-Signature': 'test-signature' },
    });
    assert.equal(webhook.response.status, 200);
    assert.equal(webhook.body.duplicate, false);
    const duplicate = await subject.request('/webhooks/stripe', {
      method: 'POST', rawBody: webhookBody, headers: { 'Stripe-Signature': 'test-signature' },
    });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.body.duplicate, true);

    const upgraded = await subject.request('/api/entitlements', { cookie });
    assert.equal(upgraded.body.plan, 'team');
    assert.equal(upgraded.body.features.teamSharing, true);
  } finally { await subject.close(); }
});

test('unconfigured OAuth and billing return actionable 503 responses', async () => {
  const subject = await fixture({ env: {
    GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '', KUA_SESSION_SECRET: '',
    STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_PRICE_PRO: '', STRIPE_PRICE_TEAM: '',
  } });
  try {
    const oauth = await subject.request('/auth/google/start');
    assert.equal(oauth.response.status, 503);
    assert.deepEqual(oauth.body.missing, ['googleClientId', 'googleClientSecret', 'googleRedirectUri', 'sessionSecret']);
  } finally { await subject.close(); }
});
