'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { summarizeTaskProgress } = require('./taskbarProgress');

test('aggregates active collection progress and ignores the scheduler wrapper', () => {
  const result = summarizeTaskProgress([
    { type: 'scheduler', state: 'running', progress: null },
    { type: 'collection', name: 'API', state: 'running', progress: 0.25 },
    { type: 'scan', name: 'Logs', state: 'running', progress: 0.75 },
    { type: 'collection', name: 'Done', state: 'completed', progress: 1 },
  ]);

  assert.equal(result.mode, 'determinate');
  assert.equal(result.progress, 0.5);
  assert.match(result.tooltip, /API, Logs - 50%/);
});

test('uses indeterminate mode until every active task reports progress', () => {
  const result = summarizeTaskProgress([
    { type: 'collection', name: 'API', state: 'running', progress: null },
  ]);

  assert.equal(result.mode, 'indeterminate');
  assert.equal(result.progress, null);
});

test('clears progress when no task is active', () => {
  assert.deepEqual(summarizeTaskProgress([{ state: 'scheduled', progress: null }]), {
    mode: 'none', progress: null, tooltip: 'KuaDashboard',
  });
});