'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('./apm/database');
const { MetricHistory, HOUR_MS } = require('./metricHistory');

const T0 = Date.UTC(2026, 8, 28, 0, 0);

function fixture(start = T0 + 48 * HOUR_MS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-history-'));
  const database = new ApmDatabase({ filePath: path.join(dir, 'apm.sqlite3') });
  let now = start;
  const history = new MetricHistory(database.db, { now: () => now });
  return {
    history,
    setNow: value => { now = value; },
    close: () => { database.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const item = metric => ({ provider: 'aws', profileId: 'p1', region: 'us-east-1', resourceId: 'AWS::SQS::Queue:orders', metric, periodS: 3600 });
const hours = (from, n, v = 1) => Array.from({ length: n }, (_, i) => ({ t: from + i * HOUR_MS, v }));

test('a covered, recent series is fresh; a missing or old one is stale', () => {
  const { history, setNow, close } = fixture();
  const to = T0 + 49 * HOUR_MS;
  const from = to - 24 * HOUR_MS;
  history.write(item('sent'), { from, to, points: hours(from, 24, 2) });
  const plan = history.plan({ series: [item('sent'), item('received')], from, to, ttlMs: 15 * 60 * 1000 });
  assert.deepEqual(plan.fresh.map(s => s.metric), ['sent']);
  assert.deepEqual(plan.stale.map(s => s.metric), ['received']);
  assert.equal(plan.fetchFrom, from);

  setNow(T0 + 48 * HOUR_MS + 20 * 60 * 1000);
  const later = history.plan({ series: [item('sent')], from, to, ttlMs: 15 * 60 * 1000 });
  assert.equal(later.stale.length, 1);
  // Older hours are kept: only the last settle window (2h) is requested again.
  assert.equal(later.fetchFrom, to - 2 * HOUR_MS);
  close();
});

test('writes replace their window, merge coverage and read back in order', () => {
  const { history, close } = fixture();
  const from = T0;
  history.write(item('sent'), { from, to: from + 10 * HOUR_MS, points: hours(from, 10, 1) });
  history.write(item('sent'), { from: from + 8 * HOUR_MS, to: from + 12 * HOUR_MS, points: [{ t: from + 9 * HOUR_MS, v: 7 }] });
  const points = history.read(item('sent'), { from, to: from + 12 * HOUR_MS });
  // Hour 8 disappeared (no data in the new read), hour 9 was revised.
  assert.equal(points.length, 9);
  assert.deepEqual(points.at(-1), { t: from + 9 * HOUR_MS, v: 7 });
  assert.deepEqual(history.coverage(item('sent')), { from, to: from + 12 * HOUR_MS, fetchedAt: T0 + 48 * HOUR_MS });
  close();
});

test('a later window with a gap replaces the coverage instead of claiming the gap', () => {
  const { history, close } = fixture();
  history.write(item('sent'), { from: T0, to: T0 + 2 * HOUR_MS, points: [] });
  history.write(item('sent'), { from: T0 + 10 * HOUR_MS, to: T0 + 12 * HOUR_MS, points: [] });
  assert.equal(history.coverage(item('sent')).from, T0 + 10 * HOUR_MS);
  close();
});

test('retention prunes old points and clips coverage', () => {
  const { history, setNow, close } = fixture(T0);
  history.write(item('sent'), { from: T0, to: T0 + 5 * HOUR_MS, points: hours(T0, 5) });
  setNow(T0 + 3 * 24 * HOUR_MS + 2 * HOUR_MS);
  history.setRetentionDays(3);
  assert.equal(history.read(item('sent'), { from: T0, to: T0 + 5 * HOUR_MS }).length, 3);
  assert.equal(history.coverage(item('sent')).from, T0 + 2 * HOUR_MS);
  assert.throws(() => history.setRetentionDays(0), /1–400/);
  close();
});
