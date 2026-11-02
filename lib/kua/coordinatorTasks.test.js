'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { createCoordinatorTasks } = require('./coordinatorTasks');
const { ACTIONS } = require('./actionCatalog');
const { createBackgroundTaskRegistry } = require('../backgroundTaskRegistry');
const { createKuappsCoordinatorRouter } = require('../../routes/kuappsCoordinator');

const APP = 'app-1';
const TASK = `kuapps.coordinator.${APP}`;

function setup({ journalEntries = [], untracked = 0 } = {}) {
  let clock = Date.parse('2026-11-02T10:00:00Z');
  const now = () => clock;
  const registry = createBackgroundTaskRegistry({ now });
  const journal = {
    list: ({ applicationId }) => ({
      entries: journalEntries.filter(entry => entry.applicationId === applicationId),
      summary: { untracked },
    }),
  };
  const coordinators = createCoordinatorTasks({ registry, journal, now });
  const at = (offsetMs = 0) => new Date(clock + offsetMs).toISOString();
  return { registry, coordinators, at, advance: ms => { clock += ms; } };
}

const idle = { reading: 0, queuedWrites: 0, writing: false };

test('one aggregated task per application, running while it works and idle after', () => {
  const { registry, coordinators, at } = setup();
  coordinators.ingest({ applicationId: APP, events: [
    { at: at(), type: 'queued', key: 'app.topology', kind: 'read', runId: 'r1' },
    { at: at(), type: 'started', key: 'app.topology', kind: 'read', runId: 'r1' },
  ], state: { reading: 1, queuedWrites: 2, writing: true } });
  let task = registry.get(TASK);
  assert.equal(task.type, 'coordinator');
  assert.equal(task.provider, 'kua');
  assert.equal(task.state, 'running');
  assert.deepEqual(task.summary, { reading: 1, queuedWrites: 2, writing: 1 });
  assert.deepEqual(task.availableActions, ['cancel']);

  coordinators.ingest({ applicationId: APP, events: [
    { at: at(), type: 'completed', key: 'app.topology', kind: 'read', runId: 'r1', durationMs: 120 },
  ], state: idle });
  task = registry.get(TASK);
  assert.equal(task.state, 'idle');
  assert.equal(task.lastRunStatus, 'completed');
  assert.deepEqual(task.availableActions, []);
  assert.equal(registry.snapshot().tasks.filter(item => item.type === 'coordinator').length, 1);
});

test('the drill-down joins runs with the journal and the action catalog', () => {
  const { coordinators, at } = setup({
    untracked: 2,
    journalEntries: [
      { applicationId: APP, runId: 'w1', reconciles: 1, awsCalls: 0 },
      { applicationId: APP, runId: 'c1', reconciles: 0, awsCalls: 3 },
    ],
  });
  coordinators.ingest({ applicationId: APP, events: [
    { at: at(), type: 'queued', key: 'edge.confirm-batch', kind: 'write', runId: 'w1', invalidates: ['topology', 'registry'] },
    { at: at(), type: 'started', key: 'edge.confirm-batch', kind: 'write', runId: 'w1' },
    { at: at(), type: 'completed', key: 'edge.confirm-batch', kind: 'write', runId: 'w1', durationMs: 80 },
    { at: at(), type: 'coalesced', key: 'invalidation', writes: 3, parts: ['topology'] },
    { at: at(), type: 'queued', key: 'app.topology', kind: 'read', runId: 't1', trigger: 'invalidation' },
    { at: at(), type: 'deduplicated', key: 'app.topology', kind: 'read', runId: 't1' },
    { at: at(), type: 'cancelled', key: 'app.topology', kind: 'read', runId: 't1', durationMs: 5 },
    { at: at(), type: 'queued', key: 'topology.analyze-cloud', kind: 'cloud-read', runId: 'c1' },
    { at: at(), type: 'started', key: 'topology.analyze-cloud', kind: 'cloud-read', runId: 'c1' },
    { at: at(), type: 'completed', key: 'topology.analyze-cloud', kind: 'cloud-read', runId: 'c1', durationMs: 900 },
  ], state: idle });
  const detail = coordinators.detail(APP);
  const [cloud, topology, write] = detail.runs;
  assert.equal(write.outcome, 'completed');
  assert.deepEqual(write.stores, ACTIONS['edge.confirm-batch'].stores);
  assert.equal(write.revision, ACTIONS['edge.confirm-batch'].revision);
  assert.deepEqual(write.invalidates, ['topology', 'registry']);
  assert.equal(write.reconciles, 1);
  assert.equal(topology.trigger, 'invalidation');
  assert.equal(topology.outcome, 'cancelled');
  assert.equal(cloud.awsCalls, 3);
  assert.equal(cloud.stores, undefined);
  assert.equal(detail.metrics.requested, 4);
  assert.equal(detail.metrics.executed, 2);
  assert.equal(detail.metrics.deduplicated, 1);
  assert.equal(detail.metrics.coalescedWrites, 3);
  assert.equal(detail.metrics.cancelled, 1);
  assert.equal(detail.metrics.reconcilesPerWrite, 1);
  assert.equal(detail.metrics.awsCalls, 3);
  assert.equal(detail.metrics.untracked, 2);
});

test('slow runs and repeated failures are flagged', () => {
  const { coordinators, at } = setup();
  const events = [];
  for (let index = 0; index < 5; index += 1) {
    events.push({ at: at(), type: 'queued', key: 'app.forecast', kind: 'read', runId: `f${index}` });
    events.push({ at: at(), type: 'started', key: 'app.forecast', kind: 'read', runId: `f${index}` });
    events.push({ at: at(), type: 'completed', key: 'app.forecast', kind: 'read', runId: `f${index}`, durationMs: 100 });
  }
  events.push({ at: at(), type: 'queued', key: 'app.forecast', kind: 'read', runId: 'slow' });
  events.push({ at: at(), type: 'completed', key: 'app.forecast', kind: 'read', runId: 'slow', durationMs: 1000 });
  for (const runId of ['x1', 'x2']) {
    events.push({ at: at(), type: 'queued', key: 'app.overview:24h', kind: 'read', runId });
    events.push({ at: at(), type: 'failed', key: 'app.overview:24h', kind: 'read', runId, durationMs: 10 });
  }
  coordinators.ingest({ applicationId: APP, events, state: idle });
  const runs = Object.fromEntries(coordinators.detail(APP).runs.map(run => [run.runId, run.flags]));
  assert.deepEqual(runs.slow, ['slow']);
  assert.deepEqual(runs.f0, []);
  assert.deepEqual(runs.x1, []);
  assert.deepEqual(runs.x2, ['repeated-failure']);
});

test('cancel from the panel is returned to the renderer once', async () => {
  const { registry, coordinators, at } = setup();
  coordinators.ingest({ applicationId: APP, events: [{ at: at(), type: 'queued', key: 'app.topology', kind: 'read', runId: 'r1' }], state: { ...idle, reading: 1 } });
  await registry.control(TASK, 'cancel');
  assert.equal(registry.get(TASK).state, 'cancellation_requested');
  assert.deepEqual(coordinators.ingest({ applicationId: APP, events: [], state: { ...idle, reading: 1 } }), { cancel: true });
  assert.deepEqual(coordinators.ingest({ applicationId: APP, events: [{ at: at(), type: 'cancelled', key: 'app.topology', runId: 'r1' }], state: idle }), { cancel: false });
  assert.equal(registry.get(TASK).state, 'idle');
});

test('the task is retired when the application closes or after 10 minutes without events', () => {
  const { registry, coordinators, at, advance } = setup();
  coordinators.ingest({ applicationId: APP, events: [], state: idle });
  coordinators.ingest({ applicationId: 'app-2', events: [], state: idle });
  coordinators.ingest({ applicationId: APP, closed: true });
  assert.equal(registry.get(TASK), null);
  advance(9 * 60 * 1000);
  coordinators.sweep();
  assert.ok(registry.get('kuapps.coordinator.app-2'));
  advance(2 * 60 * 1000);
  coordinators.sweep();
  assert.equal(registry.get('kuapps.coordinator.app-2'), null);
  assert.equal(coordinators.detail('app-2'), null);
  // A closed application can open again.
  coordinators.ingest({ applicationId: APP, events: [{ at: at(), type: 'queued', key: 'app.topology', runId: 'r9' }], state: idle });
  assert.ok(registry.get(TASK));
});

test('runs are bounded and nothing but ids, keys, timings and counters is kept', () => {
  const { coordinators, at } = setup();
  const events = [];
  for (let index = 0; index < 150; index += 1) events.push({ at: at(), type: 'queued', key: 'app.topology', runId: `r${index}` });
  events.push({ at: at(), type: 'failed', key: 'app.topology', runId: 'r149', error: 'arn:aws:lambda:secret-function', resource: 'my-bucket' });
  events.push({ at: at(), type: 'queued', key: 'arn:aws:s3:::bucket/with spaces', runId: 'bad' });
  coordinators.ingest({ applicationId: APP, events, state: idle });
  const detail = coordinators.detail(APP);
  assert.equal(detail.runs.length, 100);
  assert.ok(!JSON.stringify(detail).includes('secret-function'));
  assert.ok(!JSON.stringify(detail).includes('my-bucket'));
  assert.ok(!detail.runs.some(run => run.runId === 'bad'));
  assert.throws(() => coordinators.ingest({ applicationId: '../etc', events: [] }), /Invalid application id/);
});

test('the router takes events from this computer only and serves the drill-down', async () => {
  const { coordinators, at } = setup();
  const app = express();
  app.use(express.json());
  app.use('/coordinators', createKuappsCoordinatorRouter({ coordinators }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/coordinators`;
  try {
    let response = await fetch(`${base}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId: APP, events: [{ at: at(), type: 'queued', key: 'app.topology', runId: 'r1' }], state: idle }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cancel: false });
    response = await fetch(`${base}/${APP}`);
    assert.equal((await response.json()).runs.length, 1);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    response = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationId: 'no/pe' }) });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});
