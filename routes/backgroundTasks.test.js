'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createBackgroundTaskRegistry } = require('../lib/backgroundTaskRegistry');
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