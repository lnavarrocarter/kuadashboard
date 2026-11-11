'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createVercelOAuth } = require('./vercelOAuth');

test('default OAuth keeps its verifier on the desktop and sends no client secret', async () => {
  let challenge;
  let verifier;
  const flow = createVercelOAuth({ env: {}, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.doesNotMatch(options.body, /client_secret/);
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/start')) {
      challenge = body.code_challenge;
      assert.equal(body.code_challenge_method, 'S256');
      return { ok: true, json: async () => ({ state: 'signed-state', authorizationUrl: 'https://vercel.com/api/oauth/authorize?state=signed-state' }) };
    }
    assert.equal(body.state, 'signed-state');
    verifier = body.code_verifier;
    return { ok: true, json: async () => ({ access_token: 'token', team_id: 'team' }) };
  } });
  assert.match(await flow.start('My profile'), /^https:\/\/vercel.com/);
  assert.deepEqual(await flow.exchange({ code: 'code', state: 'signed-state' }), { token: 'token', teamId: 'team', profileName: 'My profile' });
  assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'), challenge);
  await assert.rejects(flow.exchange({ code: 'code', state: 'signed-state' }), /Invalid or expired/);
});

test('invalid and expired state and unsolicited marketplace callbacks never exchange codes', async () => {
  let time = Date.now();
  const flow = createVercelOAuth({ env: {}, now: () => time, fetchImpl: async url => {
    assert.match(url, /\/start$/);
    return { ok: true, json: async () => ({ state: 'state', authorizationUrl: 'https://vercel.com/api/oauth/authorize?state=state' }) };
  } });
  await flow.start();
  await assert.rejects(flow.exchange({ code: 'code', state: 'other' }), /Invalid or expired/);
  time += 10 * 60 * 1000;
  await assert.rejects(flow.exchange({ code: 'code', state: 'state' }), /Invalid or expired/);
  await assert.rejects(flow.exchange({ code: 'code', configurationId: 'marketplace-install' }), /Connect with Vercel/);
});

test('user-owned confidential integrations keep the direct exchange and marketplace support', async () => {
  const flow = createVercelOAuth({ env: { VERCEL_OAUTH_CLIENT_ID: 'own-id', VERCEL_OAUTH_CLIENT_SECRET: 'own-secret' }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://vercel.com/api/oauth/access_token');
    assert.equal(new URLSearchParams(options.body).get('client_secret'), 'own-secret');
    return { ok: true, json: async () => ({ access_token: 'own-token' }) };
  } });
  const target = new URL(await flow.start('Custom'));
  assert.equal(target.searchParams.get('client_id'), 'own-id');
  assert.equal((await flow.exchange({ code: 'code', state: target.searchParams.get('state') })).profileName, 'Custom');
  assert.equal((await flow.exchange({ code: 'market-code', configurationId: 'config' })).token, 'own-token');
});

test('broker configuration and redirects fail closed; upstream errors hide their body', async () => {
  const insecure = createVercelOAuth({ env: { KUA_CONTROL_PLANE_URL: 'http://remote.example' } });
  await assert.rejects(insecure.start(), /HTTPS control plane/);
  const redirect = createVercelOAuth({ env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ state: 's', authorizationUrl: 'https://evil.example/?state=s' }) }) });
  await assert.rejects(redirect.start(), /Invalid Vercel/);
  const failed = createVercelOAuth({ env: {}, fetchImpl: async () => ({ ok: false, json: async () => ({ error: 'credential-value' }) }) });
  await assert.rejects(failed.start(), error => error.status === 502 && !error.message.includes('credential-value'));
});
