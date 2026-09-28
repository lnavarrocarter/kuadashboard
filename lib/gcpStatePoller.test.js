'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ApmDatabase } = require('./apm/database');
const { StateHistory } = require('./stateHistory');
const { createGcpStatePoller, pollCallsPerDay } = require('./gcpStatePoller');

function setup({ listers = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-poller-'));
  let t = Date.parse('2026-09-28T12:00:00Z');
  const database = new ApmDatabase({ filePath: path.join(dir, 'apm.sqlite3') });
  const history = new StateHistory(database.db, { now: () => t });
  const calls = [];
  const sources = {
    'gcp-vm': { list: listers['gcp-vm'] || (async () => { calls.push('vm'); return [{ zone: 'z-a', name: 'web', status: 'RUNNING' }]; }), key: v => `${v.zone}/${v.name}`, state: v => v.status },
    'gcp-sql': { list: listers['gcp-sql'] || (async () => { calls.push('sql'); return [{ name: 'db', status: 'STOPPED' }]; }), key: i => i.name, state: i => i.status },
    'gcp-cloud-run': { list: async () => { calls.push('run'); return []; }, key: s => s.name, state: s => s.status },
  };
  const recordStates = (profileId, project, type, rows, source) => history.recordStates({
    provider: 'gcp', profileId, project, resourceType: type, source, complete: true,
    items: rows.map(r => ({ key: sources[type].key(r), name: r.name, state: sources[type].state(r) })),
  });
  const auths = [];
  const poller = createGcpStatePoller({
    history, sources, recordStates,
    resolveAuth: async profileId => { auths.push(profileId); return { projectId: 'ncaicloud' }; },
    now: () => t,
    setIntervalFn: () => ({ unref() {} }), clearIntervalFn: () => {},
    log: { warn() {} },
  });
  return {
    history, poller, calls, auths,
    advance(ms) { t += ms; },
    close() { database.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test('does nothing while polling is disabled (default)', async () => {
  const s = setup();
  try {
    assert.deepEqual(await s.poller.tick(), []);
    assert.deepEqual(s.calls, []);
    assert.deepEqual(s.auths, []);
  } finally { s.close(); }
});

test('polls enabled profiles for the selected types and records with source "poll"', async () => {
  const s = setup();
  try {
    s.history.updatePollSettings('gcp', 'p1', { enabled: true, intervalMinutes: 15, resourceTypes: ['gcp-vm', 'gcp-sql'] });
    const [run] = await s.poller.tick();
    assert.equal(run.error, null);
    assert.deepEqual(s.calls.sort(), ['sql', 'vm']);
    const [event] = s.history.listEvents({ provider: 'gcp', profileId: 'p1', resourceType: 'gcp-vm', key: 'z-a/web' });
    assert.equal(event.source, 'poll');
    assert.equal(event.state, 'RUNNING');
    assert.ok(s.history.getPollSettings('gcp', 'p1').lastRunAt);
  } finally { s.close(); }
});

test('respects each profile interval', async () => {
  const s = setup();
  try {
    s.history.updatePollSettings('gcp', 'p1', { enabled: true, intervalMinutes: 15, resourceTypes: ['gcp-vm'] });
    await s.poller.tick();
    s.advance(10 * 60 * 1000);
    assert.deepEqual(await s.poller.tick(), []);          // not due yet
    s.advance(5 * 60 * 1000);
    assert.equal((await s.poller.tick()).length, 1);      // due at 15 min
    assert.equal(s.calls.length, 2);
  } finally { s.close(); }
});

test('one failing resource type is reported without stopping the others', async () => {
  const s = setup({ listers: { 'gcp-sql': async () => { throw new Error('Cloud SQL Admin API has not been used\nmore'); } } });
  try {
    s.history.updatePollSettings('gcp', 'p1', { enabled: true, resourceTypes: ['gcp-sql', 'gcp-vm'] });
    const [run] = await s.poller.tick();
    assert.match(run.error, /^gcp-sql: Cloud SQL Admin API has not been used$/);
    assert.deepEqual(run.types.find(t => t.type === 'gcp-vm'), { type: 'gcp-vm', count: 1 });
    assert.match(s.history.getPollSettings('gcp', 'p1').lastError, /Cloud SQL Admin API/);
  } finally { s.close(); }
});

test('runProfile polls on demand even when disabled, and skips overlapping runs', async () => {
  const s = setup();
  try {
    const [a, b] = await Promise.all([s.poller.runProfile('p1'), s.poller.runProfile('p1')]);
    assert.equal(a.skipped, undefined);
    assert.equal(b.skipped, true);
    assert.equal(s.auths.length, 1);
  } finally { s.close(); }
});

test('API reads per day shown for the settings', () => {
  assert.equal(pollCallsPerDay({ enabled: false, intervalMinutes: 15, resourceTypes: ['a', 'b', 'c'] }), 0);
  assert.equal(pollCallsPerDay({ enabled: true, intervalMinutes: 15, resourceTypes: ['a', 'b', 'c'] }), 288);
  assert.equal(pollCallsPerDay({ enabled: true, intervalMinutes: 60, resourceTypes: ['a'] }), 24);
});
