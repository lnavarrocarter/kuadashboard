'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AwsLambdaCollector, MAX_PAGES, PAGE_LIMIT } = require('./awsCollector');

function reportEvent(eventId, requestId, timestamp) {
  return {
    eventId,
    timestamp,
    message: `REPORT RequestId: ${requestId} Duration: 10 ms Billed Duration: 10 ms Memory Size: 128 MB Max Memory Used: 40 MB`,
  };
}

function fixture({ responses, cursor = null, reservations = [] }) {
  const calls = [];
  const commits = [];
  let responseIndex = 0;
  const database = {
    getCursor() { return cursor; },
    reserveAwsRequests(input) {
      reservations.push(input);
      return { allowed: true };
    },
    commitMetricBatch(...args) { commits.push(args); },
  };
  const collector = new AwsLambdaCollector({
    database,
    now: () => Date.UTC(2026, 7, 4, 12, 31),
    configResolver: async profileId => ({ credentials: `credentials:${profileId}`, region: 'ignored' }),
    clientFactory(config) {
      assert.equal(config.region, 'eu-west-1');
      return {
        async send(command) {
          calls.push(command);
          const response = responses[responseIndex++] || {};
          if (response instanceof Error) throw response;
          return response;
        },
      };
    },
  });
  return { collector, calls, commits, database, reservations };
}

const application = { profileId: 'local:dev', region: 'eu-west-1' };
const resource = { id: 'lambda-1', type: 'lambda', name: 'orders', logGroup: '/aws/lambda/orders' };

test('uses only FilterLogEvents with 500 events and at most two pages', async () => {
  const timestamp = Date.UTC(2026, 7, 4, 12, 10);
  const subject = fixture({ responses: [
    { events: [reportEvent('event-a', 'request-a', timestamp)], nextToken: 'page-2' },
    { events: [reportEvent('event-b', 'request-b', timestamp + 1)], nextToken: 'page-3' },
  ] });

  const result = await subject.collector.collect({ application, resource });
  assert.equal(subject.calls.length, MAX_PAGES);
  assert.equal(subject.calls.every(command => command.constructor.name === 'FilterLogEventsCommand'), true);
  assert.equal(subject.calls.every(command => command.input.limit === PAGE_LIMIT), true);
  assert.equal(subject.calls[1].input.nextToken, 'page-2');
  assert.equal(subject.reservations.length, 2);
  assert.equal(result.status, 'partial');
  assert.equal(result.backlog, true);
  assert.equal(result.reports, 2);
  const [, source, buckets, nextCursor] = subject.commits[0];
  assert.equal(source, 'cloudwatch_logs');
  assert.equal(buckets.find(metric => metric.metricName === 'invocations_observed').sum, 2);
  assert.equal(nextCursor.nextToken, 'page-3');
});

test('reports reserved requests when FilterLogEvents fails', async () => {
  const subject = fixture({
    responses: [Object.assign(new Error('Log group not found'), { name: 'ResourceNotFoundException' })],
  });

  await assert.rejects(
    subject.collector.collect({ application, resource }),
    error => error.name === 'ResourceNotFoundException' && error.apmRequestCount === 1,
  );
  assert.equal(subject.reservations.length, 1);
});

test('reserves budget before sending and blocks without an AWS request', async () => {
  const subject = fixture({ responses: [] });
  subject.database.reserveAwsRequests = input => {
    subject.reservations.push(input);
    return { allowed: false };
  };
  const result = await subject.collector.collect({ application, resource });
  assert.equal(subject.calls.length, 0);
  assert.equal(subject.reservations[0].operation, 'FilterLogEvents');
  assert.equal(result.status, 'budget_exhausted');
  assert.equal(result.requests, 0);
  assert.equal(subject.commits.length, 1);
});

test('continues an existing page window and clears backlog after the last page', async () => {
  const subject = fixture({
    cursor: {
      timestamp: 1000,
      nextToken: 'page-3',
      boundaryHashes: ['old-event'],
      state: { windowStart: 500, windowEnd: 2000, requestIds: ['old-request'] },
    },
    responses: [{ events: [], nextToken: null }],
  });
  const result = await subject.collector.collect({ application, resource });
  assert.equal(subject.calls[0].input.startTime, 500);
  assert.equal(subject.calls[0].input.endTime, 2000);
  assert.equal(subject.calls[0].input.nextToken, 'page-3');
  assert.equal(result.status, 'completed');
  const nextCursor = subject.commits[0][3];
  assert.equal(nextCursor.timestamp, 2000);
  assert.equal(nextCursor.nextToken, null);
  assert.deepEqual(nextCursor.state, { requestIds: ['old-request'] });
});

test('preserves an unsent window when budget is exhausted before the first page', async () => {
  const subject = fixture({ responses: [] });
  subject.database.reserveAwsRequests = () => ({ allowed: false });
  await subject.collector.collect({ application, resource });
  const nextCursor = subject.commits[0][3];
  assert.equal(nextCursor.state.pending, true);
  assert.equal(Number.isFinite(nextCursor.state.windowStart), true);
  assert.equal(Number.isFinite(nextCursor.state.windowEnd), true);
});