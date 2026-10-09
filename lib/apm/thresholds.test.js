'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateThresholds } = require('./thresholds');

const thresholds = {
  errorRatePercent: 5,
  durationMs: 1000,
  elb5xxRatePercent: 5,
  elbLatencyP95Ms: 1000,
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

test('evaluates cached log error rate and recurring signature growth with shared thresholds', () => {
  const result = evaluateThresholds([], {
    ...thresholds,
    recurringSignatureGrowthPercent: 100,
  }, {
    errorRatePercent: 8,
    signatures: [
      { signature: 'database timeout', currentOccurrences: 6, previousOccurrences: 2 },
      { signature: 'new signature', currentOccurrences: 4, previousOccurrences: 0 },
    ],
  });

  assert.equal(result.status, 'degraded');
  assert.equal(result.evaluated, 2);
  assert.deepEqual(result.signals, [
    { metric: 'logErrorRatePercent', value: 8, threshold: 5, comparison: 'maximum' },
    { metric: 'recurringSignatureGrowthPercent', signature: 'database timeout', value: 200, threshold: 100, comparison: 'maximum' },
  ]);
});

test('evaluates the targets 5xx rate, the load balancer own 5xx and p95 response latency with their defaults', () => {
  const result = evaluateThresholds([
    { metricName: 'elb_request_count', sum: 100 },
    { metricName: 'elb_target_5xx_count', sum: 6 },
    { metricName: 'elb_5xx_count', sum: 3 },
    { metricName: 'elb_target_response_time_p95_ms', average: 1200 },
  ], thresholds);

  assert.equal(result.status, 'degraded');
  assert.equal(result.evaluated, 3);
  assert.deepEqual(result.signals, [
    { metric: 'elb5xxRatePercent', value: 6, threshold: 5, comparison: 'maximum' },
    { metric: 'elbGenerated5xxCount', value: 3, threshold: 0, comparison: 'count' },
    { metric: 'elbLatencyP95Ms', value: 1200, threshold: 1000, comparison: 'maximum' },
  ]);
});

test('a load balancer without healthy targets never reads a 5xx rate over 100 % (#239)', () => {
  // The real case: 8 target errors and 885 errors of the load balancer itself for 569 requests.
  const result = evaluateThresholds([
    { metricName: 'elb_request_count', sum: 569 },
    { metricName: 'elb_target_5xx_count', sum: 8 },
    { metricName: 'elb_5xx_count', sum: 885 },
  ], thresholds);
  const rate = result.signals.find(signal => signal.metric === 'elb5xxRatePercent');
  assert.equal(rate, undefined, '8 / 569 = 1.4 % stays under the 5 % threshold');
  assert.deepEqual(result.signals.find(signal => signal.metric === 'elbGenerated5xxCount'), { metric: 'elbGenerated5xxCount', value: 885, threshold: 0, comparison: 'count' });
  for (const signal of result.signals.filter(item => item.comparison !== 'count')) assert.ok(signal.value <= 100);
});