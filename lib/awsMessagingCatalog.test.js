'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CATALOG, resourceIdentity, metricsFor, activityMetrics, queueHealth, topicHealth, sesHealth, registryDescriptor,
} = require('./awsMessagingCatalog');

test('identities match the architecture inventory and the KUA registry', () => {
  assert.equal(resourceIdentity(CATALOG.sqs.kind, 'orders'), 'AWS::SQS::Queue:orders');
  assert.equal(resourceIdentity(CATALOG.sns.kind, 'alerts'), 'AWS::SNS::Topic:alerts');
  const descriptor = registryDescriptor('sqs', { name: 'orders', arn: 'arn:aws:sqs:us-east-1:1:orders', region: 'us-east-1' });
  assert.deepEqual(
    { identity: descriptor.identity, kind: descriptor.kind, activity: descriptor.activityMetrics },
    { identity: 'AWS::SQS::Queue:orders', kind: 'AWS::SQS::Queue', activity: ['sent', 'received', 'deleted'] },
  );
  assert.ok(descriptor.metrics.includes('oldestAge'));
});

test('metric definitions carry namespace, dimension and statistic', () => {
  assert.deepEqual(metricsFor('sqs', 'orders', ['oldestAge']).oldestAge, {
    namespace: 'AWS/SQS', metricName: 'ApproximateAgeOfOldestMessage', dimensions: [{ Name: 'QueueName', Value: 'orders' }], stat: 'Maximum', unit: 'seconds',
  });
  assert.deepEqual(Object.keys(activityMetrics('sns', 't')), ['published', 'delivered', 'failed', 'filteredOut']);
  assert.deepEqual(metricsFor('ses', null, ['send']).send.dimensions, []);
});

test('queue health: DLQ backlog, expiring messages and queues nobody consumes', () => {
  assert.deepEqual(queueHealth({ dlqFor: ['orders'], visible: 4 }).reasons.map(r => r.key), ['dlqHasMessages']);
  assert.equal(queueHealth({ dlqFor: ['orders'], visible: 4 }).status, 'warning');
  assert.equal(queueHealth({ dlqArn: 'x', dlqFor: [], retentionSeconds: 100 }, { oldestAge: 90 }).status, 'critical');
  assert.equal(queueHealth({ dlqArn: 'x', dlqFor: [], retentionSeconds: 345600 }, { oldestAge: 7200 }).status, 'warning');
  assert.equal(queueHealth({ dlqArn: 'x', dlqFor: [] }, { sent: 10, deleted: 0 }).reasons[0].key, 'notConsumed');
  // Missing DLQ is advice, not a problem.
  assert.equal(queueHealth({ dlqArn: null, dlqFor: [] }).status, 'ok');
});

test('topic health: failure rate, pending confirmations and failures without logs', () => {
  const topic = { subscriptionsConfirmed: 2, subscriptionsPending: 0, deliveryLogging: { enabled: false } };
  assert.equal(topicHealth(topic, { delivered: 99, failed: 1 }).status, 'warning');
  const critical = topicHealth(topic, { delivered: 90, failed: 10 });
  assert.equal(critical.status, 'critical');
  assert.deepEqual(critical.reasons.map(r => r.key), ['deliveryFailures', 'failuresWithoutLogs']);
  assert.equal(critical.reasons[0].params.pct, 10);
  assert.equal(topicHealth({ ...topic, subscriptionsPending: 1 }).status, 'warning');
});

test('SES health follows the AWS reputation thresholds', () => {
  const account = { sendingEnabled: true, productionAccess: true, enforcementStatus: 'HEALTHY', max24HourSend: 100, sentLast24Hours: 10 };
  assert.equal(sesHealth(account, { bounceRate: 0.02, complaintRate: 0.0005 }).status, 'ok');
  assert.equal(sesHealth(account, { bounceRate: 0.05 }).status, 'warning');
  assert.equal(sesHealth(account, { bounceRate: 0.1 }).status, 'critical');
  assert.equal(sesHealth(account, { complaintRate: 0.001 }).status, 'warning');
  assert.equal(sesHealth(account, { complaintRate: 0.005 }).status, 'critical');
  assert.equal(sesHealth({ ...account, sentLast24Hours: 95 }).status, 'warning');
  assert.equal(sesHealth({ ...account, sendingEnabled: false }).status, 'critical');
  assert.equal(sesHealth({ ...account, enforcementStatus: 'PROBATION' }).reasons[0].params.status, 'PROBATION');
  assert.equal(sesHealth(null).status, 'unknown');
});
