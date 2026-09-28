'use strict';

// Amazon SQS, SNS and SES for the AWS view: resource lists, 24h activity from
// CloudWatch and where each service leaves logs.
//
// Costs (always shown in the UI):
// - SQS bills every API call as a request (ListQueues, GetQueueAttributes);
//   the first 1M requests per month are free, then USD 0.40 per million.
// - CloudWatch GetMetricData: USD 0.01 per 1,000 metrics, not in the free tier.
// - SNS and SES list/describe calls have no relevant charge.

const { sumMetrics, mapWithConcurrency, settle, failure, DAY_MS } = require('./awsActivity');

const CONCURRENCY = 8;
const MAX_PAGES = 20;
const SES_DETAIL_LIMIT = 200;   // GetEmailIdentity calls per load
const HOUR_MS = 3600 * 1000;
const QUEUE_NAME_RE = /^[A-Za-z0-9_-]{1,80}(\.fifo)?$/;
const TOPIC_NAME_RE = /^[A-Za-z0-9_-]{1,256}(\.fifo)?$/;

function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function paginate(send, { items, tokenIn, tokenOut }) {
  const all = [];
  let token;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await send(token ? { [tokenIn]: token } : {});
    all.push(...(response[items] || []));
    token = response[tokenOut];
    if (!token) return { items: all, truncated: false };
  }
  return { items: all, truncated: true };
}

// ── Hourly series for a detail chart (one GetMetricData call) ────────────────

/**
 * `metrics` is { key: { namespace, metricName, dimensions, stat } }. Returns
 * { key: [{ t, v }] } over the last `hours`, one point per hour; hours without
 * data are 0 for Sum metrics and left out for gauges.
 */
async function metricSeries(cfg, metrics, { sdk = defaultSdk, now = Date.now(), hours = 24 } = {}) {
  const cw = sdk('client-cloudwatch');
  const end = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
  const start = end - hours * HOUR_MS;
  const entries = Object.entries(metrics);
  const response = await new cw.CloudWatchClient(cfg).send(new cw.GetMetricDataCommand({
    StartTime: new Date(start), EndTime: new Date(end), ScanBy: 'TimestampAscending',
    MetricDataQueries: entries.map(([, metric], i) => ({
      Id: `m${i}`, ReturnData: true,
      MetricStat: { Metric: { Namespace: metric.namespace, MetricName: metric.metricName, Dimensions: metric.dimensions || [] }, Period: 3600, Stat: metric.stat || 'Sum' },
    })),
  }));
  const byId = new Map((response.MetricDataResults || []).map(r => [r.Id, r]));
  const series = {};
  entries.forEach(([key, metric], i) => {
    const result = byId.get(`m${i}`) || {};
    const values = new Map((result.Timestamps || []).map((ts, k) => [new Date(ts).getTime(), result.Values[k]]));
    const points = [];
    for (let t = start; t < end; t += HOUR_MS) {
      if (values.has(t)) points.push({ t, v: values.get(t) });
      else if ((metric.stat || 'Sum') === 'Sum') points.push({ t, v: 0 });
    }
    series[key] = points;
  });
  return { windowHours: hours, series };
}

// ── SQS ──────────────────────────────────────────────────────────────────────

function queueNameFromUrl(url = '') {
  return String(url).split('/').pop();
}

function parseRedrive(value) {
  try {
    const policy = JSON.parse(value || 'null');
    return policy ? { dlqArn: policy.deadLetterTargetArn || null, maxReceiveCount: toInt(policy.maxReceiveCount) } : null;
  } catch { return null; }
}

/** Queues with their attributes; `dlqFor` lists the queues that send failures to each one. */
async function listSqsQueues(cfg, { sdk = defaultSdk } = {}) {
  const sqs = sdk('client-sqs');
  const client = new sqs.SQSClient(cfg);
  const { items: urls, truncated } = await paginate(
    input => client.send(new sqs.ListQueuesCommand({ MaxResults: 1000, ...input })),
    { items: 'QueueUrls', tokenIn: 'NextToken', tokenOut: 'NextToken' },
  );
  const queues = await mapWithConcurrency(urls, CONCURRENCY, async url => {
    const { Attributes: a = {} } = await client.send(new sqs.GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['All'] }));
    const redrive = parseRedrive(a.RedrivePolicy);
    return {
      name: queueNameFromUrl(url),
      url,
      arn: a.QueueArn || null,
      fifo: a.FifoQueue === 'true',
      visible: toInt(a.ApproximateNumberOfMessages),
      inFlight: toInt(a.ApproximateNumberOfMessagesNotVisible),
      delayed: toInt(a.ApproximateNumberOfMessagesDelayed),
      retentionSeconds: toInt(a.MessageRetentionPeriod),
      visibilityTimeout: toInt(a.VisibilityTimeout),
      createdAt: a.CreatedTimestamp ? Number(a.CreatedTimestamp) * 1000 : null,
      dlqArn: redrive?.dlqArn || null,
      maxReceiveCount: redrive?.maxReceiveCount ?? null,
      encryption: a.KmsMasterKeyId ? 'kms' : a.SqsManagedSseEnabled === 'true' ? 'sqs' : 'none',
    };
  });
  const byArn = new Map(queues.map(q => [q.arn, q]));
  queues.forEach(q => { q.dlqFor = []; });
  queues.forEach(q => { if (q.dlqArn && byArn.has(q.dlqArn)) byArn.get(q.dlqArn).dlqFor.push(q.name); });
  return { queues, truncated };
}

function validQueueNames(names) {
  if (!Array.isArray(names) || names.length > 2000) return null;
  return names.every(name => typeof name === 'string' && QUEUE_NAME_RE.test(name)) ? names : null;
}

function sqsMetrics(name) {
  const dimensions = [{ Name: 'QueueName', Value: name }];
  const metric = (metricName, stat = 'Sum') => ({ namespace: 'AWS/SQS', metricName, dimensions, stat });
  return { sent: metric('NumberOfMessagesSent'), received: metric('NumberOfMessagesReceived'), deleted: metric('NumberOfMessagesDeleted') };
}

/**
 * 24h sent/received/deleted per queue. SQS writes no logs of its own (API
 * calls only reach CloudTrail as data events), so `metrics` is the signal:
 * CloudWatch stops publishing for queues inactive for about 6 hours.
 */
async function sqsActivity(cfg, names, { sdk = defaultSdk, now = Date.now() } = {}) {
  const cw = sdk('client-cloudwatch');
  const metrics = await settle(sumMetrics(new cw.CloudWatchClient(cfg), cw, names, sqsMetrics, now));
  const queues = {};
  names.forEach((name, i) => {
    queues[name] = metrics.ok ? { sent: 0, received: 0, deleted: 0, ...metrics.value[i] } : null;
  });
  return { windowHours: 24, queues, metricsError: metrics.ok ? null : failure(metrics.error, 'POST /sqs/activity') };
}

function sqsQueueSeries(cfg, name, options) {
  return metricSeries(cfg, {
    ...sqsMetrics(name),
    visible: { namespace: 'AWS/SQS', metricName: 'ApproximateNumberOfMessagesVisible', dimensions: [{ Name: 'QueueName', Value: name }], stat: 'Maximum' },
    oldestAge: { namespace: 'AWS/SQS', metricName: 'ApproximateAgeOfOldestMessage', dimensions: [{ Name: 'QueueName', Value: name }], stat: 'Maximum' },
  }, options);
}

// ── SNS ──────────────────────────────────────────────────────────────────────

// Delivery status logging is configured per protocol with a feedback role.
const SNS_FEEDBACK_PROTOCOLS = [
  ['Lambda', 'lambda'], ['SQS', 'sqs'], ['HTTP', 'http'], ['Application', 'application'], ['Firehose', 'firehose'],
];

function topicNameFromArn(arn = '') {
  return String(arn).split(':').pop();
}

function deliveryLogging(attributes = {}) {
  const protocols = SNS_FEEDBACK_PROTOCOLS
    .filter(([prefix]) => attributes[`${prefix}SuccessFeedbackRoleArn`] || attributes[`${prefix}FailureFeedbackRoleArn`])
    .map(([prefix, id]) => ({
      protocol: id,
      success: !!attributes[`${prefix}SuccessFeedbackRoleArn`],
      failure: !!attributes[`${prefix}FailureFeedbackRoleArn`],
      sampleRate: toInt(attributes[`${prefix}SuccessFeedbackSampleRate`]),
    }));
  return { enabled: protocols.length > 0, protocols };
}

/** Topics with attributes and subscriptions (one account-wide subscription listing). */
async function listSnsTopics(cfg, { sdk = defaultSdk } = {}) {
  const sns = sdk('client-sns');
  const client = new sns.SNSClient(cfg);
  const [topics, subscriptions] = await Promise.all([
    paginate(input => client.send(new sns.ListTopicsCommand(input)), { items: 'Topics', tokenIn: 'NextToken', tokenOut: 'NextToken' }),
    paginate(input => client.send(new sns.ListSubscriptionsCommand(input)), { items: 'Subscriptions', tokenIn: 'NextToken', tokenOut: 'NextToken' }),
  ]);
  const subsByTopic = new Map();
  for (const sub of subscriptions.items) {
    const list = subsByTopic.get(sub.TopicArn) || [];
    list.push({
      arn: sub.SubscriptionArn,
      protocol: sub.Protocol,
      endpoint: sub.Endpoint,
      pending: sub.SubscriptionArn === 'PendingConfirmation',
    });
    subsByTopic.set(sub.TopicArn, list);
  }
  const rows = await mapWithConcurrency(topics.items, CONCURRENCY, async ({ TopicArn: arn }) => {
    const { Attributes: a = {} } = await client.send(new sns.GetTopicAttributesCommand({ TopicArn: arn }));
    const subs = subsByTopic.get(arn) || [];
    return {
      name: topicNameFromArn(arn),
      arn,
      fifo: a.FifoTopic === 'true',
      displayName: a.DisplayName || '',
      subscriptionsConfirmed: toInt(a.SubscriptionsConfirmed) ?? subs.filter(s => !s.pending).length,
      subscriptionsPending: toInt(a.SubscriptionsPending) ?? subs.filter(s => s.pending).length,
      subscriptions: subs,
      protocols: [...new Set(subs.map(s => s.protocol))].sort(),
      encrypted: !!a.KmsMasterKeyId,
      deliveryLogging: deliveryLogging(a),
    };
  });
  return { topics: rows, truncated: topics.truncated || subscriptions.truncated };
}

function validTopics(topics) {
  if (!Array.isArray(topics) || topics.length > 2000) return null;
  const out = [];
  for (const topic of topics) {
    if (!topic || !TOPIC_NAME_RE.test(topic.name || '')) return null;
    out.push({ name: topic.name, logging: !!topic.logging });
  }
  return out;
}

function snsMetrics(topic) {
  const dimensions = [{ Name: 'TopicName', Value: topic.name }];
  const metric = metricName => ({ namespace: 'AWS/SNS', metricName, dimensions });
  return { published: metric('NumberOfMessagesPublished'), delivered: metric('NumberOfNotificationsDelivered'), failed: metric('NumberOfNotificationsFailed') };
}

/**
 * 24h published/delivered/failed per topic and the state of its delivery
 * status log groups (sns/<region>/<account>/<topic>[/Failure]).
 */
async function snsActivity(cfg, topics, { sdk = defaultSdk, now = Date.now() } = {}) {
  const cw = sdk('client-cloudwatch');
  const logs = sdk('client-cloudwatch-logs');
  const logsClient = new logs.CloudWatchLogsClient(cfg);
  const [metrics, groups] = await Promise.all([
    settle(sumMetrics(new cw.CloudWatchClient(cfg), cw, topics, snsMetrics, now)),
    settle((async () => {
      const found = new Map();
      if (!topics.some(topic => topic.logging)) return found;
      let token;
      let pages = 0;
      do {
        const response = await logsClient.send(new logs.DescribeLogGroupsCommand({ logGroupNamePrefix: 'sns/', nextToken: token }));
        for (const group of response.logGroups || []) {
          const name = group.logGroupName.replace(/\/Failure$/, '').split('/').pop();
          const entry = found.get(name) || { storedBytes: 0, groups: [] };
          entry.storedBytes += group.storedBytes || 0;
          entry.groups.push(group.logGroupName);
          found.set(name, entry);
        }
        token = response.nextToken;
        pages += 1;
      } while (token && pages < MAX_PAGES);
      return found;
    })()),
  ]);
  const result = {};
  topics.forEach((topic, i) => {
    const group = groups.ok ? groups.value.get(topic.name) : null;
    let logStatus = 'off';
    if (topic.logging) logStatus = !groups.ok ? 'unknown' : !group ? 'missing' : group.storedBytes > 0 ? 'ok' : 'empty';
    result[topic.name] = {
      messages: metrics.ok ? { published: 0, delivered: 0, failed: 0, ...metrics.value[i] } : null,
      logStatus,
      logGroups: group?.groups || [],
    };
  });
  return {
    windowHours: 24,
    topics: result,
    metricsError: metrics.ok ? null : failure(metrics.error, 'POST /sns/activity'),
    logsError: groups.ok ? null : failure(groups.error, 'POST /sns/activity'),
  };
}

function snsTopicSeries(cfg, name, options) {
  return metricSeries(cfg, snsMetrics({ name }), options);
}

// ── SES (v2 API) ─────────────────────────────────────────────────────────────

function eventDestination(dest = {}) {
  const type = dest.CloudWatchDestination ? 'cloudwatch'
    : dest.KinesisFirehoseDestination ? 'firehose'
      : dest.SnsDestination ? 'sns'
        : dest.EventBridgeDestination ? 'eventbridge'
          : dest.PinpointDestination ? 'pinpoint' : 'unknown';
  const target = dest.SnsDestination?.TopicArn || dest.KinesisFirehoseDestination?.DeliveryStreamArn
    || dest.EventBridgeDestination?.EventBusArn || dest.PinpointDestination?.ApplicationArn || null;
  return { name: dest.Name, type, enabled: dest.Enabled !== false, events: dest.MatchingEventTypes || [], target };
}

/**
 * Account sending state, identities with verification/DKIM/MAIL FROM, and
 * configuration sets with their event destinations. Identity details are read
 * for the first SES_DETAIL_LIMIT identities.
 */
async function sesOverview(cfg, { sdk = defaultSdk } = {}) {
  const ses = sdk('client-sesv2');
  const client = new ses.SESv2Client(cfg);
  const [account, identities, sets] = await Promise.all([
    settle(client.send(new ses.GetAccountCommand({}))),
    paginate(input => client.send(new ses.ListEmailIdentitiesCommand({ PageSize: 1000, ...input })), { items: 'EmailIdentities', tokenIn: 'NextToken', tokenOut: 'NextToken' }),
    paginate(input => client.send(new ses.ListConfigurationSetsCommand({ PageSize: 1000, ...input })), { items: 'ConfigurationSets', tokenIn: 'NextToken', tokenOut: 'NextToken' }),
  ]);
  const detailed = identities.items.slice(0, SES_DETAIL_LIMIT);
  const details = await mapWithConcurrency(detailed, CONCURRENCY, async identity => {
    const res = await settle(client.send(new ses.GetEmailIdentityCommand({ EmailIdentity: identity.IdentityName })));
    return res.ok ? res.value : null;
  });
  const identityRows = identities.items.map((identity, i) => {
    const d = details[i] || null;
    return {
      name: identity.IdentityName,
      type: identity.IdentityType === 'EMAIL_ADDRESS' ? 'email' : 'domain',
      verification: identity.VerificationStatus || (d?.VerifiedForSendingStatus ? 'SUCCESS' : null),
      sendingEnabled: identity.SendingEnabled !== false,
      dkim: d ? (d.DkimAttributes?.SigningEnabled ? d.DkimAttributes.Status || null : 'DISABLED') : null,
      mailFrom: d?.MailFromAttributes?.MailFromDomain
        ? { domain: d.MailFromAttributes.MailFromDomain, status: d.MailFromAttributes.MailFromDomainStatus || null }
        : null,
      configurationSet: d?.ConfigurationSetName || null,
      detailLoaded: !!d,
    };
  });
  const setRows = await mapWithConcurrency(sets.items, CONCURRENCY, async name => {
    const res = await settle(client.send(new ses.GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: name })));
    return { name, destinations: res.ok ? (res.value.EventDestinations || []).map(eventDestination) : null };
  });
  const a = account.ok ? account.value : null;
  return {
    region: cfg.region || null,
    account: a ? {
      sendingEnabled: a.SendingEnabled !== false,
      productionAccess: !!a.ProductionAccessEnabled,
      enforcementStatus: a.EnforcementStatus || null,
      max24HourSend: a.SendQuota?.Max24HourSend ?? null,
      maxSendRate: a.SendQuota?.MaxSendRate ?? null,
      sentLast24Hours: a.SendQuota?.SentLast24Hours ?? null,
    } : null,
    accountError: account.ok ? null : failure(account.error, 'GET /ses'),
    identities: identityRows,
    identitiesTruncated: identities.truncated || identities.items.length > SES_DETAIL_LIMIT,
    configurationSets: setRows,
    // Where SES events can be read: any enabled destination on a configuration set.
    eventLogging: setRows.some(set => (set.destinations || []).some(dest => dest.enabled)),
  };
}

/** Account-level SES metrics (SES publishes them to CloudWatch without setup). */
function sesSeries(cfg, options) {
  const metric = (metricName, stat = 'Sum') => ({ namespace: 'AWS/SES', metricName, dimensions: [], stat });
  return metricSeries(cfg, {
    send: metric('Send'), delivery: metric('Delivery'), bounce: metric('Bounce'), complaint: metric('Complaint'), reject: metric('Reject'),
    bounceRate: metric('Reputation.BounceRate', 'Average'), complaintRate: metric('Reputation.ComplaintRate', 'Average'),
  }, options);
}

function seriesTotals(series = {}) {
  return Object.fromEntries(Object.entries(series).map(([key, points]) => [key, Math.round(points.reduce((sum, p) => sum + (p.v || 0), 0))]));
}

module.exports = {
  QUEUE_NAME_RE,
  TOPIC_NAME_RE,
  metricSeries,
  seriesTotals,
  listSqsQueues,
  validQueueNames,
  sqsActivity,
  sqsQueueSeries,
  listSnsTopics,
  validTopics,
  deliveryLogging,
  snsActivity,
  snsTopicSeries,
  sesOverview,
  sesSeries,
  DAY_MS,
};
