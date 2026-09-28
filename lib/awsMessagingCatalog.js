'use strict';

// One catalog for SQS, SNS and SES: which CloudWatch metrics exist, which the
// tables load (activity) and which the details add, the KUA registry identity
// of each resource, and a health evaluation. The views use it today; a KUA
// Application can use the same identities, metrics and health later.

const QUEUE = 'AWS::SQS::Queue';
const TOPIC = 'AWS::SNS::Topic';
const SES_ACCOUNT = 'AWS::SES::Account';
const SES_CONFIGURATION_SET = 'AWS::SES::ConfigurationSet';
const SES_IDENTITY = 'AWS::SES::EmailIdentity';

/** Registry identity, matching lib/architecture/awsRegionalInventoryReader.js. */
function resourceIdentity(kind, name) {
  return `${kind}:${name}`;
}

// { key: [metricName, stat, unit] }. `activity` lists what a table loads for every
// resource (billed per resource); the detail loads the rest for one resource.
const CATALOG = {
  sqs: {
    kind: QUEUE,
    namespace: 'AWS/SQS',
    dimension: 'QueueName',
    metrics: {
      sent: ['NumberOfMessagesSent', 'Sum', 'count'],
      received: ['NumberOfMessagesReceived', 'Sum', 'count'],
      deleted: ['NumberOfMessagesDeleted', 'Sum', 'count'],
      emptyReceives: ['NumberOfEmptyReceives', 'Sum', 'count'],
      visible: ['ApproximateNumberOfMessagesVisible', 'Maximum', 'count'],
      inFlight: ['ApproximateNumberOfMessagesNotVisible', 'Maximum', 'count'],
      oldestAge: ['ApproximateAgeOfOldestMessage', 'Maximum', 'seconds'],
    },
    activity: ['sent', 'received', 'deleted'],
  },
  sns: {
    kind: TOPIC,
    namespace: 'AWS/SNS',
    dimension: 'TopicName',
    metrics: {
      published: ['NumberOfMessagesPublished', 'Sum', 'count'],
      delivered: ['NumberOfNotificationsDelivered', 'Sum', 'count'],
      failed: ['NumberOfNotificationsFailed', 'Sum', 'count'],
      filteredOut: ['NumberOfNotificationsFilteredOut', 'Sum', 'count'],
      redrivenToDlq: ['NumberOfNotificationsRedrivenToDlq', 'Sum', 'count'],
      failedToRedriveToDlq: ['NumberOfNotificationsFailedToRedriveToDlq', 'Sum', 'count'],
      publishSize: ['PublishSize', 'Average', 'bytes'],
    },
    activity: ['published', 'delivered', 'failed', 'filteredOut'],
  },
  // Account-level metrics SES publishes without any setup.
  ses: {
    kind: SES_ACCOUNT,
    namespace: 'AWS/SES',
    dimension: null,
    metrics: {
      send: ['Send', 'Sum', 'count'],
      delivery: ['Delivery', 'Sum', 'count'],
      bounce: ['Bounce', 'Sum', 'count'],
      complaint: ['Complaint', 'Sum', 'count'],
      reject: ['Reject', 'Sum', 'count'],
      renderingFailure: ['RenderingFailure', 'Sum', 'count'],
      bounceRate: ['Reputation.BounceRate', 'Average', 'ratio'],
      complaintRate: ['Reputation.ComplaintRate', 'Average', 'ratio'],
    },
    activity: ['send', 'delivery', 'bounce', 'complaint', 'reject', 'renderingFailure', 'bounceRate', 'complaintRate'],
  },
};

// Events a configuration set's CloudWatch destination publishes, one metric each.
const SES_EVENT_METRICS = {
  send: 'Send', delivery: 'Delivery', bounce: 'Bounce', complaint: 'Complaint', reject: 'Reject',
  open: 'Open', click: 'Click', renderingFailure: 'RenderingFailure', deliveryDelay: 'DeliveryDelay',
};

/** CloudWatch metric definitions for a resource: { key: { namespace, metricName, dimensions, stat, unit } }. */
function metricsFor(service, name, keys = Object.keys(CATALOG[service].metrics)) {
  const entry = CATALOG[service];
  const dimensions = entry.dimension ? [{ Name: entry.dimension, Value: name }] : [];
  return Object.fromEntries(keys.map(key => {
    const [metricName, stat, unit] = entry.metrics[key];
    return [key, { namespace: entry.namespace, metricName, dimensions, stat, unit }];
  }));
}

function activityMetrics(service, name) {
  return metricsFor(service, name, CATALOG[service].activity);
}

// ── Health ───────────────────────────────────────────────────────────────────
// Reasons are message keys the UI translates, with their parameters.

// AWS review thresholds for SES sending reputation.
const SES_BOUNCE_WARN = 0.05;
const SES_BOUNCE_CRITICAL = 0.10;
const SES_COMPLAINT_WARN = 0.001;
const SES_COMPLAINT_CRITICAL = 0.005;
const RANK = { unknown: 0, ok: 1, info: 1, warning: 2, critical: 3 };

function worst(reasons) {
  if (!reasons.length) return 'ok';
  return reasons.reduce((acc, r) => (RANK[r.level] > RANK[acc] ? r.level : acc), 'ok');
}

function queueHealth(queue, activity = null) {
  const reasons = [];
  if (queue.dlqFor?.length && queue.visible > 0) reasons.push({ level: 'warning', key: 'dlqHasMessages', params: { n: queue.visible } });
  if (!queue.dlqArn && !queue.dlqFor?.length) reasons.push({ level: 'info', key: 'noDlq' });
  const age = activity?.oldestAge;
  if (age != null && queue.retentionSeconds && age >= queue.retentionSeconds * 0.8) {
    reasons.push({ level: 'critical', key: 'messagesExpiring', params: { age, retention: queue.retentionSeconds } });
  } else if (age != null && age >= 3600) {
    reasons.push({ level: 'warning', key: 'oldBacklog', params: { age } });
  }
  if (activity && activity.sent > 0 && activity.deleted === 0 && !queue.dlqFor?.length) reasons.push({ level: 'warning', key: 'notConsumed', params: { sent: activity.sent } });
  return { status: worst(reasons), reasons };
}

function topicHealth(topic, activity = null) {
  const reasons = [];
  if (!topic.subscriptionsConfirmed && !topic.subscriptionsPending) reasons.push({ level: 'info', key: 'noSubscriptions' });
  if (topic.subscriptionsPending > 0) reasons.push({ level: 'warning', key: 'pendingSubscriptions', params: { n: topic.subscriptionsPending } });
  if (activity) {
    const attempts = (activity.delivered || 0) + (activity.failed || 0);
    const failureRate = attempts ? activity.failed / attempts : 0;
    if (failureRate >= 0.05) reasons.push({ level: 'critical', key: 'deliveryFailures', params: { pct: Math.round(failureRate * 1000) / 10, n: activity.failed } });
    else if (activity.failed > 0) reasons.push({ level: 'warning', key: 'deliveryFailures', params: { pct: Math.round(failureRate * 1000) / 10, n: activity.failed } });
    if (activity.failed > 0 && !topic.deliveryLogging?.enabled) reasons.push({ level: 'warning', key: 'failuresWithoutLogs' });
  }
  return { status: worst(reasons), reasons };
}

function sesHealth(account, rates = {}) {
  const reasons = [];
  if (!account) return { status: 'unknown', reasons };
  if (account.sendingEnabled === false) reasons.push({ level: 'critical', key: 'sendingPaused' });
  if (account.enforcementStatus && account.enforcementStatus !== 'HEALTHY') reasons.push({ level: 'critical', key: 'enforcement', params: { status: account.enforcementStatus } });
  if (account.max24HourSend > 0 && account.sentLast24Hours / account.max24HourSend >= 0.9) reasons.push({ level: 'warning', key: 'quotaNearlyUsed', params: { pct: Math.round((account.sentLast24Hours / account.max24HourSend) * 100) } });
  const bounce = rates.bounceRate;
  if (bounce != null && bounce >= SES_BOUNCE_CRITICAL) reasons.push({ level: 'critical', key: 'bounceRate', params: { pct: +(bounce * 100).toFixed(2) } });
  else if (bounce != null && bounce >= SES_BOUNCE_WARN) reasons.push({ level: 'warning', key: 'bounceRate', params: { pct: +(bounce * 100).toFixed(2) } });
  const complaint = rates.complaintRate;
  if (complaint != null && complaint >= SES_COMPLAINT_CRITICAL) reasons.push({ level: 'critical', key: 'complaintRate', params: { pct: +(complaint * 100).toFixed(2) } });
  else if (complaint != null && complaint >= SES_COMPLAINT_WARN) reasons.push({ level: 'warning', key: 'complaintRate', params: { pct: +(complaint * 100).toFixed(2) } });
  if (!account.productionAccess) reasons.push({ level: 'info', key: 'sandbox' });
  return { status: worst(reasons), reasons };
}

/**
 * Registry descriptor for a KUA Application: identity, kind, ARN and the
 * metric keys history holds for it. Not wired to collection yet.
 */
function registryDescriptor(service, { name, arn = null, region = '' }) {
  const entry = CATALOG[service];
  return {
    provider: 'aws',
    service,
    kind: entry.kind,
    identity: resourceIdentity(entry.kind, name),
    name,
    arn,
    region,
    metrics: Object.keys(entry.metrics),
    activityMetrics: entry.activity,
  };
}

module.exports = {
  CATALOG,
  SES_EVENT_METRICS,
  SES_CONFIGURATION_SET,
  SES_IDENTITY,
  SES_BOUNCE_WARN,
  SES_BOUNCE_CRITICAL,
  SES_COMPLAINT_WARN,
  SES_COMPLAINT_CRITICAL,
  resourceIdentity,
  metricsFor,
  activityMetrics,
  queueHealth,
  topicHealth,
  sesHealth,
  registryDescriptor,
};
