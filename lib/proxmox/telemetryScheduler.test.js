'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProxmoxTelemetryScheduler, INTERVAL_MS } = require('./telemetryScheduler');

test('collects metrics only for Proxmox profiles while the provider is active', async () => {
  const calls = [];
  const subject = createProxmoxTelemetryScheduler({
    listProfiles: async () => [{ id: 'p1', provider: 'proxmox' }, { id: 'aws1', provider: 'aws' }],
    resolveProfile: async id => ({ id }),
    createClient: profile => ({ profile }),
    readInventory: async client => ({ profileId: client.profile.id }),
    readTelemetry: async (client, inventory, options) => {
      calls.push({ profileId: client.profile.id, inventory, options });
      return { entities: [{ id: 'node/pve1' }] };
    },
    metricHistory: () => ({ retentionDays: 30 }),
    providerActive: id => id === 'proxmox',
  });
  const result = await subject.tick();
  assert.deepEqual(result, [{ profileId: 'p1', entities: 1 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.profileId, 'p1');
  assert.equal(calls[0].options.timeframe, 'day');
});

test('does not read Proxmox while the provider plugin is off', async () => {
  let reads = 0;
  const subject = createProxmoxTelemetryScheduler({ providerActive: () => false, listProfiles: async () => { reads += 1; return []; } });
  assert.deepEqual(await subject.tick(), []);
  assert.equal(reads, 0);
});

test('runs one task on a 60 second timer and pauses/resumes cleanly', () => {
  const handles = [];
  const timers = {
    setInterval(fn, ms) { const handle = { fn, ms, unref() {} }; handles.push(handle); return handle; },
    clearInterval(handle) { handle.cleared = true; },
  };
  const subject = createProxmoxTelemetryScheduler({ timers });
  subject.start();
  assert.equal(handles[0].ms, INTERVAL_MS);
  assert.equal(subject.health().running, true);
  subject.pause();
  assert.equal(handles[0].cleared, true);
  assert.equal(subject.health().running, false);
  subject.resume();
  assert.equal(handles.length, 2);
  subject.stop();
});
