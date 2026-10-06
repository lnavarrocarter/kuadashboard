'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBackgroundTaskRegistry } = require('./backgroundTaskRegistry');

function createRegistry() {
  let currentTime = Date.parse('2026-10-06T12:00:00.000Z');
  const registry = createBackgroundTaskRegistry({
    now: () => currentTime,
    uptime: () => 123,
    cpuUsage: () => ({ user: 2000, system: 3000 }),
    memoryUsage: () => ({ rss: 4096, heapUsed: 2048, external: 1024 }),
  });
  return { registry, advance: milliseconds => { currentTime += milliseconds; } };
}

test('registers scheduled and idle tasks with read-only process metrics', () => {
  const { registry } = createRegistry();
  registry.register({ id: 'apm.poll', name: 'Observability collection', type: 'scheduler', intervalMs: 60000 });
  registry.register({ id: 'logs.scan', name: 'Log scan', type: 'operation' });

  assert.deepEqual(registry.snapshot(), {
    generatedAt: '2026-10-06T12:00:00.000Z',
    process: {
      uptimeSeconds: 123,
      cpuMicros: { user: 2000, system: 3000 },
      memoryBytes: { rss: 4096, heapUsed: 2048, external: 1024 },
    },
    tasks: [
      {
        id: 'apm.poll', name: 'Observability collection', type: 'scheduler', state: 'scheduled', intervalMs: 60000,
        startedAt: null, lastRunAt: null, lastFinishedAt: null, nextRunAt: '2026-10-06T12:01:00.000Z',
        lastRunStatus: null, progress: null, errorCode: null,
      },
      {
        id: 'logs.scan', name: 'Log scan', type: 'operation', state: 'idle', intervalMs: null,
        startedAt: null, lastRunAt: null, lastFinishedAt: null, nextRunAt: null,
        lastRunStatus: null, progress: null, errorCode: null,
      },
    ],
  });
});

test('records running, bounded progress and completion without task-level resource attribution', () => {
  const { registry, advance } = createRegistry();
  const task = registry.register({ id: 'logs.refresh', name: 'Log refresh', intervalMs: 30000 });
  task.start();
  task.setProgress(1.4);
  assert.equal(registry.get('logs.refresh').state, 'running');
  assert.equal(registry.get('logs.refresh').progress, 1);

  advance(250);
  task.complete();
  const result = registry.get('logs.refresh');
  assert.equal(result.state, 'scheduled');
  assert.equal(result.lastRunStatus, 'completed');
  assert.equal(result.lastFinishedAt, '2026-10-06T12:00:00.250Z');
  assert.equal(result.nextRunAt, '2026-10-06T12:00:30.250Z');
});

test('run tracks async work once and completes the registered task', async () => {
  const { registry } = createRegistry();
  const task = registry.register({ id: 'sync.apps', name: 'Application sync', intervalMs: 120000 });
  let finish;
  let executions = 0;
  const operation = new Promise(resolve => { finish = resolve; });
  const firstRun = task.run(() => { executions += 1; return operation; });
  const overlappingRun = task.run(() => { executions += 1; });

  assert.equal(registry.get('sync.apps').state, 'running');
  assert.equal(executions, 0);
  finish('ok');
  assert.equal(await firstRun, 'ok');
  assert.equal(await overlappingRun, 'ok');
  assert.equal(executions, 1);
  assert.equal(registry.get('sync.apps').state, 'scheduled');
  assert.equal(registry.get('sync.apps').lastRunStatus, 'completed');
});

test('errors expose only a safe code and remain recoverable on the next run', () => {
  const { registry } = createRegistry();
  const task = registry.register({ id: 'team.sync', name: 'Team sync' });
  task.start();
  task.fail('TOKEN=secret-value');

  assert.deepEqual(registry.get('team.sync'), {
    id: 'team.sync', name: 'Team sync', type: 'background', state: 'error', intervalMs: null,
    startedAt: '2026-10-06T12:00:00.000Z', lastRunAt: '2026-10-06T12:00:00.000Z',
    lastFinishedAt: '2026-10-06T12:00:00.000Z', nextRunAt: null, lastRunStatus: 'error',
    progress: null, errorCode: 'task_failed',
  });

  task.start();
  assert.equal(registry.get('team.sync').state, 'running');
  assert.equal(registry.get('team.sync').errorCode, null);
});

test('rejects duplicate task ids and removes unregistered tasks', () => {
  const { registry } = createRegistry();
  const task = registry.register({ id: 'sync', name: 'Sync' });
  assert.throws(() => registry.register({ id: 'sync', name: 'Duplicate' }), /already registered/);
  task.unregister();
  assert.equal(registry.get('sync'), null);
});