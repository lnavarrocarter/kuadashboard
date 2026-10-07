'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createBackgroundTaskRegistry, createPeriodicTaskControls } = require('./backgroundTaskRegistry');

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
        lastRunStatus: null, progress: null, errorCode: null, supportedActions: [], availableActions: [],
      },
      {
        id: 'logs.scan', name: 'Log scan', type: 'operation', state: 'idle', intervalMs: null,
        startedAt: null, lastRunAt: null, lastFinishedAt: null, nextRunAt: null,
        lastRunStatus: null, progress: null, errorCode: null, supportedActions: [], availableActions: [],
      },
    ],
  });
});

test('publishes only supported actions and makes repeated pause/resume idempotent', async () => {
  const { registry } = createRegistry();
  let paused = false;
  let calls = 0;
  const task = registry.register({
    id: 'scheduler', name: 'Periodic scheduler', intervalMs: 60000,
    controls: {
      pause: { run: () => { calls += 1; paused = true; task.pause(); }, available: () => !paused },
      resume: { run: () => { calls += 1; paused = false; task.resume(); }, available: () => paused },
    },
  });

  assert.deepEqual(registry.get('scheduler').supportedActions, ['pause', 'resume']);
  assert.deepEqual(registry.get('scheduler').availableActions, ['pause']);
  await assert.rejects(registry.control('scheduler', 'cancel'), { code: 'TASK_ACTION_UNSUPPORTED' });

  assert.equal((await registry.control('scheduler', 'pause')).changed, true);
  assert.equal(registry.get('scheduler').state, 'paused');
  assert.deepEqual(registry.get('scheduler').availableActions, ['resume']);
  assert.equal((await registry.control('scheduler', 'pause')).changed, false);
  assert.equal((await registry.control('scheduler', 'resume')).changed, true);
  assert.equal(registry.get('scheduler').state, 'scheduled');
  assert.equal((await registry.control('scheduler', 'resume')).changed, false);
  assert.equal(calls, 2);
  await assert.rejects(registry.control('missing', 'pause'), { code: 'TASK_NOT_FOUND' });
});

test('periodic controls pause only their scheduler and finish active work at a safe boundary', async () => {
  const { registry } = createRegistry();
  function createService() {
    let running = true;
    return {
      pause() { running = false; },
      resume() { running = true; },
      health: () => ({ running }),
    };
  }
  const firstService = createService();
  const secondService = createService();
  const first = registry.register({ id: 'scheduler.first', name: 'First scheduler', intervalMs: 60000 });
  const second = registry.register({ id: 'scheduler.second', name: 'Second scheduler', intervalMs: 60000 });
  first.setControls(createPeriodicTaskControls(firstService, first));
  second.setControls(createPeriodicTaskControls(secondService, second));
  let finish;
  const pending = first.run(() => new Promise(resolve => { finish = resolve; }));

  await registry.control('scheduler.first', 'pause');
  assert.equal(registry.get('scheduler.first').state, 'pause_requested');
  assert.equal(firstService.health().running, false);
  assert.equal(secondService.health().running, true);
  assert.equal(registry.get('scheduler.second').state, 'scheduled');
  finish();
  await pending;
  assert.equal(registry.get('scheduler.first').state, 'paused');

  await registry.control('scheduler.first', 'resume');
  assert.equal(registry.get('scheduler.first').state, 'scheduled');
  assert.equal(firstService.health().running, true);
  assert.equal(secondService.health().running, true);
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

test('run does not expose an arbitrary error code from a rejected operation', async () => {
  const { registry } = createRegistry();
  const task = registry.register({ id: 'scan', name: 'Log scan' });
  const error = Object.assign(new Error('TOKEN=secret-value'), { code: 'TOKEN=secret-value' });
  await assert.rejects(task.run(() => Promise.reject(error)), error);
  assert.equal(registry.get('scan').errorCode, 'task_failed');
  assert.equal(JSON.stringify(registry.snapshot()).includes('secret-value'), false);
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
    progress: null, errorCode: 'task_failed', supportedActions: [], availableActions: [],
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