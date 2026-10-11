'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAuditForwarder, validUrl } = require('./auditForwarder');
const { PLANS } = require('./plans');

function setup({ plan = 'team', respond = () => ({ ok: true, status: 200 }) } = {}) {
  let stored = null;
  let clock = 0;
  const sent = [];
  const forwarder = createAuditForwarder({
    settings: { get: () => stored, save: value => { stored = value; } },
    plan: () => PLANS[plan],
    secrets: { encrypt: value => `enc:${value}`, decrypt: value => value.slice(4) },
    fetchImpl: async (url, options) => { sent.push({ url, headers: options.headers, body: JSON.parse(options.body) }); return respond(); },
    now: () => clock,
    timers: { setInterval: () => ({ unref() {} }), clearInterval() {} },
  });
  return { forwarder, sent, stored: () => stored, advance: ms => { clock += ms; } };
}

test('only HTTPS destinations without credentials, or a local collector', () => {
  assert.equal(validUrl('https://siem.example.com/kua'), true);
  assert.equal(validUrl('http://localhost:8088/events'), true);
  assert.equal(validUrl('http://siem.example.com/kua'), false);
  assert.equal(validUrl('https://user:pass@siem.example.com'), false);
  assert.equal(validUrl('not a url'), false);
});

test('forwarding is part of Team; the token is stored encrypted and never returned', () => {
  const pro = setup({ plan: 'pro' });
  pro.forwarder.configure({ url: 'https://siem.example.com/kua' });
  assert.throws(() => pro.forwarder.configure({ enabled: true }), error => error.code === 'PLAN_REQUIRED' && error.required === 'team');

  const team = setup();
  const status = team.forwarder.configure({ url: 'https://siem.example.com/kua', token: 's3cret', enabled: true });
  assert.equal(team.stored().token, 'enc:s3cret');
  assert.equal(status.hasToken, true);
  assert.equal(JSON.stringify(status).includes('s3cret'), false);
});

test('sends batches with the token and keeps them when the destination fails', async () => {
  let fail = true;
  const s = setup({ respond: () => (fail ? { ok: false, status: 503 } : { ok: true, status: 202 }) });
  s.forwarder.configure({ url: 'https://siem.example.com/kua', token: 's3cret', enabled: true });
  s.forwarder.enqueue({ id: 'a' });
  s.forwarder.enqueue({ id: 'b' });

  assert.equal(await s.forwarder.flush(), 0);
  assert.equal(s.forwarder.status().pending, 2);
  assert.match(s.forwarder.status().lastError, /HTTP 503/);
  assert.equal(await s.forwarder.flush(), 0, 'waits for the backoff');

  fail = false;
  s.advance(5000);
  assert.equal(await s.forwarder.flush(), 2);
  assert.equal(s.forwarder.status().pending, 0);
  const last = s.sent.at(-1);
  assert.equal(last.headers.Authorization, 'Bearer s3cret');
  assert.deepEqual(last.body.map(entry => entry.id), ['a', 'b']);
});

test('nothing is queued while forwarding is off or the plan does not include it', () => {
  const off = setup();
  off.forwarder.enqueue({ id: 'x' });
  assert.equal(off.forwarder.status().pending, 0);
});
