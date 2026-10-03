'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectAnomalies, BUCKET_MS } = require('./logAnomalies');

const HOUR = 3600000;
const DAY = 24 * HOUR;
// 10:40 on a bucket grid: the newest bucket (10:30) is partial.
const NOW = Date.parse('2026-10-02T10:40:00Z');
const GROUPS = { timeout: 'failure', access_denied: 'failure', validation: 'client', debug: 'noise' };

/** 7 days of buckets ending at NOW; `shape(start)` returns the counts of each. */
function history(shape, { days = 7 } = {}) {
  const buckets = [];
  const first = Math.floor((NOW - days * DAY) / BUCKET_MS) * BUCKET_MS;
  for (let start = first; start < NOW; start += BUCKET_MS) buckets.push({ start, events: 0, errors: 0, warnings: 0, categories: {}, ...shape(start) });
  return buckets;
}
const recent = start => start >= NOW - HOUR - BUCKET_MS / 2;
const run = input => detectAnomalies({ syncedUntil: NOW, coverageFrom: NOW - 7 * DAY, groups: GROUPS, now: NOW, ...input });
const ids = result => result.anomalies.map(anomaly => anomaly.id);

test('steady traffic produces no anomalies', () => {
  const result = run({ buckets: history(() => ({ events: 100, errors: 2, categories: { timeout: 1 } })) });
  assert.equal(result.status, 'ok');
  assert.equal(result.evaluatedAt, NOW);
  assert.deepEqual(result.anomalies, []);
});

test('an error spike with a higher error rate is flagged with its expected value', () => {
  const buckets = history(start => (recent(start) ? { events: 100, errors: 30 } : { events: 100, errors: 2 }));
  const [spike] = run({ buckets }).anomalies;
  assert.equal(spike.id, 'error_spike');
  assert.equal(spike.params.count, 90);
  assert.ok(spike.params.expected > 4 && spike.params.expected < 6, String(spike.params.expected));
  assert.equal(spike.severity, 'high');
  assert.equal(spike.params.rate, 30);
  assert.equal(spike.params.baselineRate, 2);
  assert.equal(spike.evidence.to, NOW);
});

test('more errors from more traffic, at the usual rate, is a low traffic-driven spike', () => {
  const buckets = history(start => (recent(start) ? { events: 1500, errors: 30 } : { events: 100, errors: 2 }));
  const [spike] = run({ buckets }).anomalies;
  assert.equal(spike.id, 'error_spike_traffic');
  assert.equal(spike.severity, 'low');
});

test('a few errors over a quiet baseline are not a spike', () => {
  const buckets = history(start => (recent(start) ? { events: 20, errors: 3 } : { events: 20, errors: 0 }));
  assert.deepEqual(ids(run({ buckets })), []);
});

test('a volume drop compares with the same time of day, so quiet nights are not flagged', () => {
  const hourOfDay = start => new Date(start).getUTCHours();
  // Busy by day (8–20 UTC), silent at night; now (10:40) should be busy.
  const daily = start => (hourOfDay(start) >= 8 && hourOfDay(start) < 20 ? { events: 200 } : { events: 0 });
  const dropped = run({ buckets: history(start => (recent(start) ? { events: 0 } : daily(start))) });
  assert.deepEqual(ids(dropped), ['volume_drop']);
  assert.equal(dropped.anomalies[0].severity, 'high');
  assert.ok(dropped.anomalies[0].params.days >= 3);

  // Same shape evaluated at night: zero events is normal there.
  const night = Date.parse('2026-10-02T02:40:00Z');
  const nightBuckets = history(daily).filter(bucket => bucket.start < night);
  assert.deepEqual(ids(detectAnomalies({ buckets: nightBuckets, syncedUntil: night, coverageFrom: night - 7 * DAY, groups: GROUPS, now: night })), []);
});

test('a category surge over the last 24 h is flagged; noise categories are ignored', () => {
  const buckets = history(start => ({
    events: 100,
    categories: start >= NOW - DAY ? { timeout: 2, debug: 50 } : { timeout: 0.1, debug: 1 },
  }));
  const result = run({ buckets });
  const surge = result.anomalies.find(anomaly => anomaly.id === 'category_surge');
  assert.equal(surge.category, 'timeout');
  assert.equal(surge.params.count, 96);
  assert.ok(surge.params.ratio >= 10);
  assert.ok(!result.anomalies.some(anomaly => anomaly.category === 'debug'));
});

test('a category that never appeared before is reported as new', () => {
  const buckets = history(start => ({ events: 100, categories: start >= NOW - DAY ? { access_denied: 1 } : {} }));
  const anomaly = run({ buckets }).anomalies.find(item => item.category === 'access_denied');
  assert.equal(anomaly.id, 'category_new');
  assert.equal(anomaly.params.ratio, '∞');
});

test('new recurring errors need history before them and enough occurrences', () => {
  const buckets = history(() => ({ events: 100 }));
  const signatures = [
    { signature: 'TypeError: x is undefined', level: 'error', category: 'code_exception', sample: 'TypeError', occurrences: 4, firstSeen: NOW - 2 * HOUR },
    { signature: 'old error', level: 'error', category: 'other_error', occurrences: 50, firstSeen: NOW - 5 * DAY },
    { signature: 'once', level: 'error', category: 'other_error', occurrences: 1, firstSeen: NOW - HOUR },
    { signature: 'deprecated call', level: 'warn', category: 'other_warning', occurrences: 3, firstSeen: NOW - HOUR },
  ];
  const anomaly = run({ buckets, signatures }).anomalies.find(item => item.id === 'new_errors');
  assert.deepEqual(anomaly.evidence.signatures.map(s => s.signature), ['TypeError: x is undefined']);
  assert.equal(anomaly.severity, 'medium');

  // A group cached for only a few hours has no "before" to compare with.
  const young = history(() => ({ events: 100 })).filter(bucket => bucket.start >= NOW - 6 * HOUR);
  assert.ok(!ids(run({ buckets: young, signatures, coverageFrom: NOW - 6 * HOUR })).includes('new_errors'));
});

test('unknown time is not treated as silence', () => {
  // Data only for the last 3 hours and older hours still being backfilled.
  const buckets = history(start => (start >= NOW - 3 * HOUR ? { events: 100 } : null)).filter(bucket => bucket.start >= NOW - 3 * HOUR);
  const result = run({ buckets, coverageFrom: NOW - 3 * HOUR, backfillPending: true });
  assert.equal(result.status, 'insufficient_history');
  assert.deepEqual(result.anomalies, []);
});

test('a stale or never synced cache is reported instead of evaluated', () => {
  const buckets = history(start => (recent(start) ? { events: 100, errors: 30 } : { events: 100, errors: 2 }));
  const stale = detectAnomalies({ buckets, syncedUntil: NOW - 12 * HOUR, coverageFrom: NOW - 7 * DAY, groups: GROUPS, now: NOW });
  assert.equal(stale.status, 'stale');
  assert.ok(!ids(stale).includes('error_spike'));
  assert.deepEqual(detectAnomalies({ buckets, syncedUntil: null, now: NOW }), { status: 'not_synced', evaluatedAt: null, anomalies: [] });
});
