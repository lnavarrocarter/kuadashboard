'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { ApmDatabase } = require('../lib/apm/database');
const { PostureStore } = require('../lib/advisor/posture');
const { PLANS } = require('../lib/plans');
const { createAdvisorRouter } = require('./advisor');

async function withServer({ plan = PLANS.pro } = {}, run) {
  const database = new ApmDatabase({ filePath: ':memory:' });
  const store = new PostureStore(database.db);
  const audit = [];
  const app = express();
  app.use(express.json());
  app.use('/api/advisor', createAdvisorRouter({ store: () => store, auditLog: { log: entry => audit.push(entry) }, plan: () => plan, author: () => 'ana@example.com' }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/advisor`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try { await run({ call, store, audit }); } finally { server.close(); database.close(); }
}

test('accepting a finding is recorded with its author and in the audit log; revoking ends it', async () => {
  await withServer({}, async ({ call, audit }) => {
    const created = await call('POST', '/acceptances', { scope: 'aws:p1', ruleId: 'aws.public_ip', resources: [{ kind: 'Instance', name: 'bastion' }], kind: 'accepted', reason: 'Bastion behind an allow list' });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.map(item => [item.ruleId, item.resourceLabel, item.author]), [['aws.public_ip', 'Instance bastion', 'ana@example.com']]);
    assert.deepEqual(audit[0], { category: 'advisor', action: 'Advisor risk accepted', resource: 'aws.public_ip', details: { scope: 'aws:p1', reason: 'Bastion behind an allow list', expiresAt: null, resources: ['Instance bastion'] } });

    assert.equal((await call('GET', '/acceptances?scope=aws:p1')).body.length, 1);
    const revoked = await call('DELETE', `/acceptances/${created.body[0].id}`);
    assert.equal(revoked.status, 200);
    assert.equal(audit[1].action, 'Advisor acceptance revoked');
    assert.equal((await call('GET', '/acceptances?scope=aws:p1')).body.length, 0);
    assert.equal((await call('DELETE', `/acceptances/${created.body[0].id}`)).status, 404);
  });
});

test('invalid requests are refused with the reason', async () => {
  await withServer({}, async ({ call }) => {
    assert.equal((await call('POST', '/acceptances', { scope: 'other:x', ruleId: 'r', reason: 'x' })).status, 400);
    const noReason = await call('POST', '/acceptances', { scope: 'aws:p1', ruleId: 'aws.root_mfa', reason: '' });
    assert.equal(noReason.status, 400);
    assert.match(noReason.body.error, /reason is required/);
    assert.equal((await call('GET', '/acceptances')).status, 400);
  });
});

test('Free cannot accept findings or read the posture history', async () => {
  await withServer({ plan: PLANS.free }, async ({ call }) => {
    const accept = await call('POST', '/acceptances', { scope: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x' });
    assert.equal(accept.status, 403);
    assert.deepEqual([accept.body.code, accept.body.required], ['PLAN_REQUIRED', 'pro']);
    assert.equal((await call('GET', '/history?scope=aws:p1:us-east-1')).status, 403);
  });
});

test('history returns the recorded points of a scope', async () => {
  await withServer({}, async ({ call, store }) => {
    store.record('kubernetes:ctx:all', { summary: { security: { high: 1, medium: 0, low: 0, findings: 1, passed: 3, checks: 4 } }, findings: [{ id: 'k8s.privileged', category: 'security', severity: 'high', count: 2 }] });
    const history = await call('GET', '/history?scope=kubernetes:ctx:all&days=30');
    assert.equal(history.status, 200);
    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].summary.security.passed, 3);
  });
});

test('alerts are listed newest first and can be marked read; Free cannot read them', async () => {
  await withServer({}, async ({ call, store }) => {
    store.addAlert({ scopeKey: 'aws:p1:us-east-1', type: 'new_finding', ruleId: 'aws.root_mfa', severity: 'high', data: { count: 1 } });
    store.addAlert({ scopeKey: 'aws:p1:us-east-1', type: 'fixed', ruleId: 'aws.public_ip', severity: 'info' });
    const list = await call('GET', '/alerts');
    assert.equal(list.status, 200);
    assert.equal(list.body.unread, 2);
    assert.deepEqual(list.body.alerts.map(a => a.ruleId).sort(), ['aws.public_ip', 'aws.root_mfa']);

    assert.deepEqual((await call('POST', '/alerts/read', { ids: [list.body.alerts[0].id] })).body, { changed: 1, unread: 1 });
    assert.deepEqual((await call('POST', '/alerts/read', { all: true })).body, { changed: 1, unread: 0 });
    assert.equal((await call('POST', '/alerts/read', {})).status, 400);
  });
  await withServer({ plan: PLANS.free }, async ({ call }) => {
    assert.equal((await call('GET', '/alerts')).status, 403);
  });
});

test('scheduled analyses are set within the plan, listed and removed, with audit entries', async () => {
  const set = new Map();
  const scheduler = {
    list: () => [...set.values()],
    set: (scope, hours) => {
      if (hours < 6) throw Object.assign(new Error('The pro plan analyses every 6 hours at most'), { statusCode: 403, code: 'PLAN_REQUIRED', required: 'team' });
      const schedule = { scope, intervalHours: hours };
      set.set(scope, schedule);
      return schedule;
    },
    remove: scope => set.delete(scope),
  };
  const database = new ApmDatabase({ filePath: ':memory:' });
  const audit = [];
  const app = express();
  app.use(express.json());
  app.use('/api/advisor', createAdvisorRouter({ store: () => new PostureStore(database.db), scheduler, auditLog: { log: entry => audit.push(entry) }, plan: () => PLANS.pro }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/advisor`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.deepEqual((await call('PUT', '/schedules', { scope: 'aws:p1:us-east-1', intervalHours: 6 })).body, { scope: 'aws:p1:us-east-1', intervalHours: 6 });
    const tooOften = await call('PUT', '/schedules', { scope: 'aws:p1:us-east-1', intervalHours: 1 });
    assert.deepEqual([tooOften.status, tooOften.body.required], [403, 'team']);
    assert.equal((await call('GET', '/schedules')).body.length, 1);
    assert.equal((await call('DELETE', '/schedules?scope=aws:p1:us-east-1')).status, 200);
    assert.equal((await call('DELETE', '/schedules?scope=aws:p1:us-east-1')).status, 404);
    assert.deepEqual(audit.map(entry => entry.action), ['Advisor scheduled analysis set', 'Advisor scheduled analysis stopped']);
  } finally { server.close(); database.close(); }
});
