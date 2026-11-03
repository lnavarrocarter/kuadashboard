'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTaskHistory } = require('./taskHistory');
const { createBackgroundTaskRegistry } = require('./backgroundTaskRegistry');

const T0 = Date.parse('2026-11-02T10:00:00Z');

test('finished runs survive a restart, newest first, with a 24-hour summary (#351)', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-history-'));
  let clock = T0;
  try {
    let history = createTaskHistory({ dataDir, now: () => clock });
    history.record({ taskId: 'apps.sync', name: 'Application sync', type: 'scheduler', provider: 'kua', startedAt: new Date(T0 - 3000).toISOString(), finishedAt: T0, outcome: 'completed' });
    clock += 60000;
    history.record({ taskId: 'team.sync', name: 'Team sync', startedAt: clock - 2000, finishedAt: clock, outcome: 'failed', errorCode: 'auth_expired' });
    history.record({ taskId: 'x', name: 'Ignored', finishedAt: clock, outcome: 'paused' });
    history.close();

    history = createTaskHistory({ dataDir, now: () => clock });
    const { runs, summary24h } = history.list();
    assert.deepEqual(runs.map(run => [run.taskId, run.outcome, run.durationMs, run.errorCode]), [
      ['team.sync', 'failed', 2000, 'auth_expired'],
      ['apps.sync', 'completed', 3000, null],
    ]);
    assert.deepEqual(summary24h, { runs: 2, completed: 1, failed: 1, cancelled: 0 });
    assert.deepEqual(history.list({ outcome: 'failed' }).runs.map(run => run.taskId), ['team.sync']);
    assert.deepEqual(history.list({ q: 'AUTH_exp' }).runs.map(run => run.taskId), ['team.sync']);
    assert.deepEqual(history.list({ q: '%' }).runs, [], 'LIKE wildcards are matched literally');
    history.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the history keeps 7 days and at most maxRuns runs', () => {
  let clock = T0;
  const history = createTaskHistory({ dataDir: ':memory:', now: () => clock, maxRuns: 60 });
  history.record({ taskId: 'old', name: 'Old', finishedAt: T0 - 8 * 24 * 60 * 60 * 1000, outcome: 'completed' });
  for (let index = 0; index < 100; index += 1) history.record({ taskId: 'a', name: 'A', finishedAt: T0 + index, outcome: 'completed' });
  clock = T0 + 1000;
  const { runs } = history.list({ limit: 500 });
  assert.ok(runs.length <= 60 + 50, 'pruned at least every 50 runs');
  assert.ok(!runs.some(run => run.taskId === 'old'), 'older than 7 days is never listed');
  history.record({ taskId: 'a', name: 'A', finishedAt: clock, outcome: 'completed' });
  history.close();
});

test('stats give the last 10 runs, the typical duration and failures in the last 5', () => {
  const history = createTaskHistory({ dataDir: ':memory:', now: () => T0 });
  const durations = [100, 120, 110, 900, 105, 115, 130, 125, 118, 112, 108];
  durations.forEach((ms, index) => history.record({ taskId: 'logs.refresh', name: 'Logs', startedAt: T0 + index * 1000 - ms, finishedAt: T0 + index * 1000, outcome: index === 3 || index >= 9 ? 'failed' : 'completed' }));
  const stats = history.stats('logs.refresh');
  assert.equal(stats.recent.length, 10);
  assert.deepEqual(stats.recent.at(-1), { durationMs: 108, outcome: 'failed' });
  assert.equal(stats.failuresInLast5, 2);
  assert.equal(stats.typicalMs, 117, 'median of the completed runs only');
  assert.equal(history.stats('unknown'), null);
  history.close();
});

test('the registry records a run when a task leaves an active state, never for the coordinator', async () => {
  let clock = T0;
  const history = createTaskHistory({ dataDir: ':memory:', now: () => clock });
  const registry = createBackgroundTaskRegistry({ now: () => clock, history });
  const periodic = registry.register({ id: 'apps.sync', name: 'Application sync', type: 'scheduler', provider: 'kua', intervalMs: 60000 });
  await periodic.run(async () => { clock += 1500; });
  await assert.rejects(periodic.run(async () => { clock += 500; throw new Error('boom'); }));
  const scan = registry.register({ id: 'logs.scan.1', name: 'Log scan', type: 'scan', provider: 'aws' });
  scan.update({ state: 'running', startedAt: new Date(clock).toISOString() });
  clock += 4000;
  scan.update({ state: 'cancelled' });
  scan.update({ state: 'cancelled' });
  const coordinator = registry.register({ id: 'kuapps.coordinator.app-1', name: 'Coordinator', type: 'coordinator' });
  coordinator.update({ state: 'running', startedAt: new Date(clock).toISOString() });
  coordinator.update({ state: 'completed' });

  assert.deepEqual(history.list().runs.map(run => [run.taskId, run.outcome, run.durationMs]), [
    ['logs.scan.1', 'cancelled', 4000],
    ['apps.sync', 'failed', 500],
    ['apps.sync', 'completed', 1500],
  ]);
  const view = registry.get('apps.sync');
  assert.equal(view.history.failuresInLast5, 1);
  assert.equal(view.history.typicalMs, 1500);
  assert.equal(registry.get('kuapps.coordinator.app-1').history, null);
  history.close();
});

test('run now starts a run without waiting, and the run keeps its cost per cloud (#353)', async () => {
  const { createPeriodicTaskControls } = require('./backgroundTaskRegistry');
  const { addRunCost } = require('./usage/runCost');
  let clock = T0;
  const history = createTaskHistory({ dataDir: ':memory:', now: () => clock });
  const registry = createBackgroundTaskRegistry({ now: () => clock, history });
  const task = registry.register({ id: 'apm.collection', name: 'Collection', type: 'scheduler', provider: 'mixed', intervalMs: 60000 });
  let release;
  const service = { pause() {}, resume() {}, health: () => ({ running: true }) };
  task.setControls(createPeriodicTaskControls(service, task, {
    runNow: () => new Promise(resolve => {
      addRunCost({ provider: 'aws', usd: 0.002 });
      addRunCost({ provider: 'gcp', potentialUsd: 0.0000005 });
      release = resolve;
    }),
  }));
  assert.ok(registry.get('apm.collection').availableActions.includes('run'));
  const answer = await registry.control('apm.collection', 'run');
  assert.equal(answer.task.state, 'running', 'answers while the run goes on');
  assert.equal((await registry.control('apm.collection', 'run')).changed, false, 'one run at a time');
  clock += 2000;
  release();
  await new Promise(resolve => setImmediate(resolve));
  const [run] = history.list().runs;
  assert.equal(run.outcome, 'completed');
  assert.deepEqual(run.cost, { aws: { calls: 1, usd: 0.002, potentialUsd: 0 }, gcp: { calls: 1, usd: 0, potentialUsd: 0.0000005 } });
  assert.deepEqual(registry.get('apm.collection').history.lastCost, run.cost);
  history.close();
});

test('a history made before #353 gains the cost column', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-history-'));
  try {
    const Database = require('better-sqlite3');
    const legacy = new Database(path.join(dataDir, 'task-history.sqlite3'));
    legacy.exec(`CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT, provider TEXT,
      started_at INTEGER, finished_at INTEGER NOT NULL, duration_ms INTEGER, outcome TEXT NOT NULL, error_code TEXT)`);
    legacy.prepare("INSERT INTO task_runs (task_id, name, finished_at, outcome) VALUES ('apps.sync', 'Sync', ?, 'completed')").run(T0);
    legacy.close();
    const history = createTaskHistory({ dataDir, now: () => T0 });
    history.record({ taskId: 'apps.sync', name: 'Sync', finishedAt: T0 + 1, outcome: 'completed', cost: { aws: { calls: 2, usd: 0.01, potentialUsd: 0 }, 'bad provider!': {} } });
    assert.deepEqual(history.list().runs.map(run => run.cost), [{ aws: { calls: 2, usd: 0.01, potentialUsd: 0 } }, null]);
    history.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
