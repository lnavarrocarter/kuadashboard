'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogCache } = require('./awsLogCache');
const { createScanRunner, estimateScan, describeLogGroup } = require('./awsLogScans');
const { createBackgroundTaskRegistry } = require('./backgroundTaskRegistry');
const { createScanTaskRegistryBinding } = require('./logScanRunner');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 2, 12);
const SCOPE = { profileId: 'p1', region: 'us-east-1', logGroup: '/aws/lambda/orders' };

class FilterLogEventsCommand { constructor(input) { this.input = input; } }

// Two pages per hour: one event near the end of the hour, one near the start.
function hourlyClient({ fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async send(command) {
      const input = command.input;
      calls.push(input);
      if (fail) {
        const error = fail(input, calls.length);
        if (error) throw error;
      }
      if (!input.nextToken) {
        return { events: [{ timestamp: input.endTime - 1000, logStreamName: 's', message: `late ${input.endTime}` }], nextToken: 'more' };
      }
      return { events: [{ timestamp: input.startTime + 1000, logStreamName: 's', message: `early ${input.startTime}` }] };
    },
  };
}

function setup({ client = hourlyClient(), budgetBytes, concurrency = 2, cacheOptions = {} } = {}) {
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW, ...(budgetBytes ? { budgetBytes } : {}), ...cacheOptions });
  // A busy group: its planned window is shorter than the scan.
  cache.enable({ ...SCOPE, storedBytes: 900 * 1024 * 1024 * 1024, retentionInDays: 30, creationTime: NOW - 365 * DAY });
  const sleeps = [];
  const runner = createScanRunner({
    cache, clientFor: async () => client, FilterLogEventsCommand, concurrency,
    sleep: async ms => { sleeps.push(ms); }, now: () => NOW,
  });
  return { cache, runner, client, sleeps };
}

// Waits by time, not by event-loop turns: compression and encryption run on
// the thread pool, which is much slower on CI runners.
async function settled(runner, id, statuses = ['done', 'paused', 'cancelled', 'error', 'budget'], timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scan = runner.get(id);
    if (statuses.includes(scan.status) && runner.activeCount() === 0) return scan;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`scan ${id} did not settle: ${runner.get(id).status}`);
}

test('a scan reads its range newest hour first and keeps events beyond the group window', async () => {
  const { cache, runner, client } = setup();
  assert.ok(cache.describeGroup(SCOPE.profileId, SCOPE.region, SCOPE.logGroup).windowMs < 2 * DAY);
  const started = runner.start({ ...SCOPE, from: NOW - 2 * DAY, to: NOW });
  const scan = await settled(runner, started.id);

  assert.equal(scan.status, 'done');
  assert.equal(scan.progress, 1);
  assert.equal(scan.pages, 96);
  assert.equal(scan.fetched, 96);
  // Newest hour first, each hour fully paged before moving on.
  assert.deepEqual([client.calls[0].startTime, client.calls[0].endTime], [NOW - HOUR, NOW]);
  assert.equal(client.calls[1].nextToken, 'more');
  assert.deepEqual([client.calls[2].startTime, client.calls[2].endTime], [NOW - 2 * HOUR, NOW - HOUR]);

  const oldest = await cache.query({ ...SCOPE, from: NOW - 2 * DAY, to: NOW - 2 * DAY + HOUR, limit: 10 });
  assert.equal(oldest.length, 2, 'events older than the planned window stay cached thanks to the pin');
  assert.equal(cache.describeGroup(SCOPE.profileId, SCOPE.region, SCOPE.logGroup).pinnedFrom, NOW - 2 * DAY);
  await cache.maintain();
  assert.equal((await cache.query({ ...SCOPE, from: NOW - 2 * DAY, to: NOW - 2 * DAY + HOUR, limit: 10 })).length, 2, 'pruning keeps the pinned range');
});

test('scans are capped at 5 days', () => {
  const { runner } = setup();
  const scan = runner.start({ ...SCOPE, from: NOW - 9 * DAY, to: NOW });
  assert.equal(scan.to - scan.from, 5 * DAY);
  runner.cancel(scan.id);
});

test('pause keeps progress and resume finishes the remaining hours', async () => {
  let runner;
  let id;
  const client = hourlyClient({ fail: (input, n) => { if (n === 5) runner.pause(id); return null; } });
  ({ runner } = setup({ client }));
  id = runner.start({ ...SCOPE, from: NOW - 4 * HOUR, to: NOW }).id;

  const paused = await settled(runner, id);
  assert.equal(paused.status, 'paused');
  assert.ok(paused.progress > 0 && paused.progress < 1);
  assert.equal(paused.cursor, NOW - 2 * HOUR, 'the cursor only moves past complete hours');

  runner.resume(id);
  const done = await settled(runner, id);
  assert.equal(done.status, 'done');
  assert.equal(done.fetched, 9, 'the interrupted hour is read again and deduplicated by the cache');
  assert.equal(done.inserted, 8);
});

test('cancel, remove and concurrency limits', async () => {
  const { runner } = setup({ concurrency: 1 });
  const first = runner.start({ ...SCOPE, from: NOW - HOUR, to: NOW });
  const second = runner.start({ ...SCOPE, from: NOW - 2 * HOUR, to: NOW });
  assert.equal(runner.get(first.id).status, 'running');
  assert.equal(runner.get(second.id).status, 'queued');
  assert.throws(() => runner.remove(first.id), /Pause or cancel/);
  assert.equal(runner.cancel(second.id).status, 'cancelled');
  await settled(runner, first.id);
  assert.equal(runner.get(first.id).status, 'done');
  assert.equal(runner.remove(second.id), true);
  assert.equal(runner.get(second.id), null);
});

test('cancelling one running scan waits for its pending page and leaves concurrent scans alone', async () => {
  const { cache } = setup({ concurrency: 2 });
  const otherScope = { ...SCOPE, logGroup: '/aws/lambda/other' };
  cache.enable(otherScope);
  const pending = new Map();
  const started = new Map();
  const reached = new Map();
  for (const scope of [SCOPE, otherScope]) reached.set(scope.logGroup, new Promise(resolve => started.set(scope.logGroup, resolve)));
  const registry = createBackgroundTaskRegistry();
  let runner;
  const binding = createScanTaskRegistryBinding(registry, () => runner);
  runner = createScanRunner({
    cache,
    clientFor: async () => ({ send: command => new Promise(resolve => {
      const logGroup = command.input.logGroupName;
      pending.set(logGroup, resolve);
      started.get(logGroup)();
    }) }),
    FilterLogEventsCommand,
    concurrency: 2,
    sleep: async () => {},
    now: () => NOW,
    onChange: scan => binding.publish(scan),
  });
  const first = runner.start({ ...SCOPE, from: NOW - HOUR, to: NOW });
  const second = runner.start({ ...otherScope, from: NOW - HOUR, to: NOW });
  await Promise.all([...reached.values()]);

  const control = await registry.control(`logs.scan.${first.id}`, 'cancel');
  assert.equal(control.task.state, 'cancellation_requested');
  assert.equal(runner.get(first.id).status, 'running', 'the persisted scan remains running until its request reaches a safe point');
  assert.equal(registry.get(`logs.scan.${second.id}`).state, 'running');

  pending.get(SCOPE.logGroup)({ events: [] });
  pending.get(otherScope.logGroup)({ events: [] });
  const [cancelled, completed] = await Promise.all([settled(runner, first.id), settled(runner, second.id)]);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(completed.status, 'done');
  assert.equal(registry.get(`logs.scan.${first.id}`).state, 'cancelled');
  assert.equal(registry.get(`logs.scan.${second.id}`).state, 'completed');
});

test('a scan stops when the cache reaches its budget', async () => {
  const { runner } = setup({ budgetBytes: 1 });
  const scan = await settled(runner, runner.start({ ...SCOPE, from: NOW - 3 * HOUR, to: NOW }).id);
  assert.equal(scan.status, 'budget');
  assert.equal(scan.pages, 1);
  assert.match(scan.error, /budget/);
});

test('throttling is retried with backoff; expired credentials pause; missing groups fail', async () => {
  const throttled = setup({ client: hourlyClient({ fail: (input, n) => (n === 1 ? Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }) : null) }) });
  const ok = await settled(throttled.runner, throttled.runner.start({ ...SCOPE, from: NOW - HOUR, to: NOW }).id);
  assert.equal(ok.status, 'done');
  assert.ok(throttled.sleeps.includes(1000));

  const expired = setup({ client: hourlyClient({ fail: () => Object.assign(new Error('The security token included in the request is expired'), { name: 'ExpiredTokenException' }) }) });
  const paused = await settled(expired.runner, expired.runner.start({ ...SCOPE, from: NOW - HOUR, to: NOW }).id);
  assert.equal(paused.status, 'paused');
  assert.match(paused.error, /Credentials expired/);

  const missing = setup({ client: hourlyClient({ fail: () => Object.assign(new Error('gone'), { name: 'ResourceNotFoundException' }) }) });
  const failed = await settled(missing.runner, missing.runner.start({ ...SCOPE, from: NOW - HOUR, to: NOW }).id);
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'Log group not found');
});

test('removing the group cancels its scans, and a restart pauses interrupted ones', async () => {
  const { cache, runner } = setup();
  const scan = runner.start({ ...SCOPE, from: NOW - 3 * HOUR, to: NOW });
  cache.disable(SCOPE);
  const cancelled = await settled(runner, scan.id);
  assert.equal(cancelled.status, 'cancelled');

  cache.enable({ ...SCOPE });
  const orphan = cache.createScan({ ...SCOPE, from: NOW - HOUR, to: NOW });
  cache.updateScan(orphan.id, { status: 'running' });
  const restarted = createScanRunner({ cache, clientFor: async () => hourlyClient(), FilterLogEventsCommand, sleep: async () => {} });
  const listed = restarted.list({ profileId: SCOPE.profileId });
  assert.equal(listed.find(s => s.id === orphan.id).status, 'paused');
  assert.match(listed.find(s => s.id === orphan.id).error, /Interrupted/);
});

test('estimateScan limits the range by retention and checks the free budget', () => {
  const usage = { bytes: 100, budgetBytes: 1000 };
  const short = estimateScan({ group: { storedBytes: 300, retentionInDays: 3, creationTime: NOW - 30 * DAY }, days: 5, usage, now: NOW });
  assert.equal(short.days, 3);
  assert.equal(short.limitedBy, 'retention');
  assert.equal(short.estimatedBytes, 300);
  assert.equal(short.fits, true);
  const big = estimateScan({ group: { storedBytes: 30 * 1000, retentionInDays: 30, creationTime: NOW - 30 * DAY }, days: 9, usage, now: NOW });
  assert.equal(big.days, 5);
  assert.equal(big.fits, false);
  assert.equal(big.freeBytes, 900);
});

test('describeLogGroup returns the exact group, not a prefix match', async () => {
  class DescribeLogGroupsCommand { constructor(input) { this.input = input; } }
  const client = { send: async () => ({ logGroups: [{ logGroupName: '/a-b' }, { logGroupName: '/a' }] }) };
  assert.deepEqual(await describeLogGroup(client, DescribeLogGroupsCommand, '/a'), { logGroupName: '/a' });
  assert.equal(await describeLogGroup(client, DescribeLogGroupsCommand, '/c'), null);
});
