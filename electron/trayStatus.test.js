'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildTrayStatus, parseTrayAction, panelPosition } = require('./trayStatus');

const NOW = Date.parse('2026-10-14T12:00:00Z');

test('splits running work from the next scheduled runs, soonest first', () => {
  const status = buildTrayStatus({
    backend: { ready: true, managed: true },
    health: { ok: true, version: '2.0.0-rc.2', apmScheduler: { running: true, intervalMinutes: 30 } },
    plan: { plan: 'pro', features: { agents: true } },
    tasks: [
      { id: 'apm.collect.a', name: 'Checkout', state: 'running', progress: 0.5, availableActions: ['cancel', 'bogus'] },
      { id: 'logs.refresh', name: 'Logs', state: 'scheduled', nextRunAt: '2026-10-14T12:30:00Z' },
      { id: 'advisor.scan', name: 'Advisor', state: 'scheduled', nextRunAt: '2026-10-14T12:05:00Z' },
      { id: 'team.sync', name: 'Team', state: 'paused' },
      { id: 'apps.sync', name: 'Apps', state: 'error', errorCode: 'OFFLINE' },
      { id: 'never', name: 'No date', state: 'scheduled', nextRunAt: null },
    ],
    access: { enabled: true, writes: false, lastRequestAt: '2026-10-14T11:59:00Z' },
    port: 7190,
    now: NOW,
  });

  assert.equal(status.kua.state, 'running');
  assert.equal(status.kua.version, '2.0.0-rc.2');
  assert.equal(status.kua.plan, 'pro');
  assert.deepEqual(status.tasks.running.map(task => [task.id, task.progress, task.actions]), [['apm.collect.a', 0.5, ['cancel']]]);
  assert.deepEqual(status.tasks.upcoming.map(task => task.id), ['advisor.scan', 'logs.refresh']);
  assert.deepEqual(status.tasks.paused.map(task => task.id), ['team.sync']);
  assert.deepEqual(status.tasks.failed.map(task => task.id), ['apps.sync']);
  assert.deepEqual(status.mcp, { enabled: true, writes: false, lastRequestAt: '2026-10-14T11:59:00Z', planAllows: true });
  assert.deepEqual(status.update, { status: 'idle' });
});

test('reports a backend that does not answer, and whether it is starting', () => {
  assert.equal(buildTrayStatus({ backend: { starting: true } }).kua.state, 'starting');
  const stopped = buildTrayStatus({ backend: { managed: false }, appVersion: '2.0.0' });
  assert.equal(stopped.kua.state, 'stopped');
  assert.equal(stopped.kua.version, '2.0.0');
  assert.equal(stopped.kua.canRestart, false, 'a backend run by `npm run dev` is not ours to restart');
  assert.equal(stopped.mcp, null);
  assert.deepEqual(stopped.tasks.running, []);
});

test('accepts only known tray actions', () => {
  assert.deepEqual(parseTrayAction({ type: 'mcp', enabled: false }), { type: 'mcp', enabled: false });
  assert.equal(parseTrayAction({ type: 'mcp', enabled: 'no' }), null);
  assert.deepEqual(parseTrayAction({ type: 'task', id: 'apm.collection', action: 'pause' }), { type: 'task', id: 'apm.collection', action: 'pause' });
  assert.equal(parseTrayAction({ type: 'task', id: '../plan', action: 'pause' }), null);
  assert.equal(parseTrayAction({ type: 'task', id: 'apm.collection', action: 'delete' }), null);
  assert.deepEqual(parseTrayAction({ type: 'open', extra: 1 }), { type: 'open' });
  assert.equal(parseTrayAction({ type: 'shell' }), null);
});

test('opens above a bottom taskbar and below a top menu bar, inside the work area', () => {
  const size = { width: 360, height: 500 };
  // Windows: icon in the bottom-right taskbar.
  assert.deepEqual(
    panelPosition({ ...size, trayBounds: { x: 1800, y: 1042, width: 24, height: 38 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    { x: 1554, y: 534 },
  );
  // macOS: icon in the menu bar.
  assert.deepEqual(
    panelPosition({ ...size, trayBounds: { x: 1200, y: 0, width: 22, height: 24 }, workArea: { x: 0, y: 25, width: 1440, height: 875 } }),
    { x: 1031, y: 31 },
  );
  // No icon bounds: at the cursor, clamped.
  assert.deepEqual(
    panelPosition({ ...size, trayBounds: { x: 0, y: 0, width: 0, height: 0 }, cursor: { x: 1910, y: 1030 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    { x: 1554, y: 524 },
  );
});
