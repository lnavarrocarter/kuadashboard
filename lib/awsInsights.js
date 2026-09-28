'use strict';

// Cost and usage insights for the AWS overview:
//   - costs: Cost Explorer (cached for 12h; each Cost Explorer request is
//     billed by AWS), with CloudWatch's EstimatedCharges as a fallback;
//   - usage: account-level Lambda activity from CloudWatch (last 24h);
//   - uncovered: services with cost, tagged resources or recent changes
//     that KUA does not manage yet (Cost Explorer + Tagging API + CloudTrail).
// Every section settles on its own so one missing permission never hides the rest.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyAwsError, buildAccessRequest } = require('./awsAccess');

const COST_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SECTION_TIMEOUT_MS = 15000;
const TAG_PAGES = 10;        // 100 resources per page
const TRAIL_PAGES = 4;       // 50 events per page
const TRAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Known AWS services. `key` matches the ARN / CloudTrail service prefix;
 * `ce` are Cost Explorer SERVICE names; `tab` is the KUA tab that manages it
 * (null = not in KUA); `partial` marks services KUA only uses indirectly.
 */
const SERVICE_CATALOG = [
  { key: 'ec2', label: 'EC2', ce: ['Amazon Elastic Compute Cloud - Compute', 'EC2 - Other'], tab: 'ec2' },
  { key: 'vpc', label: 'VPC', ce: ['Amazon Virtual Private Cloud'], tab: 'vpc' },
  { key: 'lambda', label: 'Lambda', ce: ['AWS Lambda'], tab: 'lambda' },
  { key: 'ecs', label: 'ECS', ce: ['Amazon Elastic Container Service'], tab: 'ecs' },
  { key: 'eks', label: 'EKS', ce: ['Amazon Elastic Container Service for Kubernetes'], tab: 'eks' },
  { key: 'ecr', label: 'ECR', ce: ['Amazon EC2 Container Registry (ECR)'], tab: 'ecr' },
  { key: 'apigateway', label: 'API Gateway', ce: ['Amazon API Gateway'], tab: 'apigw' },
  { key: 's3', label: 'S3', ce: ['Amazon Simple Storage Service'], tab: 's3' },
  { key: 'dynamodb', label: 'DynamoDB', ce: ['Amazon DynamoDB'], tab: 'dynamodb' },
  { key: 'rds', label: 'RDS', ce: ['Amazon Relational Database Service'], tab: 'rds' },
  { key: 'docdb', label: 'DocumentDB', ce: ['Amazon DocumentDB (with MongoDB compatibility)'], tab: 'rds' },
  { key: 'events', label: 'EventBridge', ce: ['Amazon EventBridge', 'CloudWatch Events'], tab: 'eventbridge' },
  { key: 'states', label: 'Step Functions', ce: ['AWS Step Functions'], tab: 'stepfn' },
  { key: 'cloudfront', label: 'CloudFront', ce: ['Amazon CloudFront'], tab: 'cloudfront' },
  { key: 'route53', label: 'Route 53', ce: ['Amazon Route 53'], tab: 'route53' },
  { key: 'cognito-idp', label: 'Cognito', ce: ['Amazon Cognito'], tab: 'cognito' },
  { key: 'secretsmanager', label: 'Secrets Manager', ce: ['AWS Secrets Manager'], tab: 'secrets' },
  { key: 'glue', label: 'Glue', ce: ['AWS Glue'], tab: 'glue' },
  { key: 'athena', label: 'Athena', ce: ['Amazon Athena'], tab: 'athena' },
  { key: 'datapipeline', label: 'Data Pipeline', ce: ['AWS Data Pipeline'], tab: 'datapipeline' },
  { key: 'bedrock', label: 'Bedrock', ce: ['Amazon Bedrock'], tab: 'bedrock' },
  { key: 'lex', label: 'Amazon Lex', ce: ['Amazon Lex'], tab: 'lex' },
  { key: 'cloudwatch', label: 'CloudWatch', ce: ['AmazonCloudWatch'], tab: null, partial: true },
  { key: 'logs', label: 'CloudWatch Logs', ce: [], tab: null, partial: true },
  { key: 'cloudformation', label: 'CloudFormation', ce: ['AWS CloudFormation'], tab: 'agentcorecfn', partial: true },
  { key: 'elasticloadbalancing', label: 'Elastic Load Balancing', ce: ['Amazon Elastic Load Balancing'], tab: null },
  { key: 'kms', label: 'KMS', ce: ['AWS Key Management Service'], tab: null },
  { key: 'kinesis', label: 'Kinesis', ce: ['Amazon Kinesis'], tab: null },
  { key: 'firehose', label: 'Data Firehose', ce: ['Amazon Kinesis Firehose'], tab: null },
  { key: 'quicksight', label: 'QuickSight', ce: ['Amazon QuickSight'], tab: null },
  { key: 'cloudtrail', label: 'CloudTrail', ce: ['AWS CloudTrail'], tab: null },
  { key: 'elasticache', label: 'ElastiCache', ce: ['Amazon ElastiCache'], tab: null },
  { key: 'sqs', label: 'SQS', ce: ['Amazon Simple Queue Service'], tab: null },
  { key: 'sns', label: 'SNS', ce: ['Amazon Simple Notification Service'], tab: null },
  { key: 'ses', label: 'SES', ce: ['Amazon Simple Email Service'], tab: null },
  { key: 'amplify', label: 'Amplify', ce: ['AWS Amplify'], tab: null },
  { key: 'timestream', label: 'Timestream', ce: ['Amazon Timestream'], tab: null },
  { key: 'xray', label: 'X-Ray', ce: ['AWS X-Ray'], tab: null },
  { key: 'ssm', label: 'Systems Manager', ce: ['AWS Systems Manager'], tab: null },
  { key: 'backup', label: 'AWS Backup', ce: ['AWS Backup'], tab: null },
  { key: 'servicediscovery', label: 'Cloud Map', ce: ['AWS Cloud Map'], tab: null },
  { key: 'kafka', label: 'MSK (Kafka)', ce: ['Amazon Managed Streaming for Apache Kafka'], tab: null },
  { key: 'es', label: 'OpenSearch', ce: ['Amazon OpenSearch Service'], tab: null },
  { key: 'redshift', label: 'Redshift', ce: ['Amazon Redshift'], tab: null },
  { key: 'sagemaker', label: 'SageMaker', ce: ['Amazon SageMaker'], tab: null },
  { key: 'elasticfilesystem', label: 'EFS', ce: ['Amazon Elastic File System'], tab: null },
  { key: 'wafv2', label: 'WAF', ce: ['AWS WAF'], tab: null },
  { key: 'acm', label: 'Certificate Manager', ce: ['AWS Certificate Manager'], tab: null },
  { key: 'ecr-public', label: 'ECR Public', ce: ['Amazon Elastic Container Registry Public'], tab: null },
  { key: 'cloudshell', label: 'CloudShell', ce: ['AWS CloudShell'], tab: null },
  { key: 'access-analyzer', label: 'IAM Access Analyzer', ce: [], tab: null },
  { key: 'budgets', label: 'Budgets', ce: ['AWS Budgets'], tab: null },
  { key: 'rbin', label: 'Recycle Bin', ce: [], tab: null },
  { key: 'resource-explorer-2', label: 'Resource Explorer', ce: [], tab: null },
];

// Not services to manage: taxes, billing tools, identity plumbing.
const IGNORED_CE = new Set(['Tax', 'AWS Cost Explorer', 'Refund', 'Credit']);
const IGNORED_KEYS = new Set(['iam', 'sts', 'signin', 'sso', 'ce', 'payments', 'health', 'organizations', 'support', 'billing', 'tagging', 'resource-groups']);

const BY_CE = new Map(SERVICE_CATALOG.flatMap(s => s.ce.map(name => [name, s])));
const BY_KEY = new Map(SERVICE_CATALOG.map(s => [s.key, s]));

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Resolves a Cost Explorer service name to a catalog entry (or an ad-hoc one). */
function serviceFromCostName(name) {
  if (IGNORED_CE.has(name) || name.startsWith('AWS Support')) return null;
  return BY_CE.get(name) || { key: `ce:${slug(name)}`, label: name, tab: null, marketplace: !/^(Amazon|AWS)\b/.test(name) };
}

function serviceFromKey(key) {
  if (!key || IGNORED_KEYS.has(key)) return null;
  return BY_KEY.get(key) || { key, label: key, tab: null };
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/** UTC windows Cost Explorer needs: last month + month to date, and the forecast range. */
function costWindows(now = Date.now()) {
  const today = new Date(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const day = Date.UTC(y, m, today.getUTCDate());
  return {
    usage: { Start: isoDay(new Date(Date.UTC(y, m - 1, 1))), End: isoDay(new Date(day + 86400000)) },
    forecast: { Start: isoDay(new Date(day)), End: isoDay(new Date(Date.UTC(y, m + 1, 1))) },
    monthStart: isoDay(new Date(Date.UTC(y, m, 1))),
  };
}

/** Turns a GetCostAndUsage response (2 monthly periods, grouped by SERVICE) into totals per service. */
function summarizeCostResponse(response, monthStart) {
  const periods = response.ResultsByTime || [];
  const current = periods.find(p => p.TimePeriod?.Start === monthStart) || periods.at(-1) || {};
  const previous = periods.find(p => p !== current) || {};
  const amounts = new Map();
  let currency = 'USD';
  const add = (period, field) => {
    for (const group of period.Groups || []) {
      const name = group.Keys?.[0];
      const metric = group.Metrics?.UnblendedCost;
      if (!name || !metric) continue;
      currency = metric.Unit || currency;
      const entry = amounts.get(name) || { name, monthToDate: 0, lastMonth: 0 };
      entry[field] += Number(metric.Amount) || 0;
      amounts.set(name, entry);
    }
  };
  add(current, 'monthToDate');
  add(previous, 'lastMonth');
  const byService = [...amounts.values()]
    .map(entry => {
      const service = serviceFromCostName(entry.name);
      return service && {
        name: entry.name, key: service.key, label: service.label, tab: service.tab,
        partial: !!service.partial, marketplace: !!service.marketplace,
        monthToDate: round2(entry.monthToDate), lastMonth: round2(entry.lastMonth),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.monthToDate - a.monthToDate || b.lastMonth - a.lastMonth);
  return {
    currency,
    estimated: !!current.Estimated,
    monthToDate: round2(byService.reduce((sum, s) => sum + s.monthToDate, 0)),
    lastMonth: round2(byService.reduce((sum, s) => sum + s.lastMonth, 0)),
    byService,
  };
}

// ── Cost cache (persisted, so app restarts do not pay for Cost Explorer again) ──

function defaultCacheFile() {
  return path.join(process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard'), 'aws-cost-cache.json');
}

function createCostCache({ file = defaultCacheFile(), ttlMs = COST_CACHE_TTL_MS, fileSystem = fs } = {}) {
  const read = () => {
    try { return JSON.parse(fileSystem.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
  };
  return {
    ttlMs,
    get(key, now = Date.now()) {
      const entry = read()[key];
      return entry && now - entry.fetchedAt < ttlMs ? entry : null;
    },
    set(key, data, now = Date.now()) {
      const all = read();
      all[key] = { fetchedAt: now, data };
      try {
        fileSystem.mkdirSync(path.dirname(file), { recursive: true });
        fileSystem.writeFileSync(file, JSON.stringify(all), { mode: 0o600 });
      } catch { /* cache is best-effort */ }
      return all[key];
    },
  };
}

function withTimeout(promise, ms = SECTION_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`No response after ${Math.round(ms / 1000)}s`), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function settle(promise) {
  try { return { ok: true, value: await promise }; } catch (error) { return { ok: false, error }; }
}

function failure(error, route = null) {
  const classified = classifyAwsError(error);
  const access = buildAccessRequest({ error: classified, route, catalog: {} });
  return { status: 'unavailable', error: classified, ...(access ? { access } : {}) };
}

// Cost Explorer only answers in us-east-1.
async function fetchCostExplorer(sdk, cfg, now) {
  const { CostExplorerClient, GetCostAndUsageCommand, GetCostForecastCommand } = sdk('client-cost-explorer');
  const client = new CostExplorerClient({ ...cfg, region: 'us-east-1' });
  const windows = costWindows(now);
  const usage = await client.send(new GetCostAndUsageCommand({
    TimePeriod: windows.usage, Granularity: 'MONTHLY', Metrics: ['UnblendedCost'],
    GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
  }));
  const summary = summarizeCostResponse(usage, windows.monthStart);
  const forecast = await settle(client.send(new GetCostForecastCommand({ TimePeriod: windows.forecast, Metric: 'UNBLENDED_COST', Granularity: 'MONTHLY' })));
  // With MONTHLY granularity AWS returns the whole month's forecast (spent + remaining).
  summary.forecast = forecast.ok
    ? { monthEnd: round2(Math.max(Number(forecast.value.Total?.Amount || 0), summary.monthToDate)) }
    : { monthEnd: null, error: classifyAwsError(forecast.error) };
  return { status: 'ok', source: 'cost-explorer', ...summary };
}

/** Free fallback: the account's EstimatedCharges metric (only if billing alerts are enabled). */
async function fetchBillingMetric(sdk, cfg, now) {
  const { CloudWatchClient, GetMetricStatisticsCommand } = sdk('client-cloudwatch');
  const response = await new CloudWatchClient({ ...cfg, region: 'us-east-1' }).send(new GetMetricStatisticsCommand({
    Namespace: 'AWS/Billing', MetricName: 'EstimatedCharges', Dimensions: [{ Name: 'Currency', Value: 'USD' }],
    StartTime: new Date(now - 2 * 86400000), EndTime: new Date(now), Period: 21600, Statistics: ['Maximum'],
  }));
  const latest = (response.Datapoints || []).sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))[0];
  if (!latest) throw Object.assign(new Error('No EstimatedCharges data: enable "Receive Billing Alerts" in the Billing console'), { name: 'NoBillingMetric' });
  return { status: 'ok', source: 'cloudwatch-billing', currency: 'USD', estimated: true, monthToDate: round2(latest.Maximum), lastMonth: null, forecast: { monthEnd: null }, byService: [] };
}

/**
 * Costs from the cache when fresh (no Cost Explorer charge), otherwise from
 * Cost Explorer; only successful Cost Explorer results are cached.
 */
async function loadCosts(sdk, cfg, { cache, cacheKey, refresh = false, now = Date.now() }) {
  const cached = !refresh && cache?.get(cacheKey, now);
  if (cached) return { ...cached.data, fetchedAt: cached.fetchedAt, cachedUntil: cached.fetchedAt + cache.ttlMs, fromCache: true };
  const explorer = await settle(withTimeout(fetchCostExplorer(sdk, cfg, now)));
  if (explorer.ok) {
    const entry = cache ? cache.set(cacheKey, explorer.value, now) : { fetchedAt: now };
    return { ...explorer.value, fetchedAt: entry.fetchedAt, cachedUntil: entry.fetchedAt + (cache?.ttlMs || 0), fromCache: false };
  }
  const explorerFailure = failure(explorer.error);
  const billing = await settle(withTimeout(fetchBillingMetric(sdk, cfg, now)));
  if (billing.ok) return { ...billing.value, fetchedAt: now, explorer: explorerFailure };
  return { ...explorerFailure, fallback: classifyAwsError(billing.error) };
}

/** Account-level Lambda activity (no dimensions) for the last 24h, per hour. */
async function loadLambdaUsage(sdk, cfg, now = Date.now()) {
  const { CloudWatchClient, GetMetricDataCommand } = sdk('client-cloudwatch');
  const metric = (id, name) => ({ Id: id, MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: name }, Period: 3600, Stat: 'Sum' }, ReturnData: true });
  const response = await new CloudWatchClient(cfg).send(new GetMetricDataCommand({
    StartTime: new Date(now - 86400000), EndTime: new Date(now), ScanBy: 'TimestampAscending',
    MetricDataQueries: [metric('invocations', 'Invocations'), metric('errors', 'Errors'), metric('throttles', 'Throttles')],
  }));
  const series = {};
  for (const result of response.MetricDataResults || []) {
    series[result.Id] = (result.Timestamps || []).map((t, i) => ({ t: new Date(t).getTime(), v: result.Values[i] })).sort((a, b) => a.t - b.t);
  }
  const total = id => Math.round((series[id] || []).reduce((sum, p) => sum + p.v, 0));
  const invocations = total('invocations');
  const errors = total('errors');
  return {
    status: 'ok', windowHours: 24, invocations, errors, throttles: total('throttles'),
    errorRate: invocations ? Math.round((errors / invocations) * 10000) / 100 : 0,
    series: { invocations: series.invocations || [], errors: series.errors || [] },
  };
}

/** Counts tagged resources per service prefix (arn:partition:SERVICE:…). */
async function loadTaggedResources(sdk, cfg) {
  const { ResourceGroupsTaggingAPIClient, GetResourcesCommand } = sdk('client-resource-groups-tagging-api');
  const client = new ResourceGroupsTaggingAPIClient(cfg);
  const counts = {};
  let token;
  let total = 0;
  for (let page = 0; page < TAG_PAGES; page += 1) {
    const response = await client.send(new GetResourcesCommand({ ResourcesPerPage: 100, ...(token ? { PaginationToken: token } : {}) }));
    for (const mapping of response.ResourceTagMappingList || []) {
      const key = String(mapping.ResourceARN || '').split(':')[2];
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
      total += 1;
    }
    token = response.PaginationToken;
    if (!token) return { status: 'ok', total, counts, truncated: false };
  }
  return { status: 'ok', total, counts, truncated: true };
}

/**
 * Write events (ReadOnly=false) from CloudTrail in the last 24h, per service.
 * Read-only events are excluded so KUA's own List/Describe calls do not count.
 */
async function loadRecentChanges(sdk, cfg, now = Date.now()) {
  const { CloudTrailClient, LookupEventsCommand } = sdk('client-cloudtrail');
  const client = new CloudTrailClient(cfg);
  const EndTime = new Date(now);
  const StartTime = new Date(now - TRAIL_WINDOW_MS);
  const counts = {};
  let token;
  let total = 0;
  for (let page = 0; page < TRAIL_PAGES; page += 1) {
    const response = await client.send(new LookupEventsCommand({
      StartTime, EndTime, MaxResults: 50, ...(token ? { NextToken: token } : {}),
      LookupAttributes: [{ AttributeKey: 'ReadOnly', AttributeValue: 'false' }],
    }));
    for (const event of response.Events || []) {
      const key = String(event.EventSource || '').replace(/\.amazonaws\.com$/, '');
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
      total += 1;
    }
    token = response.NextToken;
    if (!token) return { status: 'ok', windowHours: 24, total, counts, truncated: false };
  }
  return { status: 'ok', windowHours: 24, total, counts, truncated: true };
}

/**
 * Services with signs of use (cost this or last month, tagged resources or
 * recent changes) that KUA does not manage. Partly-used services (e.g.
 * CloudWatch) are flagged instead of hidden.
 */
function findUncoveredServices({ costs, tags, trail }) {
  const merged = new Map();
  const entry = service => {
    if (!merged.has(service.key)) {
      merged.set(service.key, { key: service.key, label: service.label, partial: !!service.partial, marketplace: !!service.marketplace, cost: 0, lastMonthCost: 0, taggedResources: 0, recentChanges: 0, sources: [] });
    }
    return merged.get(service.key);
  };
  const addSource = (item, source) => { if (!item.sources.includes(source)) item.sources.push(source); };
  for (const cost of costs?.byService || []) {
    if (cost.tab && !cost.partial) continue;
    if (cost.monthToDate < 0.01 && cost.lastMonth < 0.01) continue;
    const item = entry(cost);
    item.cost = round2(item.cost + cost.monthToDate);
    item.lastMonthCost = round2(item.lastMonthCost + cost.lastMonth);
    addSource(item, 'cost');
  }
  for (const [key, count] of Object.entries(tags?.counts || {})) {
    const service = serviceFromKey(key);
    if (!service || (service.tab && !service.partial)) continue;
    const item = entry(service);
    item.taggedResources += count;
    addSource(item, 'tags');
  }
  for (const [key, count] of Object.entries(trail?.counts || {})) {
    const service = serviceFromKey(key);
    if (!service || (service.tab && !service.partial)) continue;
    const item = entry(service);
    item.recentChanges += count;
    addSource(item, 'cloudtrail');
  }
  return [...merged.values()].sort((a, b) =>
    Number(a.partial) - Number(b.partial)
    || (b.cost || b.lastMonthCost) - (a.cost || a.lastMonthCost)
    || b.taggedResources - a.taggedResources
    || b.recentChanges - a.recentChanges
    || a.label.localeCompare(b.label));
}

function defaultSdk(pkg) {
  return require(`@aws-sdk/${pkg}`);
}

async function buildAwsInsights(cfg, { sdk = defaultSdk, cache = createCostCache(), cacheKey = 'default', refreshCosts = false, now = Date.now() } = {}) {
  const section = async (promise, route) => {
    const result = await settle(withTimeout(promise));
    return result.ok ? result.value : failure(result.error, route);
  };
  const [costs, usage, tags, trail] = await Promise.all([
    loadCosts(sdk, cfg, { cache, cacheKey, refresh: refreshCosts, now }),
    section(loadLambdaUsage(sdk, cfg, now)),
    section(loadTaggedResources(sdk, cfg)),
    section(loadRecentChanges(sdk, cfg, now)),
  ]);
  return {
    generatedAt: new Date(now).toISOString(),
    costs,
    usage: { lambda: usage },
    uncovered: {
      services: findUncoveredServices({ costs, tags, trail }),
      sources: {
        costs: { status: costs.status, source: costs.source || null },
        tags: tags.status === 'ok' ? { status: 'ok', total: tags.total, truncated: tags.truncated } : tags,
        cloudtrail: trail.status === 'ok' ? { status: 'ok', windowHours: trail.windowHours, total: trail.total, truncated: trail.truncated } : trail,
      },
    },
  };
}

module.exports = {
  SERVICE_CATALOG,
  COST_CACHE_TTL_MS,
  costWindows,
  summarizeCostResponse,
  createCostCache,
  loadCosts,
  findUncoveredServices,
  buildAwsInsights,
};
