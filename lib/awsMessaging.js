'use strict';

// Amazon SQS, SNS and SES for the AWS view: resource lists, 24h activity from
// CloudWatch, details, logs and health. Metric definitions, registry identities
// and health rules live in lib/awsMessagingCatalog.js.
//
// Costs (always shown in the UI):
// - SQS bills every API call as a request (ListQueues, GetQueueAttributes,
//   ListQueueTags); the first 1M requests per month are free, then USD 0.40
//   per million.
// - CloudWatch GetMetricData: USD 0.01 per 1,000 metrics requested, whatever
//   the time range; not in the free tier. Metric history (lib/metricHistory.js)
//   avoids requesting metrics that were read recently.
// - CloudWatch ListMetrics: USD 0.01 per 1,000 requests (1M free per month).
// - SNS, SES, Lambda list/describe calls and CloudWatch Logs FilterLogEvents
//   have no per-call charge (Logs Insights, which bills per GB, is not used).

const { sumMetrics, mapWithConcurrency, settle, failure, DAY_MS } = require('./awsActivity');
const {
  CATALOG, SES_EVENT_METRICS, SES_CONFIGURATION_SET, resourceIdentity, metricsFor, activityMetrics,
  queueHealth, topicHealth, sesHealth,
} = require('./awsMessagingCatalog');

const CONCURRENCY = 8;
const MAX_PAGES = 20;
const SES_DETAIL_LIMIT = 200;        // GetEmailIdentity calls per load
const SUBSCRIPTION_DETAIL_LIMIT = 50; // GetSubscriptionAttributes calls per topic detail
const SES_SET_METRIC_LIMIT = 50;     // metrics per configuration set detail
const SUPPRESSION_LIMIT = 1000;
const LOG_EVENT_LIMIT = 100;
const HOUR_MS = 3600 * 1000;
const ALLOWED_HOURS = new Set([24, 168, 720]);
const QUEUE_NAME_RE = /^[A-Za-z0-9_-]{1,80}(\.fifo)?$/;
const TOPIC_NAME_RE = /^[A-Za-z0-9_-]{1,256}(\.fifo)?$/;
const QUEUE_URL_RE = /^https:\/\/[a-z0-9.-]+\.amazonaws\.com(\.cn)?\/\d{12}\/[A-Za-z0-9_-]{1,80}(\.fifo)?$/;
const TOPIC_ARN_RE = /^arn:aws[a-z-]*:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}(\.fifo)?$/;
const SET_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseJson(value, fallback = null) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function validHours(value) {
  const n = Number(value || 24);
  return ALLOWED_HOURS.has(n) ? n : null;
}

async function paginate(send, { items, tokenIn, tokenOut, maxPages = MAX_PAGES }) {
  const all = [];
  let token;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await send(token ? { [tokenIn]: token } : {});
    all.push(...(response[items] || []));
    token = response[tokenOut];
    if (!token) return { items: all, truncated: false };
  }
  return { items: all, truncated: true };
}

// ── Series (with history) ────────────────────────────────────────────────────

function hourWindow(now, hours) {
  const to = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
  return { from: to - hours * HOUR_MS, to };
}

/** Hourly points with the empty hours of Sum metrics filled with 0 inside [from, to). */
function fillHours(points, metric, from, to, coveredFrom = from) {
  const byTime = new Map(points.map(p => [p.t, p.v]));
  const out = [];
  for (let t = from; t < to; t += HOUR_MS) {
    if (byTime.has(t)) out.push({ t, v: byTime.get(t) });
    else if ((metric.stat || 'Sum') === 'Sum' && t >= coveredFrom) out.push({ t, v: 0 });
  }
  return out;
}

async function requestSeries(cfg, sdk, metrics, from, to) {
  const cw = sdk('client-cloudwatch');
  const entries = Object.entries(metrics);
  const out = Object.fromEntries(entries.map(([key]) => [key, []]));
  if (!entries.length) return out;
  const client = new cw.CloudWatchClient(cfg);
  for (let offset = 0; offset < entries.length; offset += 500) {
    const batch = entries.slice(offset, offset + 500);
    let token;
    do {
      const response = await client.send(new cw.GetMetricDataCommand({
        StartTime: new Date(from), EndTime: new Date(to), ScanBy: 'TimestampAscending', NextToken: token,
        MetricDataQueries: batch.map(([, metric], i) => ({
          Id: `m${offset + i}`, ReturnData: true,
          MetricStat: { Metric: { Namespace: metric.namespace, MetricName: metric.metricName, Dimensions: metric.dimensions || [] }, Period: 3600, Stat: metric.stat || 'Sum' },
        })),
      }));
      for (const result of response.MetricDataResults || []) {
        const key = entries[Number(result.Id.slice(1))]?.[0];
        if (!key) continue;
        (result.Values || []).forEach((v, k) => out[key].push({ t: new Date(result.Timestamps[k]).getTime(), v }));
      }
      token = response.NextToken;
    } while (token);
  }
  return out;
}

/**
 * Hourly series of `metrics` ({ key: definition }) over the last `hours`.
 * With `history` + `historyKey` ({ profileId, region, resourceId }), metrics read
 * less than `ttlMs` ago come from history and only the others are requested.
 * `cache` reports how many metrics were requested (billed) and how many reused.
 */
async function metricSeries(cfg, metrics, { sdk = defaultSdk, now = Date.now(), hours = 24, history = null, historyKey = null, ttlMs = 15 * 60 * 1000 } = {}) {
  const { from, to } = hourWindow(now, hours);
  const keys = Object.keys(metrics);
  if (!history || !historyKey) {
    const raw = await requestSeries(cfg, sdk, metrics, from, to);
    const series = Object.fromEntries(keys.map(key => [key, fillHours(raw[key], metrics[key], from, to)]));
    return { windowHours: hours, series, cache: { requested: keys.length, reused: 0 } };
  }
  const item = key => ({ provider: 'aws', ...historyKey, metric: key, periodS: 3600 });
  const plan = history.plan({ series: keys.map(item), from, to, ttlMs });
  const staleKeys = plan.stale.map(s => s.metric);
  if (staleKeys.length) {
    const raw = await requestSeries(cfg, sdk, Object.fromEntries(staleKeys.map(key => [key, metrics[key]])), plan.fetchFrom, to);
    for (const key of staleKeys) history.write(item(key), { from: plan.fetchFrom, to, points: raw[key] });
  }
  const series = {};
  for (const key of keys) {
    const coverage = history.coverage(item(key));
    series[key] = fillHours(history.read(item(key), { from, to }), metrics[key], from, to, coverage ? Math.max(from, coverage.from) : to);
  }
  const oldest = keys.map(key => history.coverage(item(key))?.from).filter(Boolean);
  return {
    windowHours: hours,
    series,
    cache: { requested: staleKeys.length, reused: keys.length - staleKeys.length, historyFrom: oldest.length ? Math.max(...oldest) : null },
  };
}

function seriesTotals(series = {}) {
  return Object.fromEntries(Object.entries(series).map(([key, points]) => [key, Math.round(points.reduce((sum, p) => sum + (p.v || 0), 0))]));
}

/** Writes the hourly points `sumMetrics` read for every resource into history. */
function historyWriter(history, { profileId, region }, identityOf) {
  if (!history) return null;
  return (index, key, points, { from, to }) => {
    try {
      history.write({ provider: 'aws', profileId, region, resourceId: identityOf(index), metric: key, periodS: 3600 }, { from, to, points });
    } catch (err) { console.warn('[metric-history]', err.message); }
  };
}

// ── SQS ──────────────────────────────────────────────────────────────────────

function queueNameFromUrl(url = '') {
  return String(url).split('/').pop();
}

function parseRedrive(value) {
  const policy = parseJson(value);
  return policy ? { dlqArn: policy.deadLetterTargetArn || null, maxReceiveCount: toInt(policy.maxReceiveCount) } : null;
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
    const name = queueNameFromUrl(url);
    return {
      name,
      identity: resourceIdentity(CATALOG.sqs.kind, name),
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

/**
 * The client sends the queues it listed: names, or objects with the fields
 * health needs (dlqFor, hasDlq, visible, retentionSeconds).
 */
function validQueueNames(queues) {
  if (!Array.isArray(queues) || queues.length > 2000) return null;
  const out = [];
  for (const q of queues) {
    const item = typeof q === 'string' ? { name: q } : q;
    if (!item || typeof item.name !== 'string' || !QUEUE_NAME_RE.test(item.name)) return null;
    out.push({
      name: item.name,
      dlqFor: item.isDlq ? ['?'] : [],
      dlqArn: item.hasDlq ? 'configured' : null,
      visible: toInt(item.visible),
      retentionSeconds: toInt(item.retentionSeconds),
    });
  }
  return out;
}

/**
 * 24h sent/received/deleted per queue and its health. SQS writes no logs of
 * its own (API calls only reach CloudTrail as data events), so metrics are the
 * signal: CloudWatch stops publishing for queues idle for about 6 hours.
 */
async function sqsActivity(cfg, queues, { sdk = defaultSdk, now = Date.now(), history = null, profileId = '', region = '' } = {}) {
  const items = queues.map(q => (typeof q === 'string' ? { name: q, dlqFor: [] } : q));
  const cw = sdk('client-cloudwatch');
  const onSeries = historyWriter(history, { profileId, region }, i => resourceIdentity(CATALOG.sqs.kind, items[i].name));
  const metrics = await settle(sumMetrics(new cw.CloudWatchClient(cfg), cw, items, q => activityMetrics('sqs', q.name), now, { alignHours: true, onSeries }));
  const result = {};
  items.forEach((q, i) => {
    const activity = metrics.ok ? { sent: 0, received: 0, deleted: 0, ...metrics.value[i] } : null;
    result[q.name] = activity ? { ...activity, health: queueHealth(q, activity) } : null;
  });
  return { windowHours: 24, queues: result, metricsError: metrics.ok ? null : failure(metrics.error, 'POST /sqs/activity') };
}

function sqsQueueSeries(cfg, name, { profileId = '', region = '', ...options } = {}) {
  return metricSeries(cfg, metricsFor('sqs', name), {
    ...options, historyKey: { profileId, region, resourceId: resourceIdentity(CATALOG.sqs.kind, name) },
  });
}

function summarizePolicy(policy) {
  const statements = [].concat(policy?.Statement || []);
  return statements.map(s => ({
    sid: s.Sid || null,
    effect: s.Effect,
    principals: s.Principal === '*' ? ['*'] : Object.values(s.Principal || {}).flat(),
    actions: [].concat(s.Action || []),
    conditions: s.Condition ? Object.keys(s.Condition) : [],
  }));
}

/**
 * Detail of one queue: configuration, access policy, tags and who consumes it
 * (Lambda event source mappings) or feeds it (SNS subscriptions). Two billed
 * SQS requests (GetQueueAttributes, ListQueueTags); Lambda and SNS are free.
 */
async function sqsQueueDetails(cfg, url, { sdk = defaultSdk } = {}) {
  const sqs = sdk('client-sqs');
  const client = new sqs.SQSClient(cfg);
  const [attrs, tags] = await Promise.all([
    client.send(new sqs.GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['All'] })),
    settle(client.send(new sqs.ListQueueTagsCommand({ QueueUrl: url }))),
  ]);
  const a = attrs.Attributes || {};
  const arn = a.QueueArn;
  const lambda = sdk('client-lambda');
  const sns = sdk('client-sns');
  const [mappings, subscriptions] = await Promise.all([
    settle(paginate(input => new lambda.LambdaClient(cfg).send(new lambda.ListEventSourceMappingsCommand({ EventSourceArn: arn, ...input })), { items: 'EventSourceMappings', tokenIn: 'Marker', tokenOut: 'NextMarker' })),
    settle(paginate(input => new sns.SNSClient(cfg).send(new sns.ListSubscriptionsCommand(input)), { items: 'Subscriptions', tokenIn: 'NextToken', tokenOut: 'NextToken' })),
  ]);
  const redriveAllow = parseJson(a.RedriveAllowPolicy);
  return {
    arn,
    config: {
      receiveWaitSeconds: toInt(a.ReceiveMessageWaitTimeSeconds),
      delaySeconds: toInt(a.DelaySeconds),
      maxMessageBytes: toInt(a.MaximumMessageSize),
      visibilityTimeout: toInt(a.VisibilityTimeout),
      retentionSeconds: toInt(a.MessageRetentionPeriod),
      contentBasedDeduplication: a.ContentBasedDeduplication === 'true',
      fifoThroughputLimit: a.FifoThroughputLimit || null,
      deduplicationScope: a.DeduplicationScope || null,
      kmsKey: a.KmsMasterKeyId || null,
      lastModified: a.LastModifiedTimestamp ? Number(a.LastModifiedTimestamp) * 1000 : null,
    },
    redrive: parseRedrive(a.RedrivePolicy),
    redriveAllow: redriveAllow ? { permission: redriveAllow.redrivePermission, sources: redriveAllow.sourceQueueArns || [] } : null,
    policy: summarizePolicy(parseJson(a.Policy)),
    tags: tags.ok ? tags.value.Tags || {} : null,
    consumers: mappings.ok
      ? mappings.value.items.map(m => ({ function: String(m.FunctionArn || '').split(':').pop(), functionArn: m.FunctionArn, state: m.State, batchSize: m.BatchSize, maxConcurrency: m.ScalingConfig?.MaximumConcurrency ?? null, lastResult: m.LastProcessingResult || null }))
      : null,
    consumersError: mappings.ok ? null : failure(mappings.error, 'GET /sqs/:name/details'),
    producers: subscriptions.ok
      ? subscriptions.value.items.filter(s => s.Protocol === 'sqs' && s.Endpoint === arn).map(s => ({ topic: String(s.TopicArn).split(':').pop(), topicArn: s.TopicArn, pending: s.SubscriptionArn === 'PendingConfirmation' }))
      : null,
  };
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
    list.push({ arn: sub.SubscriptionArn, protocol: sub.Protocol, endpoint: sub.Endpoint, pending: sub.SubscriptionArn === 'PendingConfirmation' });
    subsByTopic.set(sub.TopicArn, list);
  }
  const rows = await mapWithConcurrency(topics.items, CONCURRENCY, async ({ TopicArn: arn }) => {
    const { Attributes: a = {} } = await client.send(new sns.GetTopicAttributesCommand({ TopicArn: arn }));
    const subs = subsByTopic.get(arn) || [];
    const name = topicNameFromArn(arn);
    return {
      name,
      identity: resourceIdentity(CATALOG.sns.kind, name),
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
    out.push({
      name: topic.name,
      logging: !!topic.logging,
      deliveryLogging: { enabled: !!topic.logging },
      subscriptionsConfirmed: toInt(topic.subscriptionsConfirmed) ?? 1,
      subscriptionsPending: toInt(topic.subscriptionsPending) ?? 0,
    });
  }
  return out;
}

async function snsLogGroups(logsClient, logs) {
  const found = new Map();
  let token;
  let pages = 0;
  do {
    const response = await logsClient.send(new logs.DescribeLogGroupsCommand({ logGroupNamePrefix: 'sns/', nextToken: token }));
    for (const group of response.logGroups || []) {
      const failureGroup = /\/Failure$/.test(group.logGroupName);
      const name = group.logGroupName.replace(/\/Failure$/, '').split('/').pop();
      const entry = found.get(name) || { storedBytes: 0, groups: [] };
      entry.storedBytes += group.storedBytes || 0;
      entry.groups.push({ name: group.logGroupName, kind: failureGroup ? 'failure' : 'success', storedBytes: group.storedBytes || 0, retentionInDays: group.retentionInDays ?? null });
      found.set(name, entry);
    }
    token = response.nextToken;
    pages += 1;
  } while (token && pages < MAX_PAGES);
  return found;
}

/**
 * 24h published/delivered/failed/filtered per topic, delivery success rate,
 * health, and the state of its delivery status log groups
 * (sns/<region>/<account>/<topic>[/Failure]).
 */
async function snsActivity(cfg, topics, { sdk = defaultSdk, now = Date.now(), history = null, profileId = '', region = '' } = {}) {
  const cw = sdk('client-cloudwatch');
  const logs = sdk('client-cloudwatch-logs');
  const onSeries = historyWriter(history, { profileId, region }, i => resourceIdentity(CATALOG.sns.kind, topics[i].name));
  const [metrics, groups] = await Promise.all([
    settle(sumMetrics(new cw.CloudWatchClient(cfg), cw, topics, topic => activityMetrics('sns', topic.name), now, { alignHours: true, onSeries })),
    settle(topics.some(topic => topic.logging) ? snsLogGroups(new logs.CloudWatchLogsClient(cfg), logs) : Promise.resolve(new Map())),
  ]);
  const result = {};
  topics.forEach((topic, i) => {
    const group = groups.ok ? groups.value.get(topic.name) : null;
    let logStatus = 'off';
    if (topic.logging) logStatus = !groups.ok ? 'unknown' : !group ? 'missing' : group.storedBytes > 0 ? 'ok' : 'empty';
    const messages = metrics.ok ? { published: 0, delivered: 0, failed: 0, filteredOut: 0, ...metrics.value[i] } : null;
    const attempts = messages ? messages.delivered + messages.failed : 0;
    result[topic.name] = {
      messages,
      successRate: attempts ? Math.round((messages.delivered / attempts) * 1000) / 10 : null,
      health: topicHealth(topic, messages),
      logStatus,
      logGroups: (group?.groups || []).map(g => g.name),
    };
  });
  return {
    windowHours: 24,
    topics: result,
    metricsError: metrics.ok ? null : failure(metrics.error, 'POST /sns/activity'),
    logsError: groups.ok ? null : failure(groups.error, 'POST /sns/activity'),
  };
}

function snsTopicSeries(cfg, name, { profileId = '', region = '', ...options } = {}) {
  return metricSeries(cfg, metricsFor('sns', name), {
    ...options, historyKey: { profileId, region, resourceId: resourceIdentity(CATALOG.sns.kind, name) },
  });
}

/**
 * Detail of one topic: access/delivery policies, tags and every subscription
 * with its filter policy, raw delivery and dead-letter queue (first 50).
 */
async function snsTopicDetails(cfg, arn, { sdk = defaultSdk } = {}) {
  const sns = sdk('client-sns');
  const client = new sns.SNSClient(cfg);
  const [attrs, subscriptions, tags] = await Promise.all([
    client.send(new sns.GetTopicAttributesCommand({ TopicArn: arn })),
    paginate(input => client.send(new sns.ListSubscriptionsByTopicCommand({ TopicArn: arn, ...input })), { items: 'Subscriptions', tokenIn: 'NextToken', tokenOut: 'NextToken' }),
    settle(client.send(new sns.ListTagsForResourceCommand({ ResourceArn: arn }))),
  ]);
  const a = attrs.Attributes || {};
  const detailed = subscriptions.items.slice(0, SUBSCRIPTION_DETAIL_LIMIT);
  const details = await mapWithConcurrency(detailed, CONCURRENCY, async sub => {
    if (sub.SubscriptionArn === 'PendingConfirmation') return null;
    const res = await settle(client.send(new sns.GetSubscriptionAttributesCommand({ SubscriptionArn: sub.SubscriptionArn })));
    return res.ok ? res.value.Attributes || {} : null;
  });
  return {
    arn,
    policy: summarizePolicy(parseJson(a.Policy)),
    deliveryPolicy: parseJson(a.EffectiveDeliveryPolicy || a.DeliveryPolicy),
    archivePolicy: parseJson(a.ArchivePolicy),
    contentBasedDeduplication: a.ContentBasedDeduplication === 'true',
    tags: tags.ok ? Object.fromEntries((tags.value.Tags || []).map(t => [t.Key, t.Value])) : null,
    subscriptions: subscriptions.items.map((sub, i) => {
      const d = details[i] || null;
      const redrive = parseJson(d?.RedrivePolicy);
      return {
        arn: sub.SubscriptionArn,
        protocol: sub.Protocol,
        endpoint: sub.Endpoint,
        pending: sub.SubscriptionArn === 'PendingConfirmation',
        filterPolicy: parseJson(d?.FilterPolicy),
        filterScope: d?.FilterPolicyScope || (d?.FilterPolicy ? 'MessageAttributes' : null),
        rawDelivery: d ? d.RawMessageDelivery === 'true' : null,
        dlqArn: redrive?.deadLetterTargetArn || null,
        detailLoaded: !!d,
      };
    }),
    subscriptionsTruncated: subscriptions.truncated || subscriptions.items.length > SUBSCRIPTION_DETAIL_LIMIT,
  };
}

function parseDeliveryEvent(event, kind) {
  const body = parseJson(event.message, {});
  const delivery = body.delivery || {};
  return {
    timestamp: event.timestamp,
    kind,
    status: body.status || (kind === 'failure' ? 'FAILURE' : 'SUCCESS'),
    messageId: body.notification?.messageId || null,
    destination: delivery.destination || null,
    statusCode: delivery.statusCode ?? null,
    providerResponse: delivery.providerResponse || null,
    dwellTimeMs: delivery.dwellTimeMs ?? null,
    attempts: delivery.attempts ?? null,
    raw: body.delivery ? null : String(event.message || '').slice(0, 500),
  };
}

/**
 * Latest delivery status log events of a topic (success and/or failure
 * groups) in the last `hours`, newest first. FilterLogEvents has no per-GB
 * charge; groups that do not exist are reported, not treated as errors.
 */
async function snsDeliveryLogs(cfg, arn, { sdk = defaultSdk, now = Date.now(), hours = 24, status = 'all', limit = 50 } = {}) {
  const [, , , region, account, topic] = String(arn).split(':');
  const logs = sdk('client-cloudwatch-logs');
  const client = new logs.CloudWatchLogsClient(cfg);
  const base = `sns/${region}/${account}/${topic}`;
  const groups = [
    ...(status === 'failure' ? [] : [{ name: base, kind: 'success' }]),
    { name: `${base}/Failure`, kind: 'failure' },
  ];
  const cap = Math.min(Number(limit) || 50, LOG_EVENT_LIMIT);
  const results = await Promise.all(groups.map(async group => {
    const res = await settle(client.send(new logs.FilterLogEventsCommand({ logGroupName: group.name, startTime: now - hours * HOUR_MS, endTime: now, limit: cap })));
    if (res.ok) return { ...group, exists: true, events: (res.value.events || []).map(e => parseDeliveryEvent(e, group.kind)) };
    if (res.error?.name === 'ResourceNotFoundException') return { ...group, exists: false, events: [] };
    return { ...group, exists: null, events: [], error: failure(res.error, 'GET /sns/:name/logs') };
  }));
  const events = results.flatMap(r => r.events).sort((x, y) => y.timestamp - x.timestamp).slice(0, cap);
  return {
    windowHours: hours,
    groups: results.map(({ events: list, ...rest }) => ({ ...rest, count: list.length })),
    events,
    counts: { success: events.filter(e => e.status === 'SUCCESS').length, failure: events.filter(e => e.status !== 'SUCCESS').length },
  };
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
  const dimensions = (dest.CloudWatchDestination?.DimensionConfigurations || []).map(d => ({ name: d.DimensionName, source: d.DimensionValueSource, default: d.DefaultDimensionValue }));
  return { name: dest.Name, type, enabled: dest.Enabled !== false, events: dest.MatchingEventTypes || [], target, dimensions };
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
      dkimOrigin: d?.DkimAttributes?.SigningAttributesOrigin || null,
      mailFrom: d?.MailFromAttributes?.MailFromDomain
        ? { domain: d.MailFromAttributes.MailFromDomain, status: d.MailFromAttributes.MailFromDomainStatus || null, onMxFailure: d.MailFromAttributes.BehaviorOnMxFailure || null }
        : null,
      feedbackForwarding: d ? d.FeedbackForwardingStatus !== false : null,
      policies: d?.Policies ? Object.keys(d.Policies) : [],
      configurationSet: d?.ConfigurationSetName || null,
      detailLoaded: !!d,
    };
  });
  const setRows = await mapWithConcurrency(sets.items, CONCURRENCY, async name => {
    const res = await settle(client.send(new ses.GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: name })));
    return { name, identity: resourceIdentity(SES_CONFIGURATION_SET, name), destinations: res.ok ? (res.value.EventDestinations || []).map(eventDestination) : null };
  });
  const a = account.ok ? account.value : null;
  const accountRow = a ? {
    sendingEnabled: a.SendingEnabled !== false,
    productionAccess: !!a.ProductionAccessEnabled,
    enforcementStatus: a.EnforcementStatus || null,
    max24HourSend: a.SendQuota?.Max24HourSend ?? null,
    maxSendRate: a.SendQuota?.MaxSendRate ?? null,
    sentLast24Hours: a.SendQuota?.SentLast24Hours ?? null,
    suppressedReasons: a.SuppressionAttributes?.SuppressedReasons || [],
    dedicatedIpAutoWarmup: a.DedicatedIpAutoWarmupEnabled ?? null,
  } : null;
  return {
    region: cfg.region || null,
    identity: resourceIdentity(CATALOG.ses.kind, cfg.region || ''),
    account: accountRow,
    accountError: account.ok ? null : failure(account.error, 'GET /ses'),
    health: sesHealth(accountRow),
    identities: identityRows,
    identitiesTruncated: identities.truncated || identities.items.length > SES_DETAIL_LIMIT,
    configurationSets: setRows,
    // Where SES events can be read: any enabled destination on a configuration set.
    eventLogging: setRows.some(set => (set.destinations || []).some(dest => dest.enabled)),
  };
}

/** Account-level SES metrics (SES publishes them to CloudWatch without setup), with history. */
function sesSeries(cfg, { profileId = '', ...options } = {}) {
  const region = cfg.region || '';
  return metricSeries(cfg, metricsFor('ses', null), {
    ...options, historyKey: { profileId, region, resourceId: resourceIdentity(CATALOG.ses.kind, region) },
  });
}

/** Latest hourly reputation rates (SES computes them over a rolling window). */
function latestRates(series = {}) {
  const last = points => {
    const values = (points || []).map(p => p.v).filter(Number.isFinite);
    return values.length ? values.at(-1) : null;
  };
  return { bounceRate: last(series.bounceRate), complaintRate: last(series.complaintRate) };
}

/** Account-level suppression list: addresses SES will not send to, and why. */
async function sesSuppression(cfg, { sdk = defaultSdk } = {}) {
  const ses = sdk('client-sesv2');
  const client = new ses.SESv2Client(cfg);
  const { items, truncated } = await paginate(
    input => client.send(new ses.ListSuppressedDestinationsCommand({ PageSize: 1000, ...input })),
    { items: 'SuppressedDestinationSummaries', tokenIn: 'NextToken', tokenOut: 'NextToken', maxPages: Math.ceil(SUPPRESSION_LIMIT / 1000) },
  );
  const rows = items.map(s => ({ email: s.EmailAddress, reason: s.Reason, updatedAt: s.LastUpdateTime ? new Date(s.LastUpdateTime).getTime() : null }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return {
    total: rows.length,
    truncated,
    byReason: { BOUNCE: rows.filter(r => r.reason === 'BOUNCE').length, COMPLAINT: rows.filter(r => r.reason === 'COMPLAINT').length },
    items: rows.slice(0, 200),
  };
}

/**
 * Event metrics of one configuration set, from its CloudWatch destination:
 * ListMetrics finds the event/dimension combinations that exist, and the first
 * SES_SET_METRIC_LIMIT are read. Without a CloudWatch destination nothing is
 * requested. `estimate: true` stops before GetMetricData and returns the count.
 */
async function sesConfigurationSetMetrics(cfg, name, { sdk = defaultSdk, estimate = false, profileId = '', ...options } = {}) {
  const ses = sdk('client-sesv2');
  const res = await new ses.SESv2Client(cfg).send(new ses.GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: name }));
  const destinations = (res.EventDestinations || []).map(eventDestination).filter(d => d.type === 'cloudwatch' && d.enabled);
  const dimensionNames = [...new Set(destinations.flatMap(d => d.dimensions.map(dim => dim.name)))];
  if (!dimensionNames.length) return { destinations, dimensionNames, metrics: [], truncated: false, series: {}, cache: { requested: 0, reused: 0 } };
  const cw = sdk('client-cloudwatch');
  const client = new cw.CloudWatchClient(cfg);
  const eventByMetric = Object.fromEntries(Object.entries(SES_EVENT_METRICS).map(([key, metricName]) => [metricName, key]));
  const found = [];
  for (const dimension of dimensionNames) {
    const { items } = await paginate(
      input => client.send(new cw.ListMetricsCommand({ Namespace: 'AWS/SES', Dimensions: [{ Name: dimension }], ...input })),
      { items: 'Metrics', tokenIn: 'NextToken', tokenOut: 'NextToken', maxPages: 5 },
    );
    for (const metric of items) {
      const event = eventByMetric[metric.MetricName];
      const dim = (metric.Dimensions || []).find(d => d.Name === dimension);
      if (!event || !dim || (metric.Dimensions || []).length !== 1) continue;
      found.push({ key: `${event}|${dimension}=${dim.Value}`, event, dimension, value: dim.Value, definition: { namespace: 'AWS/SES', metricName: metric.MetricName, dimensions: metric.Dimensions, stat: 'Sum' } });
    }
  }
  const selected = found.slice(0, SES_SET_METRIC_LIMIT);
  const base = { destinations, dimensionNames, metrics: selected.map(({ definition, ...rest }) => rest), truncated: found.length > selected.length };
  if (estimate) return { ...base, series: null, cache: null };
  const data = await metricSeries(cfg, Object.fromEntries(selected.map(m => [m.key, m.definition])), {
    ...options, sdk, historyKey: { profileId, region: cfg.region || '', resourceId: resourceIdentity(SES_CONFIGURATION_SET, name) },
  });
  return { ...base, ...data, totals: seriesTotals(data.series) };
}

module.exports = {
  QUEUE_NAME_RE,
  TOPIC_NAME_RE,
  QUEUE_URL_RE,
  TOPIC_ARN_RE,
  SET_NAME_RE,
  validHours,
  metricSeries,
  seriesTotals,
  listSqsQueues,
  validQueueNames,
  sqsActivity,
  sqsQueueSeries,
  sqsQueueDetails,
  summarizePolicy,
  listSnsTopics,
  validTopics,
  deliveryLogging,
  snsActivity,
  snsTopicSeries,
  snsTopicDetails,
  snsDeliveryLogs,
  parseDeliveryEvent,
  sesOverview,
  sesSeries,
  latestRates,
  sesSuppression,
  sesConfigurationSetMetrics,
  DAY_MS,
};
