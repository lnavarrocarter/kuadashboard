'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PLANS } = require('../plans');
const { createWebhookDispatcher, validateUrl, maskUrl, matches, placeOf, payload, alertLine, loadTranslator } = require('./webhooks');

const SLACK = 'https://hooks.slack.com/services/T000/B000/abcdefghijklmnop';
const TEAMS = 'https://prod-01.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=secretsig';
const EKS = 'arn:aws:eks:us-east-1:111:cluster/shop';
const alert = (type, severity, extra = {}) => ({ id: Math.random(), scope: `kubernetes:${EKS}:all`, type, ruleId: 'k8s.privileged', severity, data: { count: 2, params: {} }, ...extra });

function fixture({ plan = PLANS.team, fail = false } = {}) {
  let stored = null;
  const sent = [];
  const dispatcher = createWebhookDispatcher({
    secrets: { get: () => stored, set: value => { stored = value; } },
    plan: () => plan,
    fetchImpl: async (url, options) => { sent.push({ url, body: JSON.parse(options.body) }); return { ok: !fail, status: fail ? 404 : 200 }; },
    translatorFor: lang => loadTranslator(lang),
    debounceMs: 1,
    log: { warn() {} },
  });
  return { dispatcher, sent, stored: () => stored };
}

test('only Slack and Teams addresses over HTTPS are accepted', () => {
  assert.equal(validateUrl('slack', SLACK), SLACK);
  assert.equal(validateUrl('teams', TEAMS), TEAMS);
  assert.equal(validateUrl('teams', 'https://contoso.webhook.office.com/webhookb2/x'), 'https://contoso.webhook.office.com/webhookb2/x');
  assert.throws(() => validateUrl('slack', 'http://hooks.slack.com/services/x'), /HTTPS/);
  assert.throws(() => validateUrl('slack', 'https://hooks.slack.com.evil.example/x'), /hooks.slack.com/);
  assert.throws(() => validateUrl('teams', 'https://127.0.0.1/x'), /Teams webhook/);
  assert.throws(() => validateUrl('discord', SLACK), /slack or teams/);
  assert.equal(maskUrl(SLACK), 'https://hooks.slack.com/…mnop');
});

test('the minimum severity decides what reaches a channel', () => {
  assert.equal(matches(alert('new_finding', 'high'), 'high'), true);
  assert.equal(matches(alert('new_finding', 'medium'), 'high'), false);
  assert.equal(matches(alert('acceptance_expired', 'high'), 'high'), true);
  assert.equal(matches(alert('acceptance_expiring', 'medium'), 'medium'), true);
  assert.equal(matches(alert('fixed', 'info'), 'medium'), false);
  assert.equal(matches(alert('fixed', 'info'), 'all'), true);
});

test('messages name the rule and the place, never resources', async () => {
  const t = await loadTranslator('en');
  assert.equal(placeOf(alert('fixed', 'info')), 'Kubernetes · shop · all namespaces');
  assert.equal(placeOf({ scope: 'aws:local:prod:us-east-1' }), 'AWS · prod · us-east-1');
  assert.equal(placeOf({ scope: 'product:a1', data: { scopeLabel: 'Orders' } }), 'KUApps · Orders');
  assert.match(alertLine(alert('new_finding', 'high'), t), /^🔴 New finding: .+ — Kubernetes · shop · all namespaces$/);
  assert.match(alertLine(alert('new_finding', 'high'), await loadTranslator('es')), /^🔴 Hallazgo nuevo: /);
  assert.deepEqual(payload('slack', 'KUA', ['a', 'b']), { text: '*KUA*\na\nb' });
  const card = payload('teams', 'KUA', ['a']);
  assert.equal(card.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.deepEqual(card.attachments[0].content.body.map(block => block.text), ['KUA', 'a']);
});

test('webhooks need Pro or Team, keep the URL secret and validate their settings', () => {
  const free = fixture({ plan: PLANS.free });
  assert.throws(() => free.dispatcher.create({ name: 'ops', kind: 'slack', url: SLACK }), err => err.code === 'PLAN_REQUIRED' && err.required === 'pro');
  assert.doesNotThrow(() => fixture({ plan: PLANS.pro }).dispatcher.create({ name: 'ops', kind: 'slack', url: SLACK }));

  const { dispatcher, stored } = fixture();
  const created = dispatcher.create({ name: 'ops', kind: 'slack', url: SLACK, minSeverity: 'medium', lang: 'es' });
  assert.equal(created.url, 'https://hooks.slack.com/…mnop');
  assert.deepEqual(dispatcher.list().map(item => [item.name, item.url, item.minSeverity, item.lang, item.enabled]), [['ops', 'https://hooks.slack.com/…mnop', 'medium', 'es', true]]);
  assert.match(stored(), /abcdefghijklmnop/, 'the full URL is kept in the secret store only');
  assert.throws(() => dispatcher.create({ name: '', kind: 'slack', url: SLACK }), /name is required/);
  assert.throws(() => dispatcher.update(created.id, { minSeverity: 'low' }), /minSeverity/);
  assert.equal(dispatcher.update(created.id, { enabled: false }).enabled, false);
  assert.equal(dispatcher.remove(created.id), true);
  assert.equal(dispatcher.remove(created.id), false);
});

test('the alerts of one analysis go in one message per channel, filtered by severity', async () => {
  const { dispatcher, sent } = fixture();
  dispatcher.create({ name: 'slack', kind: 'slack', url: SLACK, minSeverity: 'high' });
  dispatcher.create({ name: 'teams', kind: 'teams', url: TEAMS, minSeverity: 'all' });
  for (const item of [alert('new_finding', 'high'), alert('new_finding', 'medium'), alert('fixed', 'info')]) dispatcher.notify(item);
  const results = await dispatcher.flush();
  assert.deepEqual(results.map(result => [result.ok, result.lines]), [[true, 1], [true, 3]]);
  assert.equal(sent[0].url, SLACK);
  assert.match(sent[0].body.text, /^\*KUA posture alerts\*\n🔴 New finding: /);
  assert.equal(sent[1].body.attachments[0].content.body.length, 4);
  assert.equal(dispatcher.list()[0].lastError, null);
});

test('nothing is sent on the Free plan, and a failing channel records its error', async () => {
  const pro = fixture({ plan: PLANS.team });
  pro.dispatcher.create({ name: 'ops', kind: 'slack', url: SLACK });
  const downgraded = createWebhookDispatcher({ secrets: { get: () => pro.stored(), set() {} }, plan: () => PLANS.free, fetchImpl: async () => { throw new Error('must not send'); }, debounceMs: 1 });
  downgraded.notify(alert('new_finding', 'high'));
  assert.deepEqual(await downgraded.flush(), []);

  const failing = fixture({ fail: true });
  const created = failing.dispatcher.create({ name: 'ops', kind: 'slack', url: SLACK });
  assert.deepEqual(await failing.dispatcher.test(created.id), { ok: false, error: 'Slack answered 404' });
  assert.equal(failing.dispatcher.list()[0].lastError, 'Slack answered 404');
  assert.match(failing.sent[0].body.text, /test message/i);
});
