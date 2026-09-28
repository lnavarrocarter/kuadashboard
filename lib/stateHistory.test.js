'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('./apm/database');
const { StateHistory, DEFAULT_POLL_SETTINGS } = require('./stateHistory');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-state-'));
  let t = Date.parse('2026-09-28T12:00:00Z');
  const database = new ApmDatabase({ filePath: path.join(dir, 'apm.sqlite3') });
  const history = new StateHistory(database.db, { now: () => t });
  return {
    history,
    advance(ms) { t += ms; },
    close() { database.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const BASE = { provider: 'gcp', profileId: 'local:ncaicloud', project: 'ncaicloud', resourceType: 'gcp-vm' };
const events = (h, key = 'us-central1-a/web') => h.listEvents({ ...BASE, key });

test('records only state changes, with the previous state', () => {
  const f = fixture();
  try {
    const { history } = f;
    assert.equal(history.recordStates({ ...BASE, items: [{ key: 'us-central1-a/web', name: 'web', state: 'RUNNING' }] }), 1);
    assert.equal(history.recordStates({ ...BASE, items: [{ key: 'us-central1-a/web', name: 'web', state: 'RUNNING' }] }), 0);
    f.advance(60_000);
    assert.equal(history.recordStates({ ...BASE, source: 'poll', items: [{ key: 'us-central1-a/web', name: 'web', state: 'TERMINATED' }] }), 1);

    const list = events(history);
    assert.equal(list.length, 2);
    assert.deepEqual(
      list.map(e => [e.state, e.previousState, e.source]),
      [['TERMINATED', 'RUNNING', 'poll'], ['RUNNING', null, 'observed']],
    );
    assert.equal(list[0].observedAt, '2026-09-28T12:01:00.000Z');
  } finally { f.close(); }
});

test('complete lists mark vanished resources as MISSING once', () => {
  const f = fixture();
  try {
    const { history } = f;
    history.recordStates({ ...BASE, complete: true, items: [
      { key: 'us-central1-a/web', name: 'web', state: 'RUNNING' },
      { key: 'us-central1-a/db', name: 'db', state: 'RUNNING' },
    ] });
    assert.equal(history.recordStates({ ...BASE, complete: true, items: [{ key: 'us-central1-a/web', name: 'web', state: 'RUNNING' }] }), 1);
    assert.equal(history.recordStates({ ...BASE, complete: true, items: [{ key: 'us-central1-a/web', name: 'web', state: 'RUNNING' }] }), 0);
    assert.deepEqual(events(history, 'us-central1-a/db').map(e => [e.state, e.previousState]), [['MISSING', 'RUNNING'], ['RUNNING', null]]);
    // partial lists never mark anything missing
    assert.equal(history.recordStates({ ...BASE, items: [] }), 0);
  } finally { f.close(); }
});

test('history is scoped per profile and resource type', () => {
  const f = fixture();
  try {
    const { history } = f;
    history.recordStates({ ...BASE, items: [{ key: 'k', name: 'x', state: 'RUNNING' }] });
    history.recordStates({ ...BASE, profileId: 'other', items: [{ key: 'k', name: 'x', state: 'RUNNING' }] });
    history.recordStates({ ...BASE, resourceType: 'gcp-sql', items: [{ key: 'k', name: 'x', state: 'RUNNING' }] });
    assert.equal(history.listEvents({ ...BASE, key: 'k' }).length, 1);
  } finally { f.close(); }
});

test('records user actions with details alongside states', () => {
  const f = fixture();
  try {
    const { history } = f;
    history.recordStates({ ...BASE, items: [{ key: 'us-central1-a/web', name: 'web', state: 'RUNNING' }] });
    f.advance(1000);
    history.recordAction({ ...BASE, key: 'us-central1-a/web', name: 'web', action: 'labels', details: { added: { env: 'prod' } } });
    const [latest] = events(history);
    assert.equal(latest.kind, 'action');
    assert.equal(latest.source, 'user');
    assert.equal(latest.action, 'labels');
    assert.deepEqual(latest.details, { added: { env: 'prod' } });
  } finally { f.close(); }
});

test('pagination with limit and before', () => {
  const f = fixture();
  try {
    const { history } = f;
    for (const state of ['A', 'B', 'C', 'D']) { history.recordStates({ ...BASE, items: [{ key: 'k', name: 'x', state }] }); f.advance(1000); }
    const page1 = history.listEvents({ ...BASE, key: 'k', limit: 2 });
    assert.deepEqual(page1.map(e => e.state), ['D', 'C']);
    const page2 = history.listEvents({ ...BASE, key: 'k', limit: 2, before: page1.at(-1).id });
    assert.deepEqual(page2.map(e => e.state), ['B', 'A']);
  } finally { f.close(); }
});

test('poll settings: disabled by default, validated updates, enabled listing and run marks', () => {
  const f = fixture();
  try {
    const { history } = f;
    assert.deepEqual(history.getPollSettings('gcp', 'p1'), { ...DEFAULT_POLL_SETTINGS, lastRunAt: null, lastError: null });
    const updated = history.updatePollSettings('gcp', 'p1', { enabled: true, intervalMinutes: 30, resourceTypes: ['gcp-vm'], retentionDays: 30 });
    assert.equal(updated.enabled, true);
    assert.equal(updated.intervalMinutes, 30);
    assert.deepEqual(updated.resourceTypes, ['gcp-vm']);
    assert.throws(() => history.updatePollSettings('gcp', 'p1', { intervalMinutes: 1 }), /Interval must be/);
    assert.throws(() => history.updatePollSettings('gcp', 'p1', { resourceTypes: ['s3'] }), /Invalid resource types/);
    assert.throws(() => history.updatePollSettings('gcp', 'p1', { retentionDays: 0 }), /Retention/);
    assert.deepEqual(history.listEnabledPollSettings('gcp').map(s => s.profileId), ['p1']);
    history.markPollRun('gcp', 'p1', 'boom');
    assert.equal(history.getPollSettings('gcp', 'p1').lastError, 'boom');
    history.updatePollSettings('gcp', 'p1', { enabled: false });
    assert.deepEqual(history.listEnabledPollSettings('gcp'), []);
  } finally { f.close(); }
});

test('cleanup removes events older than the retention', () => {
  const f = fixture();
  try {
    const { history } = f;
    history.updatePollSettings(BASE.provider, BASE.profileId, { retentionDays: 1 });
    history.recordStates({ ...BASE, items: [{ key: 'k', name: 'x', state: 'OLD' }] });
    f.advance(2 * 24 * 60 * 60 * 1000);
    history.recordStates({ ...BASE, items: [{ key: 'k', name: 'x', state: 'NEW' }] });
    assert.equal(history.cleanup(BASE.provider, BASE.profileId), 1);
    assert.deepEqual(history.listEvents({ ...BASE, key: 'k' }).map(e => e.state), ['NEW']);
  } finally { f.close(); }
});

test('rejects unknown resource types and sources', () => {
  const f = fixture();
  try {
    assert.throws(() => f.history.recordStates({ ...BASE, resourceType: 'bucket', items: [] }), /Unsupported resource type/);
    assert.throws(() => f.history.recordStates({ ...BASE, source: 'guess', items: [] }), /Unsupported source/);
  } finally { f.close(); }
});
