'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createBackgroundTaskRegistry } = require('../lib/backgroundTaskRegistry');
const { createScanTaskRegistryBinding } = require('../lib/logScanRunner');
const { createBackgroundTasksRouter } = require('./backgroundTasks');

test('GET /tasks returns a snapshot without changing task state', async () => {
  const registry = createBackgroundTaskRegistry();
  registry.register({ id: 'sync.apps', name: 'Application sync', intervalMs: 120000 });
  const app = express();
  app.use('/tasks', createBackgroundTasksRouter({ registry }));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/tasks`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.tasks[0].state, 'scheduled');
    assert.equal(registry.get('sync.apps').lastRunAt, null);
  } finally {
    server.close();
  }
});

test('scan bindings publish per-scan capabilities and route controls to that scan only', async () => {
  const registry = createBackgroundTaskRegistry();
  let scan = { id: 7, status: 'running', startedAt: Date.now(), progress: 0.4 };
  const calls = [];
  let binding;
  const runner = {
    list: () => [scan],
    get: () => scan,
    pause: id => { calls.push(['pause', id]); scan = { ...scan, status: 'paused' }; binding.publish(scan); return scan; },
    resume: id => { calls.push(['resume', id]); scan = { ...scan, status: 'queued' }; binding.publish(scan); return scan; },
    cancel: id => { calls.push(['cancel', id]); scan = { ...scan, status: 'cancelled' }; binding.publish(scan); return scan; },
  };
  binding = createScanTaskRegistryBinding(registry, () => runner);
  binding.sync();
  const other = registry.register({ id: 'apps.sync', name: 'Application sync', intervalMs: 120000 });
  const app = express();
  app.use('/tasks', createBackgroundTasksRouter({ registry }));
  const server = app.listen(0);
  const call = async (id, action) => fetch(`http://127.0.0.1:${server.address().port}/tasks/${id}/${action}`, { method: 'POST' });

  try {
    const taskId = 'logs.scan.7';
    assert.deepEqual(registry.get(taskId).availableActions, ['pause', 'cancel']);
    const paused = await call(taskId, 'pause');
    assert.equal(paused.status, 200);
    assert.equal((await paused.json()).task.state, 'paused');
    assert.equal(registry.get(taskId).availableActions.includes('resume'), true);
    assert.equal(registry.get('apps.sync').state, 'scheduled');
    assert.equal(registry.get('apps.sync').availableActions.length, 0);
    assert.deepEqual(calls, [['pause', 7]]);

    const unsupported = await call('apps.sync', 'cancel');
    assert.equal(unsupported.status, 400);
    assert.equal((await unsupported.json()).code, 'TASK_ACTION_UNSUPPORTED');
    const repeated = await call(taskId, 'pause');
    assert.equal((await repeated.json()).changed, false);
    const resumed = await call(taskId, 'resume');
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).task.state, 'scheduled');
    const repeatedResume = await call(taskId, 'resume');
    assert.equal((await repeatedResume.json()).changed, false);
    assert.deepEqual(calls, [['pause', 7], ['resume', 7]]);
  } finally {
    server.close();
  }
});