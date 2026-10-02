'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('./apm/database');
const { CloudHistory, DAY_MS } = require('./cloudHistory');

const T0 = Date.UTC(2026, 8, 28, 0, 0);

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-cloud-history-'));
  const database = new ApmDatabase({ filePath: path.join(dir, 'apm.sqlite3') });
  let now = T0;
  const history = new CloudHistory(database.db, { now: () => now, cacheTtlMs: 60 * 1000 });
  return {
    history,
    setNow: value => { now = value; },
    close: () => { database.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const key = { provider: 'aws', profileId: 'profile-1', region: 'us-east-1', resourceKey: 'overview', kind: 'overview' };

test('stores JSON documents, deduplicates exact snapshots and reads fresh cache', () => {
  const { history, close } = fixture();
  const first = history.putDocument({ ...key, payload: { b: 2, a: 1 } });
  const duplicate = history.putDocument({ ...key, payload: { a: 1, b: 2 } });
  assert.equal(first.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.deepEqual(history.readLatest(key).payload, { a: 1, b: 2 });
  assert.equal(history.readRange({ ...key, from: T0, to: T0 + 1 }).length, 1);
  close();
});

test('separates cache expiry from historical retention', () => {
  const { history, setNow, close } = fixture();
  history.putSnapshot({ ...key, payload: { status: 'ok' }, ttlMs: 1000 });
  setNow(T0 + 2000);
  assert.equal(history.readLatest(key), null);
  assert.equal(history.readLatest({ ...key, allowExpired: true }).payload.status, 'ok');
  assert.equal(history.readRange({ ...key, from: T0, to: T0 + DAY_MS }).length, 1);
  close();
});

test('cleanup removes only documents outside the configured retention window', () => {
  const { history, setNow, close } = fixture();
  setNow(T0 - 9 * DAY_MS);
  history.putDocument({ ...key, payload: { n: 1 }, capturedAt: T0 - 8 * DAY_MS });
  setNow(T0 - 6 * DAY_MS);
  history.putDocument({ ...key, payload: { n: 2 }, capturedAt: T0 - 6 * DAY_MS });
  setNow(T0);
  assert.equal(history.cleanup({ retentionDays: 7 }), 1);
  const rows = history.readRange({ ...key, from: T0 - 9 * DAY_MS, to: T0 + 1 });
  assert.deepEqual(rows.map(row => row.payload.n), [2]);
  close();
});