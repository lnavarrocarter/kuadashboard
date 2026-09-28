'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  listSqsQueues, validQueueNames, sqsActivity, sqsQueueSeries, sqsQueueDetails,
  listSnsTopics, validTopics, deliveryLogging, snsActivity, snsTopicDetails, snsDeliveryLogs,
  sesOverview, sesSeries, seriesTotals, latestRates, sesSuppression, sesConfigurationSetMetrics, validHours,
} = require('./awsMessaging');
const { ApmDatabase } = require('./apm/database');
const { MetricHistory } = require('./metricHistory');

const NOW = Date.UTC(2026, 8, 28, 12, 30);
const HOUR = 3600 * 1000;

// Commands are classes whose instances keep their input; clients route by command name.
function command(name) {
  return class { constructor(input) { this.name = name; this.input = input; } };
}
function fakeSdk(handlers) {
  const calls = [];
  const client = class { async send(cmd) { calls.push(cmd); return handlers[cmd.name](cmd.input); } };
  const module = new Proxy({}, { get: (_, key) => (key.endsWith('Client') ? client : command(key.replace(/Command$/, ''))) });
  return { sdk: () => module, calls };
}

function metricResponse(input, valueFor) {
  return {
    MetricDataResults: input.MetricDataQueries.map(q => ({ Id: q.Id, Values: valueFor(q), Timestamps: valueFor(q).map((_, i) => new Date(NOW - i * HOUR)) })),
  };
}

test('SQS queues: attributes, DLQ links and encryption', async () => {
  const base = 'https://sqs.us-east-1.amazonaws.com/123456789012';
  const attrs = {
    orders: { QueueArn: 'arn:aws:sqs:us-east-1:123456789012:orders', ApproximateNumberOfMessages: '5', ApproximateNumberOfMessagesNotVisible: '2', ApproximateNumberOfMessagesDelayed: '0', CreatedTimestamp: '1700000000', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123456789012:orders-dlq', maxReceiveCount: 3 }), SqsManagedSseEnabled: 'true' },
    'orders-dlq': { QueueArn: 'arn:aws:sqs:us-east-1:123456789012:orders-dlq', ApproximateNumberOfMessages: '1', KmsMasterKeyId: 'alias/aws/sqs' },
    'jobs.fifo': { QueueArn: 'arn:aws:sqs:us-east-1:123456789012:jobs.fifo', FifoQueue: 'true' },
  };
  const { sdk, calls } = fakeSdk({
    ListQueues: input => (input.NextToken
      ? { QueueUrls: [`${base}/jobs.fifo`] }
      : { QueueUrls: [`${base}/orders`, `${base}/orders-dlq`], NextToken: 't1' }),
    GetQueueAttributes: input => ({ Attributes: attrs[input.QueueUrl.split('/').pop()] }),
  });
  const { queues, truncated } = await listSqsQueues({}, { sdk });
  assert.equal(truncated, false);
  assert.equal(calls.length, 5); // 2 list pages + 3 queues: every call is a billed SQS request
  const byName = Object.fromEntries(queues.map(q => [q.name, q]));
  assert.deepEqual(
    { visible: byName.orders.visible, inFlight: byName.orders.inFlight, dlqArn: byName.orders.dlqArn, maxReceiveCount: byName.orders.maxReceiveCount, encryption: byName.orders.encryption, createdAt: byName.orders.createdAt },
    { visible: 5, inFlight: 2, dlqArn: attrs['orders-dlq'].QueueArn, maxReceiveCount: 3, encryption: 'sqs', createdAt: 1700000000000 },
  );
  assert.deepEqual(byName['orders-dlq'].dlqFor, ['orders']);
  assert.equal(byName['orders-dlq'].encryption, 'kms');
  assert.equal(byName['jobs.fifo'].fifo, true);
  assert.equal(byName['jobs.fifo'].encryption, 'none');
});

test('SQS queue names are validated', () => {
  assert.deepEqual(validQueueNames(['orders', 'jobs.fifo']).map(q => q.name), ['orders', 'jobs.fifo']);
  assert.deepEqual(validQueueNames([{ name: 'dlq', isDlq: true, visible: 3 }])[0], { name: 'dlq', dlqFor: ['?'], dlqArn: null, visible: 3, retentionSeconds: null });
  assert.equal(validQueueNames(['bad name']), null);
  assert.equal(validQueueNames('orders'), null);
});

test('SQS activity sums 24h metrics and reports a metrics failure', async () => {
  const { sdk } = fakeSdk({ GetMetricData: input => metricResponse(input, () => [2, 3]) });
  const result = await sqsActivity({}, ['orders'], { sdk, now: NOW });
  const { health, ...counts } = result.queues.orders;
  assert.deepEqual(counts, { sent: 5, received: 5, deleted: 5 });
  assert.equal(health.status, 'ok');
  assert.equal(result.metricsError, null);

  const denied = fakeSdk({ GetMetricData: () => { throw Object.assign(new Error('User is not authorized to perform: cloudwatch:GetMetricData'), { name: 'AccessDenied' }); } });
  const failed = await sqsActivity({}, ['orders'], { sdk: denied.sdk, now: NOW });
  assert.equal(failed.queues.orders, null);
  assert.equal(failed.metricsError.error.kind, 'denied');
  assert.ok(failed.metricsError.access.actions.includes('cloudwatch:GetMetricData'));
});

test('metric series fill empty hours with 0 for sums and skip them for gauges', async () => {
  const hour = Math.floor(NOW / HOUR) * HOUR;
  const { sdk } = fakeSdk({
    GetMetricData: input => ({
      MetricDataResults: input.MetricDataQueries.map(q => ({ Id: q.Id, Values: [7], Timestamps: [new Date(hour)] })),
    }),
  });
  const { series, windowHours } = await sqsQueueSeries({}, 'orders', { sdk, now: NOW });
  assert.equal(windowHours, 24);
  assert.equal(series.sent.length, 24);
  assert.equal(series.sent.at(-1).v, 7);
  assert.equal(series.sent[0].v, 0);
  assert.deepEqual(series.oldestAge, [{ t: hour, v: 7 }]);
  assert.deepEqual(seriesTotals({ a: [{ v: 1 }, { v: 2.4 }] }), { a: 3 });
});

test('SNS topics: subscriptions, pending confirmations and delivery status logging', async () => {
  const arn = 'arn:aws:sns:us-east-1:123456789012:alerts';
  const { sdk } = fakeSdk({
    ListTopics: () => ({ Topics: [{ TopicArn: arn }] }),
    ListSubscriptions: () => ({ Subscriptions: [
      { TopicArn: arn, SubscriptionArn: `${arn}:1`, Protocol: 'lambda', Endpoint: 'arn:aws:lambda:fn' },
      { TopicArn: arn, SubscriptionArn: 'PendingConfirmation', Protocol: 'email', Endpoint: 'ops@example.com' },
    ] }),
    GetTopicAttributes: () => ({ Attributes: { SubscriptionsConfirmed: '1', SubscriptionsPending: '1', LambdaFailureFeedbackRoleArn: 'arn:aws:iam::1:role/sns', LambdaSuccessFeedbackSampleRate: '10' } }),
  });
  const { topics } = await listSnsTopics({}, { sdk });
  assert.equal(topics[0].name, 'alerts');
  assert.deepEqual(topics[0].protocols, ['email', 'lambda']);
  assert.equal(topics[0].subscriptions.find(s => s.protocol === 'email').pending, true);
  assert.deepEqual(topics[0].deliveryLogging, { enabled: true, protocols: [{ protocol: 'lambda', success: false, failure: true, sampleRate: 10 }] });
  assert.deepEqual(deliveryLogging({}), { enabled: false, protocols: [] });
  assert.equal(validTopics([{ name: 'bad topic' }]), null);
});

test('SNS activity: metrics and log groups per topic', async () => {
  const { sdk, calls } = fakeSdk({
    GetMetricData: input => metricResponse(input, () => [4]),
    DescribeLogGroups: () => ({ logGroups: [
      { logGroupName: 'sns/us-east-1/123456789012/alerts', storedBytes: 0 },
      { logGroupName: 'sns/us-east-1/123456789012/alerts/Failure', storedBytes: 900 },
    ] }),
  });
  const result = await snsActivity({}, [{ name: 'alerts', logging: true }, { name: 'quiet', logging: true }, { name: 'plain', logging: false }], { sdk, now: NOW });
  assert.deepEqual(result.topics.alerts.messages, { published: 4, delivered: 4, failed: 4, filteredOut: 4 });
  assert.equal(result.topics.alerts.successRate, 50);
  assert.equal(result.topics.alerts.health.status, 'critical');
  assert.equal(result.topics.alerts.logStatus, 'ok');
  assert.equal(result.topics.alerts.logGroups.length, 2);
  assert.equal(result.topics.quiet.logStatus, 'missing');
  assert.equal(result.topics.plain.logStatus, 'off');

  // Without delivery logging on any topic, log groups are not listed at all.
  calls.length = 0;
  await snsActivity({}, [{ name: 'plain', logging: false }], { sdk, now: NOW });
  assert.equal(calls.filter(c => c.name === 'DescribeLogGroups').length, 0);
});

test('SES overview: quota, identities with DKIM/MAIL FROM and event destinations', async () => {
  const { sdk } = fakeSdk({
    GetAccount: () => ({ SendingEnabled: true, ProductionAccessEnabled: false, EnforcementStatus: 'HEALTHY', SendQuota: { Max24HourSend: 200, MaxSendRate: 1, SentLast24Hours: 12 } }),
    ListEmailIdentities: () => ({ EmailIdentities: [
      { IdentityName: 'example.com', IdentityType: 'DOMAIN', VerificationStatus: 'SUCCESS', SendingEnabled: true },
      { IdentityName: 'me@example.org', IdentityType: 'EMAIL_ADDRESS', VerificationStatus: 'PENDING', SendingEnabled: false },
    ] }),
    GetEmailIdentity: input => (input.EmailIdentity === 'example.com'
      ? { DkimAttributes: { SigningEnabled: true, Status: 'SUCCESS' }, MailFromAttributes: { MailFromDomain: 'mail.example.com', MailFromDomainStatus: 'SUCCESS' }, ConfigurationSetName: 'tracking' }
      : { DkimAttributes: { SigningEnabled: false } }),
    ListConfigurationSets: () => ({ ConfigurationSets: ['tracking'] }),
    GetConfigurationSetEventDestinations: () => ({ EventDestinations: [
      { Name: 'to-cw', Enabled: true, MatchingEventTypes: ['SEND', 'BOUNCE'], CloudWatchDestination: {} },
      { Name: 'to-sns', Enabled: false, MatchingEventTypes: ['COMPLAINT'], SnsDestination: { TopicArn: 'arn:aws:sns:x' } },
    ] }),
  });
  const result = await sesOverview({ region: 'us-east-1' }, { sdk });
  assert.deepEqual(result.account, { sendingEnabled: true, productionAccess: false, enforcementStatus: 'HEALTHY', max24HourSend: 200, maxSendRate: 1, sentLast24Hours: 12, suppressedReasons: [], dedicatedIpAutoWarmup: null });
  assert.equal(result.health.status, 'ok');
  assert.deepEqual(result.health.reasons.map(r => r.key), ['sandbox']);
  const domain = result.identities.find(i => i.name === 'example.com');
  assert.deepEqual({ type: domain.type, dkim: domain.dkim, mailFrom: domain.mailFrom, configurationSet: domain.configurationSet },
    { type: 'domain', dkim: 'SUCCESS', mailFrom: { domain: 'mail.example.com', status: 'SUCCESS', onMxFailure: null }, configurationSet: 'tracking' });
  const email = result.identities.find(i => i.type === 'email');
  assert.equal(email.dkim, 'DISABLED');
  assert.equal(email.sendingEnabled, false);
  assert.deepEqual(result.configurationSets[0].destinations.map(d => [d.type, d.enabled]), [['cloudwatch', true], ['sns', false]]);
  assert.equal(result.configurationSets[0].destinations[1].target, 'arn:aws:sns:x');
  assert.equal(result.eventLogging, true);
});

test('SES overview keeps identities when the account call is denied', async () => {
  const { sdk } = fakeSdk({
    GetAccount: () => { throw Object.assign(new Error('User is not authorized to perform: ses:GetAccount'), { name: 'AccessDeniedException' }); },
    ListEmailIdentities: () => ({ EmailIdentities: [] }),
    ListConfigurationSets: () => ({ ConfigurationSets: [] }),
  });
  const result = await sesOverview({}, { sdk });
  assert.equal(result.account, null);
  assert.equal(result.accountError.error.kind, 'denied');
  assert.equal(result.eventLogging, false);
});

test('SES series are account level (no dimensions)', async () => {
  let queries;
  const { sdk } = fakeSdk({ GetMetricData: input => { queries = input.MetricDataQueries; return { MetricDataResults: [] }; } });
  const { series } = await sesSeries({}, { sdk, now: NOW });
  assert.deepEqual(Object.keys(series), ['send', 'delivery', 'bounce', 'complaint', 'reject', 'renderingFailure', 'bounceRate', 'complaintRate']);
  assert.ok(queries.every(q => q.MetricStat.Metric.Namespace === 'AWS/SES' && q.MetricStat.Metric.Dimensions.length === 0));
  assert.deepEqual(series.bounceRate, []);
});

// ── History, details, logs, suppression and configuration set metrics ────────

function historyFixture(now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-msg-history-'));
  const database = new ApmDatabase({ filePath: path.join(dir, 'apm.sqlite3') });
  return { history: new MetricHistory(database.db, { now: () => now }), close: () => { database.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('activity writes hourly points to history, so a detail only requests the missing metrics', async () => {
  const { history, close } = historyFixture(NOW);
  const hour = Math.floor(NOW / HOUR) * HOUR;
  const requested = [];
  const { sdk } = fakeSdk({
    GetMetricData: input => {
      requested.push(input.MetricDataQueries.map(q => q.MetricStat.Metric.MetricName));
      return { MetricDataResults: input.MetricDataQueries.map(q => ({ Id: q.Id, Values: [2], Timestamps: [new Date(hour)] })) };
    },
  });
  await sqsActivity({}, ['orders'], { sdk, now: NOW, history, profileId: 'p1', region: 'us-east-1' });
  const detail = await sqsQueueSeries({}, 'orders', { sdk, now: NOW, history, profileId: 'p1', region: 'us-east-1', ttlMs: 15 * 60 * 1000 });
  // The table read sent/received/deleted; the detail asks CloudWatch only for the other 4.
  assert.deepEqual(requested[1].sort(), ['ApproximateAgeOfOldestMessage', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesVisible', 'NumberOfEmptyReceives']);
  assert.deepEqual(detail.cache, { requested: 4, reused: 3, historyFrom: hour + HOUR - 24 * HOUR });
  assert.equal(detail.series.sent.at(-1).v, 2);
  assert.equal(detail.series.sent.length, 24);

  // Opening it again within the cache time requests nothing at all.
  const again = await sqsQueueSeries({}, 'orders', { sdk, now: NOW, history, profileId: 'p1', region: 'us-east-1', ttlMs: 15 * 60 * 1000 });
  assert.equal(requested.length, 2);
  assert.equal(again.cache.requested, 0);

  // A 7-day range reads CloudWatch for the whole week (same cost per metric), then keeps it.
  const week = await sqsQueueSeries({}, 'orders', { sdk, now: NOW, history, profileId: 'p1', region: 'us-east-1', hours: 168 });
  assert.equal(week.cache.requested, 7);
  assert.equal(week.series.sent.length, 168);
  close();
});

test('ranges are limited to 24h, 7d and 30d', () => {
  assert.equal(validHours(undefined), 24);
  assert.equal(validHours('168'), 168);
  assert.equal(validHours('720'), 720);
  assert.equal(validHours('5'), null);
});

test('SQS details: config, policy, tags, Lambda consumers and SNS producers', async () => {
  const arn = 'arn:aws:sqs:us-east-1:1:orders';
  const { sdk, calls } = fakeSdk({
    GetQueueAttributes: () => ({ Attributes: {
      QueueArn: arn, ReceiveMessageWaitTimeSeconds: '0', DelaySeconds: '0', MaximumMessageSize: '262144', VisibilityTimeout: '30',
      MessageRetentionPeriod: '345600', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: `${arn}-dlq`, maxReceiveCount: 5 }),
      Policy: JSON.stringify({ Statement: [{ Sid: 'sns', Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Condition: { ArnEquals: {} } }] }),
    } }),
    ListQueueTags: () => ({ Tags: { team: 'orders' } }),
    ListEventSourceMappings: () => ({ EventSourceMappings: [{ FunctionArn: 'arn:aws:lambda:us-east-1:1:function:worker', State: 'Enabled', BatchSize: 10, LastProcessingResult: 'OK' }] }),
    ListSubscriptions: () => ({ Subscriptions: [
      { Protocol: 'sqs', Endpoint: arn, TopicArn: 'arn:aws:sns:us-east-1:1:orders-events', SubscriptionArn: 'x' },
      { Protocol: 'email', Endpoint: 'a@b.c', TopicArn: 'arn:aws:sns:us-east-1:1:other', SubscriptionArn: 'y' },
    ] }),
  });
  const detail = await sqsQueueDetails({}, 'https://sqs.us-east-1.amazonaws.com/1/orders', { sdk });
  assert.equal(detail.config.receiveWaitSeconds, 0);
  assert.deepEqual(detail.redrive, { dlqArn: `${arn}-dlq`, maxReceiveCount: 5 });
  assert.deepEqual(detail.policy, [{ sid: 'sns', effect: 'Allow', principals: ['sns.amazonaws.com'], actions: ['sqs:SendMessage'], conditions: ['ArnEquals'] }]);
  assert.deepEqual(detail.tags, { team: 'orders' });
  assert.deepEqual(detail.consumers.map(c => [c.function, c.state, c.batchSize]), [['worker', 'Enabled', 10]]);
  assert.deepEqual(detail.producers, [{ topic: 'orders-events', topicArn: 'arn:aws:sns:us-east-1:1:orders-events', pending: false }]);
  // Two billed SQS requests per detail.
  assert.equal(calls.filter(c => ['GetQueueAttributes', 'ListQueueTags'].includes(c.name)).length, 2);
});

test('SNS details: subscription filter policies, raw delivery and DLQs', async () => {
  const arn = 'arn:aws:sns:us-east-1:1:alerts';
  const { sdk } = fakeSdk({
    GetTopicAttributes: () => ({ Attributes: { Policy: JSON.stringify({ Statement: { Effect: 'Allow', Principal: '*', Action: ['SNS:Publish'] } }) } }),
    ListSubscriptionsByTopic: () => ({ Subscriptions: [
      { SubscriptionArn: `${arn}:1`, Protocol: 'sqs', Endpoint: 'arn:aws:sqs:us-east-1:1:q' },
      { SubscriptionArn: 'PendingConfirmation', Protocol: 'email', Endpoint: 'ops@example.com' },
    ] }),
    GetSubscriptionAttributes: () => ({ Attributes: { FilterPolicy: '{"type":["order"]}', RawMessageDelivery: 'true', RedrivePolicy: '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:1:dlq"}' } }),
    ListTagsForResource: () => ({ Tags: [{ Key: 'env', Value: 'dev' }] }),
  });
  const detail = await snsTopicDetails({}, arn, { sdk });
  assert.deepEqual(detail.policy[0].principals, ['*']);
  assert.deepEqual(detail.tags, { env: 'dev' });
  const [sqs, email] = detail.subscriptions;
  assert.deepEqual({ filter: sqs.filterPolicy, scope: sqs.filterScope, raw: sqs.rawDelivery, dlq: sqs.dlqArn }, { filter: { type: ['order'] }, scope: 'MessageAttributes', raw: true, dlq: 'arn:aws:sqs:us-east-1:1:dlq' });
  assert.equal(email.pending, true);
  assert.equal(email.detailLoaded, false);
});

test('SNS delivery logs: parsed events from success and failure groups, missing groups reported', async () => {
  const arn = 'arn:aws:sns:us-east-1:123456789012:alerts';
  const { sdk, calls } = fakeSdk({
    FilterLogEvents: input => {
      if (input.logGroupName.endsWith('/Failure')) {
        return { events: [{ timestamp: NOW - 1000, message: JSON.stringify({ status: 'FAILURE', notification: { messageId: 'm2' }, delivery: { destination: 'arn:aws:lambda:fn', statusCode: 500, providerResponse: 'Throttled', dwellTimeMs: 90, attempts: 3 } }) }] };
      }
      throw Object.assign(new Error('The specified log group does not exist.'), { name: 'ResourceNotFoundException' });
    },
  });
  const logs = await snsDeliveryLogs({}, arn, { sdk, now: NOW });
  assert.deepEqual(calls.map(c => c.input.logGroupName), ['sns/us-east-1/123456789012/alerts', 'sns/us-east-1/123456789012/alerts/Failure']);
  assert.deepEqual(logs.groups.map(g => [g.kind, g.exists, g.count]), [['success', false, 0], ['failure', true, 1]]);
  assert.deepEqual(logs.counts, { success: 0, failure: 1 });
  assert.deepEqual(
    { status: logs.events[0].status, code: logs.events[0].statusCode, response: logs.events[0].providerResponse, attempts: logs.events[0].attempts },
    { status: 'FAILURE', code: 500, response: 'Throttled', attempts: 3 },
  );

  calls.length = 0;
  await snsDeliveryLogs({}, arn, { sdk, now: NOW, status: 'failure' });
  assert.deepEqual(calls.map(c => c.input.logGroupName), ['sns/us-east-1/123456789012/alerts/Failure']);
});

test('SES rates, suppression list and configuration set metrics', async () => {
  assert.deepEqual(latestRates({ bounceRate: [{ v: 0.01 }, { v: 0.02 }], complaintRate: [] }), { bounceRate: 0.02, complaintRate: null });

  const { sdk } = fakeSdk({
    ListSuppressedDestinations: () => ({ SuppressedDestinationSummaries: [
      { EmailAddress: 'old@x.com', Reason: 'BOUNCE', LastUpdateTime: new Date(NOW - HOUR) },
      { EmailAddress: 'new@x.com', Reason: 'COMPLAINT', LastUpdateTime: new Date(NOW) },
    ] }),
  });
  const suppression = await sesSuppression({}, { sdk });
  assert.deepEqual(suppression.byReason, { BOUNCE: 1, COMPLAINT: 1 });
  assert.equal(suppression.items[0].email, 'new@x.com');

  const setSdk = fakeSdk({
    GetConfigurationSetEventDestinations: () => ({ EventDestinations: [
      { Name: 'cw', Enabled: true, MatchingEventTypes: ['SEND', 'BOUNCE'], CloudWatchDestination: { DimensionConfigurations: [{ DimensionName: 'campaign', DimensionValueSource: 'MESSAGE_TAG', DefaultDimensionValue: 'none' }] } },
    ] }),
    ListMetrics: () => ({ Metrics: [
      { MetricName: 'Send', Dimensions: [{ Name: 'campaign', Value: 'welcome' }] },
      { MetricName: 'Bounce', Dimensions: [{ Name: 'campaign', Value: 'welcome' }] },
      { MetricName: 'Send', Dimensions: [{ Name: 'campaign', Value: 'x' }, { Name: 'other', Value: 'y' }] },
      { MetricName: 'Unrelated', Dimensions: [{ Name: 'campaign', Value: 'welcome' }] },
    ] }),
    GetMetricData: input => ({ MetricDataResults: input.MetricDataQueries.map(q => ({ Id: q.Id, Values: [3], Timestamps: [new Date(Math.floor(NOW / HOUR) * HOUR)] })) }),
  });
  const estimate = await sesConfigurationSetMetrics({ region: 'us-east-1' }, 'tracking', { sdk: setSdk.sdk, estimate: true, now: NOW });
  assert.deepEqual(estimate.metrics.map(m => m.key), ['send|campaign=welcome', 'bounce|campaign=welcome']);
  assert.equal(estimate.series, null);
  assert.equal(setSdk.calls.filter(c => c.name === 'GetMetricData').length, 0);
  const full = await sesConfigurationSetMetrics({ region: 'us-east-1' }, 'tracking', { sdk: setSdk.sdk, now: NOW });
  assert.deepEqual(full.totals, { 'send|campaign=welcome': 3, 'bounce|campaign=welcome': 3 });

  // Without a CloudWatch destination nothing is listed or requested.
  const none = fakeSdk({ GetConfigurationSetEventDestinations: () => ({ EventDestinations: [{ Name: 'sns', Enabled: true, SnsDestination: { TopicArn: 't' } }] }) });
  const empty = await sesConfigurationSetMetrics({}, 'x', { sdk: none.sdk, now: NOW });
  assert.deepEqual(empty.metrics, []);
  assert.equal(none.calls.length, 1);
});
