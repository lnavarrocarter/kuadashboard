'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createLogCache, planWindow, estimateDailyBytes, MAX_WINDOW_MS, MIN_WINDOW_MS, HOT_MS } = require('./awsLogCache');
const { sealBlock, openBlock } = require('./logCacheCrypto');

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 1, 12);
const KEY = { profileId: 'p1', region: 'us-east-1' };

class FilterLogEventsCommand { constructor(input) { this.input = input; } }

function fakeClient(pages) {
  const calls = [];
  return {
    calls,
    async send(command) {
      calls.push(command.input);
      const page = typeof pages === 'function' ? pages(command.input, calls.length - 1) : pages[calls.length - 1];
      return page || { events: [] };
    },
  };
}

function cache(options = {}) {
  return createLogCache({ dataDir: ':memory:', now: () => NOW, ...options });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kua-log-cache-'));
}

test('estimateDailyBytes averages stored bytes over retention or age', () => {
  assert.equal(estimateDailyBytes({ storedBytes: 700, retentionInDays: 7 }, NOW), 100);
  assert.equal(estimateDailyBytes({ storedBytes: 1000, retentionInDays: null, creationTime: NOW - 10 * DAY }, NOW), 100);
  assert.equal(estimateDailyBytes({ storedBytes: 0 }, NOW), 0);
});

test('planWindow keeps 7 days for small groups and shrinks big ones', () => {
  assert.deepEqual(planWindow({ storedBytes: 7 * 1024, retentionInDays: 7 }, { budgetBytes: 1024 * 1024, now: NOW }),
    { windowMs: MAX_WINDOW_MS, dailyBytes: 1024, limitedBySize: false });
  const big = planWindow({ storedBytes: 70 * 1024 * 1024, retentionInDays: 7 }, { budgetBytes: 20 * 1024 * 1024, now: NOW });
  assert.equal(big.windowMs, 2 * DAY);
  assert.equal(big.limitedBySize, true);
  const huge = planWindow({ storedBytes: 1e12, retentionInDays: 1 }, { budgetBytes: 1024, now: NOW });
  assert.equal(huge.windowMs, MIN_WINDOW_MS);
});

test('the budget is shared between cached groups', () => {
  const c = cache({ budgetBytes: 14 * 1024 * 1024 });
  c.enable({ ...KEY, logGroup: '/a', storedBytes: 7 * 1024 * 1024, retentionInDays: 7 });
  assert.equal(c.describeGroup('p1', 'us-east-1', '/a').windowMs, MAX_WINDOW_MS);
  c.enable({ ...KEY, logGroup: '/b', storedBytes: 7 * 1024 * 1024, retentionInDays: 7 });
  assert.equal(c.describeGroup('p1', 'us-east-1', '/a').windowMs, 7 * DAY);
  c.enable({ ...KEY, logGroup: '/c', storedBytes: 14 * 1024 * 1024, retentionInDays: 7 });
  assert.ok(c.describeGroup('p1', 'us-east-1', '/a').windowMs < MAX_WINDOW_MS);
  c.disable({ ...KEY, logGroup: '/c' });
  assert.equal(c.describeGroup('p1', 'us-east-1', '/a').windowMs, MAX_WINDOW_MS);
});

test('sealed blocks are compressed, encrypted and bound to their log group', async () => {
  const key = crypto.randomBytes(32);
  const scope = { ...KEY, logGroup: '/a' };
  const events = Array.from({ length: 500 }, (_, i) => ({ timestamp: NOW + i, logStreamName: 's', id: `id${i}`, message: `INFO processed order ${i} for customer acme` }));
  const { payload, rawBytes } = await sealBlock(key, scope, events);
  assert.ok(payload.length * 5 < rawBytes, `compressed ${rawBytes} → ${payload.length}`);
  assert.ok(!payload.toString('latin1').includes('processed order'));
  assert.deepEqual(await openBlock(key, scope, payload), events);
  await assert.rejects(openBlock(key, { ...scope, logGroup: '/b' }, payload));
  await assert.rejects(openBlock(crypto.randomBytes(32), scope, payload));
});

test('events are unreadable in the database file without the key', async () => {
  const dir = tempDir();
  try {
    const key = crypto.randomBytes(32);
    const c = createLogCache({ dataDir: dir, key, now: () => NOW });
    c.enable({ ...KEY, logGroup: '/a' });
    await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: '1', timestamp: NOW - 1000, message: 'SECRET-PAYLOAD order 42' }] });
    assert.equal((await c.query({ ...KEY, logGroup: '/a' }))[0].message, 'SECRET-PAYLOAD order 42');
    c.close();
    const bytes = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f)).toString('latin1')).join('');
    assert.ok(!bytes.includes('SECRET-PAYLOAD'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a different key drops the unreadable blocks and resets sync state', async () => {
  const dir = tempDir();
  try {
    const first = createLogCache({ dataDir: dir, key: crypto.randomBytes(32), now: () => NOW });
    first.enable({ ...KEY, logGroup: '/a' });
    await first.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: '1', timestamp: NOW - 1000, message: 'x' }] });
    first.close();
    const second = createLogCache({ dataDir: dir, key: crypto.randomBytes(32), now: () => NOW });
    assert.deepEqual(await second.query({ ...KEY, logGroup: '/a' }), []);
    assert.equal(second.describeGroup('p1', 'us-east-1', '/a').blocks, 0);
    second.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the plain-text cache of the first version is migrated into sealed blocks', async () => {
  const dir = tempDir();
  try {
    const legacy = new Database(path.join(dir, 'aws-log-cache.sqlite3'));
    legacy.exec(`
      CREATE TABLE log_cache_groups (profile_id TEXT, region TEXT, log_group TEXT, window_ms INTEGER, stored_bytes INTEGER, retention_days INTEGER,
        creation_time INTEGER, synced_until INTEGER, last_sync_at INTEGER, last_sync_status TEXT, last_error TEXT, created_at INTEGER,
        PRIMARY KEY (profile_id, region, log_group));
      CREATE TABLE log_cache_events (profile_id TEXT, region TEXT, log_group TEXT, event_id TEXT, log_stream TEXT, ts INTEGER, message TEXT, bytes INTEGER,
        PRIMARY KEY (profile_id, region, log_group, event_id));
    `);
    legacy.prepare('INSERT INTO log_cache_groups VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?)').run('p1', 'us-east-1', '/a', MAX_WINDOW_MS, NOW, NOW);
    legacy.prepare('INSERT INTO log_cache_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('p1', 'us-east-1', '/a', 'e1', 's', NOW - 1000, 'old plain text', 14);
    legacy.close();

    const c = createLogCache({ dataDir: dir, key: crypto.randomBytes(32), now: () => NOW });
    assert.deepEqual((await c.query({ ...KEY, logGroup: '/a' })).map(e => e.message), ['old plain text']);
    assert.equal(c.describeGroup('p1', 'us-east-1', '/a').coverageFrom, null, 'new columns are added');
    assert.equal(await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: 'e1', timestamp: NOW - 1000, message: 'old plain text' }] }), 0, 'migrated ids still dedupe');
    c.close();
    const check = new Database(path.join(dir, 'aws-log-cache.sqlite3'), { readonly: true });
    assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name = 'log_cache_events'").get(), undefined);
    check.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the first sync reads the recent hours first and backfills older ones with the pages left', async () => {
  const c = cache();
  c.enable({ ...KEY, logGroup: '/g' });
  const ranges = [];
  const client = fakeClient(input => {
    ranges.push([input.startTime, input.endTime]);
    if (input.startTime === NOW - HOT_MS) return { events: [{ eventId: 'recent', timestamp: NOW - HOUR, message: 'recent' }] };
    return { events: [{ eventId: `old${ranges.length}`, timestamp: input.startTime + 1000, message: 'old' }], nextToken: 'more' };
  });
  const first = await c.syncGroup({ ...KEY, logGroup: '/g', client, FilterLogEventsCommand, maxPages: 3 });
  assert.deepEqual(ranges[0], [NOW - HOT_MS, NOW], 'recent hours first');
  assert.deepEqual(ranges[1], [NOW - MAX_WINDOW_MS, NOW - HOT_MS], 'then the older part of the window');
  assert.equal(first.status, 'partial');
  assert.equal(first.group.backfillPending, true);

  ranges.length = 0;
  await c.syncGroup({ ...KEY, logGroup: '/g', client: fakeClient(input => { ranges.push([input.startTime, input.endTime]); return { events: [] }; }), FilterLogEventsCommand });
  assert.deepEqual(ranges[0], [NOW - 60 * 1000, NOW], 'continues from the last sync');
  assert.ok(ranges[1][0] > NOW - MAX_WINDOW_MS, 'backfill resumes from its cursor');
  assert.equal(c.describeGroup('p1', 'us-east-1', '/g').backfillPending, false);
});

test('ingest deduplicates against stored blocks and older hot blocks are compacted per hour', async () => {
  let now = NOW;
  const c = createLogCache({ dataDir: ':memory:', now: () => now });
  c.enable({ ...KEY, logGroup: '/a' });
  for (let i = 0; i < 4; i++) {
    assert.equal(await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: `e${i}`, timestamp: NOW - 30 * 60 * 1000 + i, message: `m${i}` }] }), 1);
  }
  assert.equal(await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: 'e1', timestamp: NOW - 30 * 60 * 1000 + 1, message: 'm1' }] }), 0);
  assert.equal(c.describeGroup('p1', 'us-east-1', '/a').hotBlocks, 4);
  now = NOW + HOT_MS + HOUR;
  assert.equal(await c.compact(), 4);
  const group = c.describeGroup('p1', 'us-east-1', '/a');
  assert.deepEqual([group.blocks, group.hotBlocks, group.events], [1, 0, 4]);
  assert.deepEqual((await c.query({ ...KEY, logGroup: '/a' })).map(e => e.message), ['m3', 'm2', 'm1', 'm0']);
});

test('prune drops blocks outside the window and the oldest blocks while over budget', async () => {
  const c = cache({ budgetBytes: 1 });
  c.enable({ ...KEY, logGroup: '/a' });
  await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: 'old', timestamp: NOW - 8 * DAY, message: 'stale' }] });
  await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: 'mid', timestamp: NOW - 2 * HOUR, message: 'mid' }] });
  await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: 'new', timestamp: NOW - 1000, message: 'new' }] });
  c.prune();
  assert.equal(c.summary().totalEvents, 0, 'a 1-byte budget keeps nothing');

  const roomy = cache();
  roomy.enable({ ...KEY, logGroup: '/a' });
  await roomy.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: 'old', timestamp: NOW - 8 * DAY, message: 'stale' }, { eventId: 'new', timestamp: NOW - 1000, message: 'new' }] });
  // both events share one block (inserted together); a separate old block is dropped by age
  await roomy.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: 'older', timestamp: NOW - 9 * DAY, message: 'older' }] });
  assert.equal(roomy.prune(), 1);
});

test('the oldest blocks go first when the budget is exceeded', async () => {
  const c = cache();
  c.enable({ ...KEY, logGroup: '/a' });
  for (let h = 5; h >= 1; h--) await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: `h${h}`, timestamp: NOW - h * HOUR, message: `hour ${h} ${'x'.repeat(200)}` }] });
  const perBlock = c.describeGroup('p1', 'us-east-1', '/a').bytes / 5;
  const tight = createLogCache({ dataDir: ':memory:', now: () => NOW, budgetBytes: Math.ceil(perBlock * 2.5) });
  tight.enable({ ...KEY, logGroup: '/a' });
  for (let h = 5; h >= 1; h--) await tight.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: `h${h}`, timestamp: NOW - h * HOUR, message: `hour ${h} ${'x'.repeat(200)}` }] });
  tight.prune();
  assert.deepEqual((await tight.query({ ...KEY, logGroup: '/a' })).map(e => e.message.split(' ').slice(0, 2).join(' ')), ['hour 1', 'hour 2']);
});

test('syncGroup reports a deleted log group without throwing', async () => {
  const c = cache();
  c.enable({ ...KEY, logGroup: '/gone' });
  const client = { async send() { throw Object.assign(new Error('nope'), { name: 'ResourceNotFoundException' }); } };
  const result = await c.syncGroup({ ...KEY, logGroup: '/gone', client, FilterLogEventsCommand });
  assert.equal(result.status, 'missing');
  assert.equal(result.group.lastSyncStatus, 'missing');
});

test('scan returns the newest events of a range and flags truncation', async () => {
  const c = cache();
  c.enable({ ...KEY, logGroup: '/a' });
  for (const i of [4, 3, 2, 1]) await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ eventId: `e${i}`, timestamp: NOW - i * 1000, message: `m${i}` }] });
  const { events, truncated } = await c.scan({ ...KEY, logGroup: '/a', from: NOW - 3500, max: 2 });
  assert.deepEqual(events.map(e => e.message), ['m1', 'm2']);
  assert.equal(truncated, true);
  assert.equal((await c.scan({ ...KEY, logGroup: '/a', from: NOW - 3500 })).truncated, false);
});

test('query filters by text, stream and time', async () => {
  const c = cache();
  c.enable({ ...KEY, logGroup: '/a' });
  await c.insertEvents({ ...KEY, logGroup: '/a', events: [
    { eventId: '1', timestamp: NOW - 3000, message: 'ERROR 100% failed', logStreamName: 'i-0abc1234' },
    { eventId: '2', timestamp: NOW - 2000, message: 'error 1000 ok', logStreamName: 'other' },
    { eventId: '3', timestamp: NOW - 1000, message: 'info', logStreamName: 'i-0abc1234' },
  ] });
  assert.deepEqual((await c.query({ ...KEY, logGroup: '/a', text: '100%' })).map(e => e.message), ['ERROR 100% failed']);
  assert.equal((await c.query({ ...KEY, logGroup: '/a', stream: 'i-0abc1234' })).length, 2);
  assert.equal((await c.query({ ...KEY, logGroup: '/a', from: NOW - 1500 })).length, 1);
  assert.equal((await c.query({ ...KEY, region: 'eu-west-1', logGroup: '/a' })).length, 0);
});

test('the same event from FilterLogEvents and from Logs Insights is stored once', async () => {
  const c = cache();
  c.enable({ ...KEY, logGroup: '/a' });
  const live = { eventId: '37810209384756', timestamp: NOW - 5000, logStreamName: 'pod-1', message: 'ERROR boom' };
  assert.equal(await c.insertEvents({ ...KEY, logGroup: '/a', events: [live] }), 1);
  const insights = { timestamp: NOW - 5000, logStreamName: 'pod-1', message: 'ERROR boom' };
  assert.equal(await c.insertEvents({ ...KEY, logGroup: '/a', events: [insights] }), 0);
  assert.equal(await c.insertEvents({ ...KEY, logGroup: '/a', events: [{ ...insights, message: 'ERROR other' }] }), 1);
});
