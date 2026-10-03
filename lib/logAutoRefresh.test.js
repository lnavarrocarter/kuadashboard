'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PLANS, getPlan, checkRefreshMinutes, checkCacheBudgetMb, refreshRequestsPerDay } = require('./plans');
const { createBudgetStore } = require('./logCacheBudget');
const { createAutoRefresh } = require('./logAutoRefresh');
const { createLogCache } = require('./awsLogCache');

const MB = 1024 * 1024;
const MIN = 60000;
const NOW = Date.UTC(2026, 9, 3, 12);
const plan = name => ({ ...PLANS[name], source: 'test' });

test('the plan comes from KUA_PLAN until the desktop is linked, and defaults to free', () => {
  assert.equal(getPlan({}).plan, 'free');
  assert.equal(getPlan({ KUA_PLAN: 'Team' }).plan, 'team');
  assert.equal(getPlan({ KUA_PLAN: 'enterprise' }).plan, 'free');
  assert.equal(getPlan({ KUA_PLAN: 'pro' }).source, 'env');
});

test('refresh intervals and cache budgets follow the plan', () => {
  assert.equal(checkRefreshMinutes(null, plan('free')), null, 'turning it off is always allowed');
  assert.throws(() => checkRefreshMinutes(15, plan('free')), err => err.code === 'PLAN_REQUIRED' && err.required === 'pro');
  assert.throws(() => checkRefreshMinutes(5, plan('pro')), err => err.code === 'PLAN_REQUIRED' && err.required === 'team');
  assert.equal(checkRefreshMinutes(15, plan('pro')), 15);
  assert.equal(checkRefreshMinutes(1, plan('team')), 1);
  assert.throws(() => checkRefreshMinutes(7, plan('team')), err => err.statusCode === 400);

  assert.equal(checkCacheBudgetMb(256, plan('free')), 256 * MB);
  assert.throws(() => checkCacheBudgetMb(512, plan('free')), err => err.code === 'PLAN_REQUIRED' && err.required === 'pro');
  assert.throws(() => checkCacheBudgetMb(5120, plan('pro')), err => err.required === 'team');
  assert.equal(checkCacheBudgetMb(20480, plan('team')), 20480 * MB);
  assert.throws(() => checkCacheBudgetMb(30000, plan('team')), err => err.code === 'PLAN_REQUIRED' && err.required === null);
  assert.equal(refreshRequestsPerDay(15, 2), 192);
});

test('the budget store saves the choice, caps it by the plan and yields to KUA_LOG_CACHE_MB', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-budget-'));
  try {
    let active = plan('team');
    const store = createBudgetStore({ dataDir, env: {}, plan: () => active });
    assert.deepEqual([store.current().mb, store.current().source], [256, 'default']);
    assert.equal(store.save(5120).mb, 5120);
    active = plan('pro'); // plan downgraded: the saved value is capped
    assert.deepEqual([store.current().mb, store.current().capped], [2048, true]);
    assert.ok(store.choices().find(c => c.mb === 5120 && !c.allowed && c.plan === 'team'));

    const fromEnv = createBudgetStore({ dataDir, env: { KUA_LOG_CACHE_MB: '4096' }, plan: () => plan('free') });
    assert.deepEqual([fromEnv.current().mb, fromEnv.current().source], [4096, 'env']);
    assert.throws(() => fromEnv.save(256), err => err.statusCode === 409);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

/** FilterLogEvents fake: one event per request at the end of the asked range, records ranges. */
function fakeClient(ranges) {
  return {
    async send(command) {
      const { startTime, endTime } = command.input;
      ranges.push([startTime, endTime]);
      return { events: [{ eventId: `e${startTime}-${endTime}`, timestamp: endTime - 1, message: 'ERROR x' }] };
    },
  };
}

test('a latest-only sync reads the newest events and leaves the history backfill pending', async () => {
  let now = NOW;
  const cache = createLogCache({ dataDir: ':memory:', now: () => now });
  const scope = { profileId: 'p', region: 'r', logGroup: '/g' };
  cache.enable({ ...scope, historyMs: 24 * 3600000 });
  const ranges = [];
  await cache.syncGroup({ ...scope, client: fakeClient(ranges), FilterLogEventsCommand: class { constructor(i) { this.input = i; } }, latestOnly: true });
  assert.equal(ranges.length, 1, 'no backfill request');
  assert.ok(ranges[0][0] >= NOW - 6 * 3600000, 'only the recent (hot) hours, not the 24 h history');

  now = NOW + 5 * MIN;
  ranges.length = 0;
  await cache.syncGroup({ ...scope, client: fakeClient(ranges), FilterLogEventsCommand: class { constructor(i) { this.input = i; } }, latestOnly: true });
  assert.ok(ranges[0][0] >= NOW - MIN, 'continues from where it synced');
  assert.equal(cache.describeGroup('p', 'r', '/g').backfillPending, true, 'history still to fill by manual syncs or scans');

  assert.equal(cache.setRefresh({ ...scope, minutes: 5 }).refreshMinutes, 5);
  assert.deepEqual(cache.refreshTargets().map(t => [t.logGroup, t.refreshMinutes]), [['/g', 5]]);
  assert.equal(cache.setRefresh({ ...scope, minutes: null }).refreshMinutes, null);
  assert.deepEqual(cache.refreshTargets(), []);

  const usage = await cache.setBudget(512 * MB);
  assert.equal(usage.budgetBytes, 512 * MB);
});

test('the scheduler refreshes due groups only, on paid plans, at the plan minimum interval', async () => {
  let now = NOW;
  let active = plan('free');
  const cache = createLogCache({ dataDir: ':memory:', now: () => now });
  for (const logGroup of ['/a', '/b']) cache.enable({ profileId: 'p', region: 'r', logGroup });
  cache.setRefresh({ profileId: 'p', region: 'r', logGroup: '/a', minutes: 1 });
  const ranges = [];
  const refresh = createAutoRefresh({ cache, clientFor: async () => fakeClient(ranges), plan: () => active, now: () => now, log: { warn() {} } });

  assert.deepEqual(await refresh.tick(), { skipped: 'plan' });
  assert.equal(ranges.length, 0, 'free plan: no requests');

  active = plan('pro');
  const first = await refresh.tick();
  assert.deepEqual(first.synced.map(s => s.logGroup), ['/a'], 'a group without refresh is never synced');
  now += 5 * MIN;
  assert.deepEqual((await refresh.tick()).synced, [], 'pro raises 1 minute to 15');
  now += 11 * MIN;
  assert.deepEqual((await refresh.tick()).synced.map(s => s.logGroup), ['/a']);
  assert.equal(refresh.statusOf({ profileId: 'p', region: 'r', logGroup: '/a', refreshMinutes: 1, lastSyncAt: now }).minutes, 15);

  active = plan('team');
  now += 1 * MIN;
  assert.deepEqual((await refresh.tick()).synced.map(s => s.logGroup), ['/a'], 'team keeps 1 minute');
});

test('the scheduler stops at the cache budget and records sync errors', async () => {
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW, budgetBytes: 1 });
  cache.enable({ profileId: 'p', region: 'r', logGroup: '/a' });
  cache.setRefresh({ profileId: 'p', region: 'r', logGroup: '/a', minutes: 1 });
  await cache.ingest({ profileId: 'p', region: 'r', logGroup: '/a', events: [{ eventId: '1', timestamp: NOW - 1000, message: 'x'.repeat(200) }] });
  const ranges = [];
  const full = createAutoRefresh({ cache, clientFor: async () => fakeClient(ranges), plan: () => plan('team'), now: () => NOW + 5 * MIN, log: { warn() {} } });
  assert.deepEqual((await full.tick()).synced, []);
  assert.equal(ranges.length, 0);
  assert.equal(full.statusOf({ profileId: 'p', region: 'r', logGroup: '/a', refreshMinutes: 1, lastSyncAt: null }).last.status, 'budget');

  const ok = createLogCache({ dataDir: ':memory:', now: () => NOW });
  ok.enable({ profileId: 'p', region: 'r', logGroup: '/b' });
  ok.setRefresh({ profileId: 'p', region: 'r', logGroup: '/b', minutes: 1 });
  const failing = createAutoRefresh({ cache: ok, clientFor: async () => ({ send: async () => { throw new Error('expired token'); } }), plan: () => plan('team'), now: () => NOW, log: { warn() {} } });
  await failing.tick();
  assert.equal(failing.statusOf({ profileId: 'p', region: 'r', logGroup: '/b', refreshMinutes: 1 }).last.error, 'expired token');
});

test('desktop plans keep the same names, features and log limits as the control plane', () => {
  const cloud = require('../cloud/control-plane/src/entitlements').PLANS;
  for (const name of ['free', 'pro', 'team']) {
    assert.equal(PLANS[name].features.logAutoRefresh, cloud[name].features.logAutoRefresh, name);
    assert.equal(PLANS[name].features.teamSharing, cloud[name].features.teamSharing, name);
    assert.equal(PLANS[name].limits.logCacheMaxMb, cloud[name].limits.logCacheMaxMb, name);
    assert.equal(PLANS[name].limits.logRefreshMinMinutes, cloud[name].limits.logRefreshMinMinutes, name);
  }
});
