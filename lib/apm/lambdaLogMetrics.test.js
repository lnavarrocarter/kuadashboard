'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { BUCKET_MS, aggregateLambdaLogEvents, parseLambdaReport } = require('./lambdaLogMetrics');

test('parses text and structured Lambda reports', () => {
  const text = parseLambdaReport('REPORT RequestId: request-a Duration: 12.34 ms Billed Duration: 13 ms Memory Size: 256 MB Max Memory Used: 91 MB Init Duration: 45.67 ms');
  const json = parseLambdaReport(JSON.stringify({
    type: 'platform.report',
    record: {
      requestId: 'request-b',
      status: 'timeout',
      errorType: 'Runtime.ExitError',
      metrics: { durationMs: 3000, billedDurationMs: 3000, memorySizeMB: 128, maxMemoryUsedMB: 80 },
    },
  }));
  assert.deepEqual(text, {
    requestId: 'request-a', durationMs: 12.34, billedDurationMs: 13,
    memorySizeMb: 256, maxMemoryUsedMb: 91, initDurationMs: 45.67,
    status: '', errorType: '',
  });
  assert.equal(json.status, 'timeout');
  assert.equal(json.durationMs, 3000);
});

test('aggregates 30-minute metrics, cold starts, errors and timeouts without raw logs', () => {
  const timestamp = Date.UTC(2026, 7, 4, 12, 17);
  const result = aggregateLambdaLogEvents([
    {
      eventId: 'event-a', timestamp,
      message: 'REPORT RequestId: request-a Duration: 12.34 ms Billed Duration: 13 ms Memory Size: 256 MB Max Memory Used: 91 MB Init Duration: 45.67 ms',
    },
    {
      eventId: 'event-b', timestamp: timestamp + 1000,
      message: 'REPORT RequestId: request-b Duration: 3000 ms Billed Duration: 3000 ms Memory Size: 256 MB Max Memory Used: 100 MB Status: timeout Error Type: Runtime.ExitError',
    },
  ]);
  const metrics = Object.fromEntries(result.buckets.map(metric => [metric.metricName, metric]));
  assert.equal(metrics.invocations_observed.sum, 2);
  assert.equal(metrics.errors_observed.sum, 1);
  assert.equal(metrics.timeouts_observed.sum, 1);
  assert.equal(metrics.cold_starts_observed.sum, 1);
  assert.deepEqual(
    { count: metrics.duration_ms.count, sum: metrics.duration_ms.sum, min: metrics.duration_ms.min, max: metrics.duration_ms.max },
    { count: 2, sum: 3012.34, min: 12.34, max: 3000 },
  );
  assert.equal(result.buckets.every(metric => metric.bucketStart === Math.floor(timestamp / BUCKET_MS) * BUCKET_MS), true);
  assert.equal(JSON.stringify(result).includes('REPORT RequestId'), false);
});

test('deduplicates event and request boundaries', () => {
  const message = 'REPORT RequestId: request-a Duration: 1 ms Billed Duration: 1 ms Memory Size: 128 MB Max Memory Used: 40 MB';
  const result = aggregateLambdaLogEvents([
    { eventId: 'event-a', timestamp: 1000, message },
    { eventId: 'event-b', timestamp: 1001, message },
    { eventId: 'already-seen', timestamp: 1002, message: message.replace('request-a', 'request-c') },
  ], { seenEventIds: ['already-seen'] });
  const invocation = result.buckets.find(metric => metric.metricName === 'invocations_observed');
  assert.equal(invocation.sum, 1);
  assert.equal(result.ignored, 2);
});