'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createApp } = require('./server');
const { loadConfig } = require('./config');
const { MemoryRepository, clientOptions } = require('./repository');

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
    for (const path of ['/health', '/healthz']) {
      const health = await subject.request(path);
      assert.equal(health.response.status, 200);
      assert.deepEqual(health.body, { ok: true, service: 'kua-control-plane', version: '0.1.0' });
    }
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

test('portal plan changes follow the price, yearly checkout and the portal configuration', async () => {
  const googleClient = {
    generateAuthUrl: options => { googleClient.nonce = options.nonce; return `https://accounts.google.com/?state=${encodeURIComponent(options.state)}`; },
    async getToken() { return { tokens: { id_token: 'id' } }; },
    async verifyIdToken() { return { getPayload: () => ({ sub: 's2', email: 'a@b.c', email_verified: true, name: 'A', nonce: googleClient.nonce }) }; },
  };
  let checkoutInput;
  let portalInput;
  const stripeClient = {
    customers: { async create() { return { id: 'cus_2' }; } },
    checkout: { sessions: { async create(input) { checkoutInput = input; return { id: 'cs_2', url: 'https://checkout.stripe.com/cs_2' }; } } },
    billingPortal: { sessions: { async create(input) { portalInput = input; return { url: 'https://billing.stripe.com/p' }; } } },
    // A portal switch from Pro to Team yearly: checkout metadata still says "pro", API basil keeps the period on the item.
    webhooks: { constructEvent() {
      return { id: 'evt_switch', type: 'customer.subscription.updated', data: { object: {
        id: 'sub_2', customer: 'cus_2', status: 'active', cancel_at_period_end: false,
        metadata: { userId: 'google_s2', plan: 'pro' },
        items: { data: [{ current_period_end: 1900000000, price: { id: 'price_team_year', metadata: { plan: 'team' } } }] },
      } } };
    } },
  };
  const subject = await fixture({ googleClient, stripeClient, env: {
    STRIPE_PRICE_PRO_YEARLY: 'price_pro_year', STRIPE_PRICE_TEAM_YEARLY: 'price_team_year', STRIPE_PORTAL_CONFIGURATION: 'bpc_kua',
  } });
  try {
    const start = await subject.request('/auth/google/start', { redirect: 'manual' });
    const state = new URL(start.response.headers.get('location')).searchParams.get('state');
    const callback = await subject.request(`/auth/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    const cookie = callback.response.headers.get('set-cookie').split(';')[0];

    const yearly = await subject.request('/api/billing/checkout', { method: 'POST', cookie, body: { plan: 'pro', interval: 'year' } });
    assert.equal(yearly.response.status, 201);
    assert.equal(checkoutInput.line_items[0].price, 'price_pro_year');
    const bad = await subject.request('/api/billing/checkout', { method: 'POST', cookie, body: { plan: 'pro', interval: 'week' } });
    assert.equal(bad.response.status, 400);

    await subject.request('/webhooks/stripe', { method: 'POST', rawBody: '{}', headers: { 'Stripe-Signature': 's' } });
    const entitlements = await subject.request('/api/entitlements', { cookie });
    assert.equal(entitlements.body.plan, 'team');
    const stored = await subject.repository.getSubscriptionByUserId('google_s2');
    assert.equal(stored.plan, 'team');
    assert.equal(stored.currentPeriodEnd, new Date(1900000000 * 1000).toISOString());

    const portal = await subject.request('/api/billing/portal', { method: 'POST', cookie });
    assert.equal(portal.response.status, 200);
    assert.equal(portalInput.configuration, 'bpc_kua');
  } finally { await subject.close(); }
});

test('the cloud repository targets a named database when GCP_DATABASE_ID is set', () => {
  assert.deepEqual(clientOptions({ projectId: 'ncaicloud', databaseId: 'kua-control-plane' }), { projectId: 'ncaicloud', databaseId: 'kua-control-plane' });
  assert.deepEqual(clientOptions({ projectId: 'ncaicloud', databaseId: '' }), { projectId: 'ncaicloud' });
  assert.equal(clientOptions({}), undefined);
  assert.equal(loadConfig({ GCP_DATABASE_ID: ' kua-control-plane ' }).databaseId, 'kua-control-plane');
});

test('KUA Desktop signs in through a loopback redirect, a one-time code and PKCE', async () => {
  const crypto = require('node:crypto');
  let oauthOptions;
  const googleClient = {
    generateAuthUrl(options) { oauthOptions = options; return `https://accounts.google.com/auth?state=${encodeURIComponent(options.state)}`; },
    async getToken() { return { tokens: { id_token: 'id-token' } }; },
    async verifyIdToken() { return { getPayload: () => ({ sub: 'desk-1', email: 'desk@example.com', email_verified: true, name: 'Desk', nonce: oauthOptions.nonce }) }; },
  };
  const subject = await fixture({ googleClient });
  try {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'http://127.0.0.1:7190/api/account/callback';

    // Only loopback callbacks of KUA Desktop are accepted.
    for (const bad of ['https://evil.example/api/account/callback', 'http://127.0.0.1:7190/other', 'http://10.0.0.1:7190/api/account/callback']) {
      const rejected = await subject.request(`/auth/desktop/start?${new URLSearchParams({ redirect_uri: bad, code_challenge: challenge, state: 's' })}`, { redirect: 'manual' });
      assert.equal(rejected.response.status, 400, bad);
    }
    const noPkce = await subject.request(`/auth/desktop/start?${new URLSearchParams({ redirect_uri: redirectUri, state: 's' })}`, { redirect: 'manual' });
    assert.equal(noPkce.response.status, 400);

    const start = await subject.request(`/auth/desktop/start?${new URLSearchParams({ redirect_uri: redirectUri, code_challenge: challenge, state: 'desk-state' })}`, { redirect: 'manual' });
    assert.equal(start.response.status, 302);
    const callback = await subject.request(`/auth/google/callback?code=authorization-code&state=${encodeURIComponent(oauthOptions.state)}`, { redirect: 'manual' });
    assert.equal(callback.response.status, 302);
    assert.equal(callback.response.headers.get('set-cookie'), null, 'desktop sign-ins get no browser cookie');
    const back = new URL(callback.response.headers.get('location'));
    assert.equal(`${back.origin}${back.pathname}`, redirectUri);
    assert.equal(back.searchParams.get('state'), 'desk-state');
    const code = back.searchParams.get('code');

    const wrongVerifier = await subject.request('/auth/desktop/token', { method: 'POST', body: { code, code_verifier: 'x'.repeat(43) } });
    assert.equal(wrongVerifier.response.status, 400);
    // The code was consumed by the failed attempt: a stolen code is useless without the verifier, and works once.
    const start2 = await subject.request(`/auth/desktop/start?${new URLSearchParams({ redirect_uri: redirectUri, code_challenge: challenge, state: 'desk-state' })}`, { redirect: 'manual' });
    assert.equal(start2.response.status, 302);
    const callback2 = await subject.request(`/auth/google/callback?code=authorization-code&state=${encodeURIComponent(oauthOptions.state)}`, { redirect: 'manual' });
    const code2 = new URL(callback2.response.headers.get('location')).searchParams.get('code');

    const token = await subject.request('/auth/desktop/token', { method: 'POST', body: { code: code2, code_verifier: verifier } });
    assert.equal(token.response.status, 200);
    assert.equal(token.body.user.email, 'desk@example.com');
    assert.equal(token.body.entitlements.plan, 'free');
    const reused = await subject.request('/auth/desktop/token', { method: 'POST', body: { code: code2, code_verifier: verifier } });
    assert.equal(reused.response.status, 400, 'a code works once');

    const me = await subject.request('/api/me', { headers: { Authorization: `Bearer ${token.body.token}` } });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.user.email, 'desk@example.com');

    const logout = await subject.request('/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token.body.token}` } });
    assert.equal(logout.response.status, 204);
    const after = await subject.request('/api/me', { headers: { Authorization: `Bearer ${token.body.token}` } });
    assert.equal(after.response.status, 401, 'logout ends the desktop session');

    const done = await subject.request('/billing/done?status=success');
    assert.equal(done.response.status, 200);
    assert.match(done.text, /return to KUA/);
  } finally { await subject.close(); }
});

test('desktop checkouts and portal sessions come back to the return-to-KUA page', async () => {
  const created = {};
  const stripeClient = {
    customers: { async create() { return { id: 'cus_d' }; } },
    checkout: { sessions: { async create(input) { created.checkout = input; return { id: 'cs_d', url: 'https://checkout.stripe.com/cs_d' }; } } },
    billingPortal: { sessions: { async create(input) { created.portal = input; return { url: 'https://billing.stripe.com/p' }; } } },
  };
  const subject = await fixture({ stripeClient });
  try {
    const user = await subject.repository.upsertUser({ id: 'u1', email: 'u@example.com', name: 'U', stripeCustomerId: 'cus_d' });
    const crypto = require('node:crypto');
    const token = 'desk-token';
    await subject.repository.createSession({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    const auth = { Authorization: `Bearer ${token}` };
    const checkout = await subject.request('/api/billing/checkout', { method: 'POST', body: { plan: 'pro', interval: 'month', client: 'desktop' }, headers: auth });
    assert.equal(checkout.response.status, 201, JSON.stringify(checkout.body));
    assert.equal(created.checkout.success_url, 'http://127.0.0.1/billing/done?status=success');
    assert.equal(created.checkout.cancel_url, 'http://127.0.0.1/billing/done?status=cancelled');
    await subject.request('/api/billing/portal', { method: 'POST', body: { client: 'desktop' }, headers: auth });
    assert.equal(created.portal.return_url, 'http://127.0.0.1/billing/done?status=portal');
  } finally { await subject.close(); }
});
