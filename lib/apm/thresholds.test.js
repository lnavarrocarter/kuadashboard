'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateThresholds } = require('./thresholds');

const thresholds = {
  errorRatePercent: 5,
  durationMs: 1000,
  readyPodsPercent: 100,
  restartDelta: 1,
};

test('reports unknown health without evaluable metrics', () => {
  assert.deepEqual(evaluateThresholds([], thresholds), { status: 'unknown', evaluated: 0, signals: [] });
});

test('evaluates Lambda and Kubernetes threshold breaches', () => {
  const result = evaluateThresholds([
    { metricName: 'invocations_observed', sum: 100 },
    { metricName: 'errors_observed', sum: 6 },
    { metricName: 'duration_ms', average: 900 },
    { metricName: 'pods_ready', sum: 9 },
    { metricName: 'pods_total', sum: 10 },
    { metricName: 'restarts_delta', sum: 1 },
  ], thresholds);

  assert.equal(result.status, 'degraded');
  assert.equal(result.evaluated, 4);
  assert.deepEqual(result.signals.map(signal => signal.metric), [
    'errorRatePercent', 'readyPodsPercent', 'restartDelta',
  ]);
});

test('supports disabling individual thresholds with null', () => {
  const result = evaluateThresholds([
    { metricName: 'restarts_delta', sum: 4 },
  ], { ...thresholds, restartDelta: null });
  assert.equal(result.status, 'unknown');
});