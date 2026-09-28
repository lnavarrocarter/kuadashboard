'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  listSqsQueues, validQueueNames, sqsActivity, sqsQueueSeries,
  listSnsTopics, validTopics, deliveryLogging, snsActivity,
  sesOverview, sesSeries, seriesTotals,
} = require('./awsMessaging');

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
  assert.deepEqual(validQueueNames(['orders', 'jobs.fifo']), ['orders', 'jobs.fifo']);
  assert.equal(validQueueNames(['bad name']), null);
  assert.equal(validQueueNames('orders'), null);
});

test('SQS activity sums 24h metrics and reports a metrics failure', async () => {
  const { sdk } = fakeSdk({ GetMetricData: input => metricResponse(input, () => [2, 3]) });
  const result = await sqsActivity({}, ['orders'], { sdk, now: NOW });
  assert.deepEqual(result.queues.orders, { sent: 5, received: 5, deleted: 5 });
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
  assert.deepEqual(result.topics.alerts.messages, { published: 4, delivered: 4, failed: 4 });
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
  assert.deepEqual(result.account, { sendingEnabled: true, productionAccess: false, enforcementStatus: 'HEALTHY', max24HourSend: 200, maxSendRate: 1, sentLast24Hours: 12 });
  const domain = result.identities.find(i => i.name === 'example.com');
  assert.deepEqual({ type: domain.type, dkim: domain.dkim, mailFrom: domain.mailFrom, configurationSet: domain.configurationSet },
    { type: 'domain', dkim: 'SUCCESS', mailFrom: { domain: 'mail.example.com', status: 'SUCCESS' }, configurationSet: 'tracking' });
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
  assert.deepEqual(Object.keys(series), ['send', 'delivery', 'bounce', 'complaint', 'reject', 'bounceRate', 'complaintRate']);
  assert.ok(queries.every(q => q.MetricStat.Metric.Namespace === 'AWS/SES' && q.MetricStat.Metric.Dimensions.length === 0));
  assert.deepEqual(series.bounceRate, []);
});
