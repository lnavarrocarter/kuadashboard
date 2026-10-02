'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { logGroupVolume, volumePeriodSeconds } = require('./awsLogVolume');
const { MetricHistory } = require('./metricHistory');
const { createLogCache, MAX_WINDOW_MS } = require('./awsLogCache');

const NOW = Date.UTC(2026, 9, 1, 12);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

class GetMetricDataCommand { constructor(input) { this.input = input; } }

function metricHistory() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE kua_metric_points (provider TEXT, profile_id TEXT, region TEXT, resource_id TEXT, metric TEXT, period_s INTEGER, bucket_start INTEGER, value REAL,
      PRIMARY KEY (provider, profile_id, region, resource_id, metric, period_s, bucket_start));
    CREATE TABLE kua_metric_coverage (provider TEXT, profile_id TEXT, region TEXT, resource_id TEXT, metric TEXT, period_s INTEGER, covered_from INTEGER, covered_to INTEGER, fetched_at INTEGER,
      PRIMARY KEY (provider, profile_id, region, resource_id, metric, period_s));
  `);
  return new MetricHistory(db, { now: () => NOW });
}

test('volumePeriodSeconds follows the bin and CloudWatch resolution limits', () => {
  assert.equal(volumePeriodSeconds(30 * 1000, NOW - HOUR, NOW), 60, 'never below one minute');
  assert.equal(volumePeriodSeconds(15 * MIN, NOW - 24 * HOUR, NOW), 900);
  assert.equal(volumePeriodSeconds(MIN, NOW - 20 * 24 * HOUR, NOW), 300, '1-minute points expire after 15 days');
  assert.equal(volumePeriodSeconds(MIN, NOW - 70 * 24 * HOUR, NOW), 3600);
});

test('logGroupVolume reads IncomingLogEvents, fills empty bins and reuses the local history', async () => {
  const calls = [];
  const client = {
    async send(command) {
      calls.push(command.input);
      return { MetricDataResults: [{ Id: 'events', Timestamps: [new Date(NOW - 2 * HOUR), new Date(NOW - HOUR)], Values: [120, 30] }] };
    },
  };
  const history = metricHistory();
  const args = { client, GetMetricDataCommand, history, profileId: 'p', region: 'us-east-1', logGroup: '/aws/eks/app', from: NOW - 3 * HOUR, to: NOW, binMs: HOUR, now: NOW };
  const first = await logGroupVolume(args);
  assert.equal(first.requests, 1);
  assert.deepEqual(first.buckets.map(b => b.events), [0, 120, 30]);
  assert.equal(first.total, 150);
  const query = calls[0].MetricDataQueries[0].MetricStat;
  assert.deepEqual(query.Metric, { Namespace: 'AWS/Logs', MetricName: 'IncomingLogEvents', Dimensions: [{ Name: 'LogGroupName', Value: '/aws/eks/app' }] });
  assert.deepEqual([query.Period, query.Stat], [3600, 'Sum']);
  const second = await logGroupVolume(args);
  assert.equal(second.requests, 0, 'served from the local history');
  assert.equal(second.total, 150);
  assert.equal(calls.length, 1);
});

test('the per-minute index keeps the chart after raw events leave the cache, and survives re-analysis', async () => {
  let now = NOW;
  const cache = createLogCache({ dataDir: ':memory:', now: () => now });
  const scope = { profileId: 'p', region: 'r', logGroup: '/g' };
  cache.enable({ ...scope, storedBytes: 1e12, retentionInDays: 1 }); // huge group: 1 h window
  assert.ok(cache.describeGroup('p', 'r', '/g').windowMs < MAX_WINDOW_MS);
  await cache.ingest({ ...scope, events: [
    { eventId: 'a', timestamp: NOW - 50 * MIN, message: 'ERROR boom' },
    { eventId: 'b', timestamp: NOW - 50 * MIN + 1, message: 'INFO ok' },
  ] });
  now = NOW + 5 * HOUR;
  cache.prune();
  assert.equal(cache.describeGroup('p', 'r', '/g').events, 0, 'raw events expired');
  const chart = await cache.histogram({ ...scope, from: now - 6 * HOUR, to: now });
  assert.equal(chart.source, 'index');
  assert.equal(chart.binMs, 5 * MIN);
  assert.equal(chart.events, 2);
  assert.equal(chart.buckets.reduce((sum, b) => sum + b.error, 0), 1);

});

test('re-analysis (rules change) keeps the per-minute history older than the cache', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-minutes-'));
  try {
    let now = NOW;
    const key = crypto.randomBytes(32);
    const scope = { profileId: 'p', region: 'r', logGroup: '/g' };
    const cache = createLogCache({ dataDir: dir, key, now: () => now });
    cache.enable({ ...scope, storedBytes: 1e12, retentionInDays: 1 });
    await cache.ingest({ ...scope, events: [{ eventId: 'old', timestamp: NOW - 50 * MIN, message: 'ERROR boom' }] });
    now = NOW + 5 * HOUR;
    cache.prune();
    await cache.ingest({ ...scope, events: [{ eventId: 'new', timestamp: now - MIN, message: 'WARN slow' }] });
    cache.close();

    const raw = new Database(path.join(dir, 'aws-log-cache.sqlite3'));
    raw.prepare('UPDATE log_intel_state SET version = 0').run();
    raw.close();

    const reopened = createLogCache({ dataDir: dir, key, now: () => now });
    await reopened.ensureAnalyzed(scope);
    const chart = await reopened.histogram({ ...scope, from: now - 6 * HOUR, to: now });
    assert.equal(chart.events, 2, 'the expired error minute and the cached warning');
    assert.equal(chart.buckets.reduce((sum, b) => sum + b.error, 0), 1);
    assert.equal(chart.buckets.reduce((sum, b) => sum + b.warn, 0), 1);
    reopened.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('searches older than the cache window update the level index without double counting', async () => {
  const cache = createLogCache({ dataDir: ':memory:', now: () => NOW });
  const scope = { profileId: 'p', region: 'r', logGroup: '/g' };
  cache.enable({ ...scope, storedBytes: 1e12, retentionInDays: 1 }); // 1 h window
  const minute = NOW - 2 * 24 * HOUR;
  const search = n => [
    ...Array.from({ length: n }, (_, i) => ({ timestamp: minute + i, logStreamName: 's', message: `ERROR e${i}` })),
    { timestamp: minute + 100, logStreamName: 's', message: 'INFO ok' },
  ];
  assert.equal(await cache.ingest({ ...scope, events: search(3) }), 4);
  const count = async () => (await cache.histogram({ ...scope, from: NOW - 3 * 24 * HOUR, to: NOW })).buckets.reduce((acc, b) => ({ error: acc.error + b.error, info: acc.info + b.info }), { error: 0, info: 0 });
  assert.deepEqual(await count(), { error: 3, info: 1 });
  await cache.ingest({ ...scope, events: search(3) });
  assert.deepEqual(await count(), { error: 3, info: 1 }, 'repeating the search does not double count');
  await cache.ingest({ ...scope, events: search(5) });
  assert.deepEqual(await count(), { error: 5, info: 1 }, 'a fuller search raises the minute to what it saw');
  assert.equal(cache.describeGroup('p', 'r', '/g').events, 0, 'old events are not stored raw');
});

test('insightsRowsToEvents keeps rows that carry the raw event', () => {
  const { insightsRowsToEvents } = require('./awsLogFetch');
  assert.deepEqual(insightsRowsToEvents([
    { '@timestamp': '2026-10-01 18:30:26.904', '@logStream': 'pod', '@message': 'ERROR x' },
    { '@timestamp': '2026-10-01 18:30:26.904', '@message': 'no stream' },
    { 'bin(5m)': '2026-10-01 18:30:00.000', count: 3 },
  ]), [{ timestamp: Date.UTC(2026, 9, 1, 18, 30, 26, 904), logStreamName: 'pod', message: 'ERROR x' }]);
});
