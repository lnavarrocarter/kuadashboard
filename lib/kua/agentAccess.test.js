'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgentAccess } = require('./agentAccess');

test('agents are on and read-only by default', () => {
  const access = createAgentAccess({ dataDir: null });
  assert.deepEqual([access.enabled(), access.writesEnabled()], [true, false]);
});

test('set(boolean) changes only writes; set({ enabled }) keeps writes', () => {
  const access = createAgentAccess({ dataDir: null });
  access.set(true);
  assert.equal(access.writesEnabled(), true);
  access.set({ enabled: false });
  assert.deepEqual([access.get().enabled, access.get().writes], [false, true]);
  assert.equal(access.writesEnabled(), false, 'agents turned off cannot write');
  access.set({ enabled: true });
  assert.equal(access.writesEnabled(), true);
});

test('the switches survive a restart; the last request does not', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-agent-access-'));
  try {
    const first = createAgentAccess({ dataDir });
    first.set({ enabled: false, writes: true });
    first.recordRequest();
    const second = createAgentAccess({ dataDir });
    assert.deepEqual([second.get().enabled, second.get().writes, second.get().lastRequestAt], [false, true, null]);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
