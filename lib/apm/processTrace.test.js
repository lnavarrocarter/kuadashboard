'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { executionTimeline, matchingPaths, payloadShape, sanitizePayload } = require('./processTrace');

test('finds request IDs without exposing payload values', () => {
  const input = { request: { correlationId: 'req-123', customer: { email: 'private@example.com' } }, items: [1, 2] };
  assert.deepEqual(matchingPaths(input, 'req-123'), ['$.request.correlationId']);
  assert.deepEqual(payloadShape(input), {
    request: { correlationId: 'string', customer: { email: 'string' } },
    items: { type: 'array', length: 2, items: 'number' },
  });
  assert.equal(JSON.stringify(payloadShape(input)).includes('private@example.com'), false);
});

test('builds key Lambda, ECS and S3 timeline points', () => {
  const timeline = executionTimeline([
    { id: 1, type: 'TaskStateEntered', timestamp: '2026-08-11T10:00:00Z', stateEnteredEventDetails: { name: 'Validate' } },
    { id: 2, type: 'LambdaFunctionScheduled', lambdaFunctionScheduledEventDetails: { resource: 'arn:aws:lambda:us-east-1:123:function:validate' } },
    { id: 3, type: 'TaskScheduled', taskScheduledEventDetails: { resourceType: 'ecs', resource: 'runTask.sync', parameters: '{"Cluster":"prod","TaskDefinition":"worker:1"}' } },
    { id: 4, type: 'TaskScheduled', taskScheduledEventDetails: { resourceType: 's3', resource: 'putObject', parameters: '{"Bucket":"archive"}' } },
  ]);
  assert.deepEqual(timeline.map(item => item.resource?.type).filter(Boolean), ['lambda', 'ecs', 's3']);
  assert.equal(timeline[0].state, 'Validate');
});

test('shows sanitized request and response data only when explicitly enabled', () => {
  const events = [{
    id: 1,
    type: 'LambdaFunctionScheduled',
    lambdaFunctionScheduledEventDetails: {
      resource: 'arn:aws:lambda:us-east-1:123:function:orders',
      input: JSON.stringify({ orderId: 'order-123', authorization: 'Bearer private', customer: { email: 'private@example.com' } }),
    },
  }];
  assert.equal(executionTimeline(events)[0].data, undefined);
  assert.deepEqual(executionTimeline(events, { includeData: true })[0].data.request, {
    orderId: 'order-123', authorization: '[redacted]', customer: { email: '[redacted]' },
  });
});

test('bounds long strings, arrays and sensitive values', () => {
  const sanitized = sanitizePayload({ token: 'private', message: 'x'.repeat(1200), items: Array.from({ length: 30 }, (_, index) => index) });
  assert.equal(sanitized.token, '[redacted]');
  assert.equal(sanitized.message.length, 1001);
  assert.equal(sanitized.items.length, 20);
});