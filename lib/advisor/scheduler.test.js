'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { ApmDatabase } = require('../apm/database');
const { PLANS } = require('../plans');
const { createAdvisorScheduler, ScheduleStore, loopbackRequest, parseScope } = require('./scheduler');

const HOUR = 60 * 60 * 1000;
const EKS = 'arn:aws:eks:us-east-1:111:cluster/shop';

function fixture({ plan = PLANS.pro, context = EKS } = {}) {
  let clock = Date.parse('2026-10-05T10:00:00Z');
  const database = new ApmDatabase({ filePath: ':memory:' });
  const schedules = new ScheduleStore(database.db, { now: () => clock });
  const calls = [];
  let answer = () => ({ findings: [] });
  const scheduler = createAdvisorScheduler({
    schedules,
    request: async (path, headers) => { calls.push({ path, headers }); return answer(path); },
    application: id => (id === 'app-1' ? { profileId: 'p-apps' } : null),
    currentContext: () => context,
    plan: () => plan,
    now: () => clock,
    log: { warn() {} },
  });
  return { scheduler, schedules, calls, tick: ms => { clock += ms; }, setAnswer: fn => { answer = fn; }, close: () => database.close() };
}

test('history scopes name what to analyse, also with colons in ids and contexts', () => {
  assert.deepEqual(parseScope('aws:local:prod:us-east-1'), { kind: 'aws', profileId: 'local:prod', region: 'us-east-1' });
  assert.deepEqual(parseScope(`kubernetes:${EKS}:all`), { kind: 'kubernetes', context: EKS, namespace: 'all' });
  assert.deepEqual(parseScope('gcp:p2:analytics'), { kind: 'gcp', profileId: 'p2', projectId: 'analytics' });
  assert.deepEqual(parseScope('product:app-1'), { kind: 'product', applicationId: 'app-1' });
  assert.deepEqual(parseScope('vercel:p3:team_abc'), { kind: 'vercel', profileId: 'p3', teamId: 'team_abc' });
  assert.equal(parseScope('aws:only'), null);
  assert.equal(parseScope('other:x:y'), null);
});

test('each scope calls the route its overview calls, on this KUA', () => {
  const { scheduler, close } = fixture();
  try {
    assert.deepEqual(scheduler.callFor('aws:p1:us-east-1'), { path: '/api/cloud/aws/overview/advisor?refresh=1', headers: { 'X-Profile-Id': 'p1' } });
    assert.deepEqual(scheduler.callFor('gcp:p2:analytics'), { path: '/api/cloud/gcp/overview?force=1', headers: { 'X-Profile-Id': 'p2' } });
    assert.deepEqual(scheduler.callFor('vercel:p3:personal'), { path: '/api/cloud/vercel/advisor?refresh=1', headers: { 'X-Profile-Id': 'p3' } });
    assert.deepEqual(scheduler.callFor('vercel:local-0123456789abcdef:personal'), { skip: 'token-only profile' });
    assert.deepEqual(scheduler.callFor(`kubernetes:${EKS}:shop`), { path: '/api/overview?namespace=shop', headers: {} });
    assert.deepEqual(scheduler.callFor('kubernetes:other-cluster:all'), { skip: 'context not active' });
    assert.deepEqual(scheduler.callFor('product:app-1'), { path: '/api/architecture/applications/app-1/advisor', headers: { 'X-Profile-Id': 'p-apps' } });
    assert.deepEqual(scheduler.callFor('product:gone'), { skip: 'application not found' });
  } finally { close(); }
});

test('due schedules run once per interval; a run that cannot happen keeps its turn', async () => {
  const { scheduler, schedules, calls, tick, close } = fixture();
  try {
    scheduler.set('aws:p1:us-east-1', 6);
    scheduler.set('kubernetes:other-cluster:all', 12);
    assert.deepEqual(await scheduler.tick(), ['aws:p1:us-east-1']);
    assert.equal(schedules.get('kubernetes:other-cluster:all').lastStatus, 'skipped');
    assert.equal(schedules.get('aws:p1:us-east-1').lastStatus, 'ok');
    assert.equal(schedules.get('aws:p1:us-east-1').nextRunAt, '2026-10-05T16:00:00.000Z');

    tick(5 * HOUR);
    assert.deepEqual(await scheduler.tick(), []);
    tick(HOUR);
    assert.deepEqual(await scheduler.tick(), ['aws:p1:us-east-1']);
    assert.equal(calls.length, 2);
  } finally { close(); }
});

test('errors are recorded per scope and do not stop the others', async () => {
  const { scheduler, schedules, setAnswer, close } = fixture();
  try {
    scheduler.set('aws:p1:us-east-1', 6);
    scheduler.set('product:app-1', 6);
    setAnswer(path => {
      if (path.startsWith('/api/cloud/aws')) throw new Error('ExpiredToken: the SSO session has expired');
      return { error: 'no telemetry yet' };
    });
    await scheduler.tick();
    assert.deepEqual([schedules.get('aws:p1:us-east-1').lastStatus, schedules.get('aws:p1:us-east-1').lastError], ['error', 'ExpiredToken: the SSO session has expired']);
    assert.deepEqual([schedules.get('product:app-1').lastStatus, schedules.get('product:app-1').lastError], ['error', 'no telemetry yet']);
  } finally { close(); }
});

test('the plan sets the shortest interval; Free stores nothing and runs nothing', async () => {
  const pro = fixture();
  try {
    assert.throws(() => pro.scheduler.set('aws:p1:us-east-1', 1), err => err.code === 'PLAN_REQUIRED' && err.required === 'team');
    assert.throws(() => pro.scheduler.set('aws:p1:us-east-1', 3), /intervalHours must be one of 1, 6, 12, 24/);
  } finally { pro.close(); }

  const team = fixture({ plan: PLANS.team });
  try { assert.equal(team.scheduler.set('aws:p1:us-east-1', 1).intervalHours, 1); } finally { team.close(); }

  const free = fixture({ plan: PLANS.free });
  try {
    assert.throws(() => free.scheduler.set('aws:p1:us-east-1', 24), err => err.code === 'PLAN_REQUIRED' && err.required === 'pro');
    free.schedules.set('aws:p1:us-east-1', 6);
    assert.deepEqual(await free.scheduler.tick(), []);
    assert.equal(free.calls.length, 0);
  } finally { free.close(); }
});

test('a plan that lowered its limit stretches the interval', async () => {
  let plan = PLANS.team;
  let clock = Date.parse('2026-10-05T10:00:00Z');
  const database = new ApmDatabase({ filePath: ':memory:' });
  const schedules = new ScheduleStore(database.db, { now: () => clock });
  const scheduler = createAdvisorScheduler({ schedules, request: async () => ({}), plan: () => plan, now: () => clock });
  try {
    scheduler.set('aws:p1:us-east-1', 1);
    await scheduler.tick();
    plan = PLANS.pro;
    clock += 2 * HOUR;
    assert.deepEqual(await scheduler.tick(), []);
    clock += 4 * HOUR;
    assert.deepEqual(await scheduler.tick(), ['aws:p1:us-east-1']);
  } finally { database.close(); }
});

test('loopbackRequest reads this KUA and relays its errors', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/overview?namespace=all') return res.end(JSON.stringify({ advisor: { findings: [] }, profile: req.headers['x-profile-id'] || null }));
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'AccessDenied' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = loopbackRequest(server.address().port);
    assert.deepEqual(await request('/api/overview?namespace=all', { 'X-Profile-Id': 'p1' }), { advisor: { findings: [] }, profile: 'p1' });
    await assert.rejects(request('/api/cloud/aws/overview/advisor'), /AccessDenied/);
  } finally { server.close(); }
});
