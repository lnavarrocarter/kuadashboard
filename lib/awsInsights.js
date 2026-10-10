'use strict';

// Cost and usage insights for the AWS overview:
//   - costs: Cost Explorer (cached for 12h; each Cost Explorer request is
//     billed by AWS), with CloudWatch's EstimatedCharges as a fallback;
//   - usage: last-24h activity per service (Lambda, EC2, load balancers, EKS
//     with Container Insights, RDS, DynamoDB, Step Functions, EventBridge,
//     CloudFront, daily S3 storage) from CloudWatch, and
//     Glue job runs from the Glue API;
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
  { key: 'elasticloadbalancing', label: 'Elastic Load Balancing', ce: ['Amazon Elastic Load Balancing'], tab: 'elb' },
  { key: 'route53', label: 'Route 53', ce: ['Amazon Route 53'], tab: 'route53' },
  { key: 'cognito-idp', label: 'Cognito', ce: ['Amazon Cognito'], tab: 'cognito' },
  { key: 'secretsmanager', label: 'Secrets Manager', ce: ['AWS Secrets Manager'], tab: 'secrets' },
  { key: 'glue', label: 'Glue', ce: ['AWS Glue'], tab: 'glue' },
  { key: 'athena', label: 'Athena', ce: ['Amazon Athena'], tab: 'athena' },
  { key: 'datapipeline', label: 'Data Pipeline', ce: ['AWS Data Pipeline'], tab: 'datapipeline' },
  { key: 'bedrock', label: 'Bedrock', ce: ['Amazon Bedrock'], tab: 'bedrock' },
  { key: 'lex', label: 'Amazon Lex', ce: ['Amazon Lex'], tab: 'lex' },
  // CloudWatch: dashboards only; alarms and a metrics explorer are still missing.
  { key: 'cloudwatch', label: 'CloudWatch', ce: ['AmazonCloudWatch'], tab: 'cwdashboards', partial: true },
  { key: 'logs', label: 'CloudWatch Logs', ce: [], tab: 'cwlogs' },
  { key: 'cloudformation', label: 'CloudFormation', ce: ['AWS CloudFormation'], tab: 'cloudformation' },
  { key: 'kms', label: 'KMS', ce: ['AWS Key Management Service'], tab: null },
  { key: 'kinesis', label: 'Kinesis', ce: ['Amazon Kinesis'], tab: null },
  { key: 'firehose', label: 'Data Firehose', ce: ['Amazon Kinesis Firehose'], tab: null },
  { key: 'quicksight', label: 'QuickSight', ce: ['Amazon QuickSight'], tab: null },
  { key: 'cloudtrail', label: 'CloudTrail', ce: ['AWS CloudTrail'], tab: null },
  { key: 'elasticache', label: 'ElastiCache', ce: ['Amazon ElastiCache'], tab: null },
  { key: 'sqs', label: 'SQS', ce: ['Amazon Simple Queue Service'], tab: 'sqs' },
  { key: 'sns', label: 'SNS', ce: ['Amazon Simple Notification Service'], tab: 'sns' },
  { key: 'ses', label: 'SES', ce: ['Amazon Simple Email Service'], tab: 'ses' },
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
    // `ttl` overrides the default per call (the user picks it in Options).
    get(key, now = Date.now(), ttl = ttlMs) {
      const entry = read()[key];
      return entry && now - entry.fetchedAt < ttl ? entry : null;
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
async function loadCosts(sdk, cfg, { cache, cacheKey, refresh = false, now = Date.now(), ttlMs = cache?.ttlMs || 0 }) {
  const cached = !refresh && cache?.get(cacheKey, now, ttlMs);
  if (cached) return { ...cached.data, fetchedAt: cached.fetchedAt, cachedUntil: cached.fetchedAt + ttlMs, fromCache: true };
  const explorer = await settle(withTimeout(fetchCostExplorer(sdk, cfg, now)));
  if (explorer.ok) {
    const entry = cache ? cache.set(cacheKey, explorer.value, now) : { fetchedAt: now };
    return { ...explorer.value, fetchedAt: entry.fetchedAt, cachedUntil: entry.fetchedAt + ttlMs, fromCache: false };
  }
  const explorerFailure = failure(explorer.error);
  const billing = await settle(withTimeout(fetchBillingMetric(sdk, cfg, now)));
  if (billing.ok) return { ...billing.value, fetchedAt: now, explorer: explorerFailure };
  return { ...explorerFailure, fallback: classifyAwsError(billing.error) };
}

const HOUR_S = 3600;
const DAY_S = 86400;
const GLUE_MAX_JOBS = 200;
const GLUE_RUNS_PER_JOB = 25;
const GLUE_CONCURRENCY = 8;

// CloudWatch SEARCH aggregates every resource of a kind in one query
// (e.g. all instances), so the overview needs no per-resource calls.
function search(namespace, dimensions, metric, stat, period, filter = '') {
  return `SEARCH('{${namespace},${dimensions}} MetricName="${metric}"${filter}', '${stat}', ${period})`;
}
const expression = (Id, Expression) => ({ Id, Expression, ReturnData: true });
const lambdaMetric = (Id, name) => ({ Id, MetricStat: { Metric: { Namespace: 'AWS/Lambda', MetricName: name }, Period: HOUR_S, Stat: 'Sum' }, ReturnData: true });

const HOURLY_QUERIES = [
  lambdaMetric('lambdaInvocations', 'Invocations'),
  lambdaMetric('lambdaErrors', 'Errors'),
  lambdaMetric('lambdaThrottles', 'Throttles'),
  expression('ec2CpuAvg', `AVG(${search('AWS/EC2', 'InstanceId', 'CPUUtilization', 'Average', HOUR_S)})`),
  expression('ec2CpuMax', `MAX(${search('AWS/EC2', 'InstanceId', 'CPUUtilization', 'Maximum', HOUR_S)})`),
  expression('albRequests', `SUM(${search('AWS/ApplicationELB', 'LoadBalancer', 'RequestCount', 'Sum', HOUR_S)})`),
  expression('albTarget5xx', `SUM(${search('AWS/ApplicationELB', 'LoadBalancer', 'HTTPCode_Target_5XX_Count', 'Sum', HOUR_S)})`),
  expression('albElb5xx', `SUM(${search('AWS/ApplicationELB', 'LoadBalancer', 'HTTPCode_ELB_5XX_Count', 'Sum', HOUR_S)})`),
  expression('albLatency', `AVG(${search('AWS/ApplicationELB', 'LoadBalancer', 'TargetResponseTime', 'Average', HOUR_S)})`),
  expression('nlbBytes', `SUM(${search('AWS/NetworkELB', 'LoadBalancer', 'ProcessedBytes', 'Sum', HOUR_S)})`),
  expression('eksCpu', `AVG(${search('ContainerInsights', 'ClusterName', 'node_cpu_utilization', 'Average', HOUR_S)})`),
  expression('eksMemory', `AVG(${search('ContainerInsights', 'ClusterName', 'node_memory_utilization', 'Average', HOUR_S)})`),
  expression('eksNodes', `SUM(${search('ContainerInsights', 'ClusterName', 'cluster_node_count', 'Average', HOUR_S)})`),
  expression('eksFailedNodes', `SUM(${search('ContainerInsights', 'ClusterName', 'cluster_failed_node_count', 'Average', HOUR_S)})`),
  expression('rdsCpu', `AVG(${search('AWS/RDS', 'DBInstanceIdentifier', 'CPUUtilization', 'Average', HOUR_S)})`),
  expression('rdsCpuMax', `MAX(${search('AWS/RDS', 'DBInstanceIdentifier', 'CPUUtilization', 'Maximum', HOUR_S)})`),
  expression('rdsConnections', `SUM(${search('AWS/RDS', 'DBInstanceIdentifier', 'DatabaseConnections', 'Average', HOUR_S)})`),
  expression('rdsFreeStorage', `MIN(${search('AWS/RDS', 'DBInstanceIdentifier', 'FreeStorageSpace', 'Minimum', HOUR_S)})`),
  expression('ddbRead', `SUM(${search('AWS/DynamoDB', 'TableName', 'ConsumedReadCapacityUnits', 'Sum', HOUR_S)})`),
  expression('ddbWrite', `SUM(${search('AWS/DynamoDB', 'TableName', 'ConsumedWriteCapacityUnits', 'Sum', HOUR_S)})`),
  expression('ddbThrottled', `SUM(${search('AWS/DynamoDB', 'TableName,Operation', 'ThrottledRequests', 'Sum', HOUR_S)})`),
  expression('ddbSystemErrors', `SUM(${search('AWS/DynamoDB', 'TableName,Operation', 'SystemErrors', 'Sum', HOUR_S)})`),
  expression('ddbLatency', `AVG(${search('AWS/DynamoDB', 'TableName,Operation', 'SuccessfulRequestLatency', 'Average', HOUR_S)})`),
  expression('sfnStarted', `SUM(${search('AWS/States', 'StateMachineArn', 'ExecutionsStarted', 'Sum', HOUR_S)})`),
  expression('sfnSucceeded', `SUM(${search('AWS/States', 'StateMachineArn', 'ExecutionsSucceeded', 'Sum', HOUR_S)})`),
  expression('sfnFailed', `SUM(${search('AWS/States', 'StateMachineArn', 'ExecutionsFailed', 'Sum', HOUR_S)})`),
  expression('sfnTimedOut', `SUM(${search('AWS/States', 'StateMachineArn', 'ExecutionsTimedOut', 'Sum', HOUR_S)})`),
  expression('sfnAborted', `SUM(${search('AWS/States', 'StateMachineArn', 'ExecutionsAborted', 'Sum', HOUR_S)})`),
  expression('sfnDuration', `AVG(${search('AWS/States', 'StateMachineArn', 'ExecutionTime', 'Average', HOUR_S)})`),
  // Default-bus rules report {RuleName}; custom-bus rules {EventBusName,RuleName}. Exact schemas avoid double counting.
  expression('evInvocations', `SUM(${search('AWS/Events', 'RuleName', 'Invocations', 'Sum', HOUR_S)})`),
  expression('evInvocationsBus', `SUM(${search('AWS/Events', 'EventBusName,RuleName', 'Invocations', 'Sum', HOUR_S)})`),
  expression('evFailed', `SUM(${search('AWS/Events', 'RuleName', 'FailedInvocations', 'Sum', HOUR_S)})`),
  expression('evFailedBus', `SUM(${search('AWS/Events', 'EventBusName,RuleName', 'FailedInvocations', 'Sum', HOUR_S)})`),
  expression('evMatched', `SUM(${search('AWS/Events', 'RuleName', 'MatchedEvents', 'Sum', HOUR_S)})`),
  expression('evMatchedBus', `SUM(${search('AWS/Events', 'EventBusName,RuleName', 'MatchedEvents', 'Sum', HOUR_S)})`),
];

// CloudFront publishes its metrics only in us-east-1.
const CLOUDFRONT_QUERIES = [
  expression('cfRequests', `SUM(${search('AWS/CloudFront', 'DistributionId,Region', 'Requests', 'Sum', HOUR_S)})`),
  expression('cfBytes', `SUM(${search('AWS/CloudFront', 'DistributionId,Region', 'BytesDownloaded', 'Sum', HOUR_S)})`),
  expression('cf4xx', `AVG(${search('AWS/CloudFront', 'DistributionId,Region', '4xxErrorRate', 'Average', HOUR_S)})`),
  expression('cf5xx', `AVG(${search('AWS/CloudFront', 'DistributionId,Region', '5xxErrorRate', 'Average', HOUR_S)})`),
];

// S3 storage metrics are daily and only exist for buckets in the queried region.
const DAILY_QUERIES = [
  expression('s3Bytes', `SUM(${search('AWS/S3', 'BucketName,StorageType', 'BucketSizeBytes', 'Average', DAY_S)})`),
  expression('s3Objects', `SUM(${search('AWS/S3', 'BucketName,StorageType', 'NumberOfObjects', 'Average', DAY_S, ' StorageType="AllStorageTypes"')})`),
];

function seriesById(response) {
  const series = {};
  for (const result of response.MetricDataResults || []) {
    series[result.Id] = (result.Timestamps || [])
      .map((t, i) => ({ t: new Date(t).getTime(), v: result.Values[i] }))
      .filter(point => Number.isFinite(point.v))
      .sort((a, b) => a.t - b.t);
  }
  return series;
}

const sum = points => (points || []).reduce((total, p) => total + p.v, 0);
const avg = points => (points?.length ? sum(points) / points.length : null);
const max = points => (points?.length ? Math.max(...points.map(p => p.v)) : null);
const last = points => (points?.length ? points.at(-1).v : null);
const round = (value, digits = 0) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

/**
 * Turns the CloudWatch series into one KPI block per service. `present` is
 * false when the account has no data for that service (the card is hidden).
 */
function summarizeActivity(hourly = {}, daily = {}) {
  const invocations = Math.round(sum(hourly.lambdaInvocations));
  const lambdaErrors = Math.round(sum(hourly.lambdaErrors));
  const albRequests = Math.round(sum(hourly.albRequests));
  const target5xx = Math.round(sum(hourly.albTarget5xx));
  const elb5xx = Math.round(target5xx + sum(hourly.albElb5xx));
  return {
    lambda: {
      present: (hourly.lambdaInvocations || []).length > 0,
      invocations, errors: lambdaErrors, throttles: Math.round(sum(hourly.lambdaThrottles)),
      errorRate: invocations ? round((lambdaErrors / invocations) * 100, 2) : 0,
      series: hourly.lambdaInvocations || [],
    },
    ec2: {
      present: (hourly.ec2CpuAvg || []).length > 0,
      cpuAvg: round(avg(hourly.ec2CpuAvg), 1), cpuPeak: round(max(hourly.ec2CpuMax), 1), cpuNow: round(last(hourly.ec2CpuAvg), 1),
      series: hourly.ec2CpuAvg || [],
    },
    elb: {
      present: (hourly.albRequests || []).length > 0 || (hourly.nlbBytes || []).length > 0 || elb5xx > 0,
      requests: albRequests,
      errors5xx: elb5xx,
      elbGenerated5xx: Math.round(sum(hourly.albElb5xx)),
      target5xx,
      // RequestCount only counts requests for which the load balancer chose a target, so
      // only target 5xx share its population; 5xx the load balancer generated are a count.
      targetErrorRate: albRequests ? round((target5xx / albRequests) * 100, 2) : null,
      latencyMs: hourly.albLatency?.length ? round(avg(hourly.albLatency) * 1000, 0) : null,
      nlbBytes: (hourly.nlbBytes || []).length ? Math.round(sum(hourly.nlbBytes)) : null,
      series: hourly.albRequests || [],
    },
    s3: {
      present: (daily.s3Bytes || []).length > 0,
      bytes: last(daily.s3Bytes) === null ? null : Math.round(last(daily.s3Bytes)),
      objects: last(daily.s3Objects) === null ? null : Math.round(last(daily.s3Objects)),
      asOf: daily.s3Bytes?.length ? daily.s3Bytes.at(-1).t : null,
    },
    rds: {
      present: (hourly.rdsCpu || []).length > 0,
      cpuAvg: round(avg(hourly.rdsCpu), 1), cpuPeak: round(max(hourly.rdsCpuMax), 1),
      connections: last(hourly.rdsConnections) === null ? null : Math.round(last(hourly.rdsConnections)),
      freeStorageMin: last(hourly.rdsFreeStorage) === null ? null : Math.round(last(hourly.rdsFreeStorage)),
      series: hourly.rdsCpu || [],
    },
    dynamodb: {
      present: (hourly.ddbRead || []).length > 0 || (hourly.ddbWrite || []).length > 0,
      readUnits: Math.round(sum(hourly.ddbRead)), writeUnits: Math.round(sum(hourly.ddbWrite)),
      throttled: Math.round(sum(hourly.ddbThrottled)), systemErrors: Math.round(sum(hourly.ddbSystemErrors)),
      latencyMs: hourly.ddbLatency?.length ? round(avg(hourly.ddbLatency), 2) : null,
      series: hourly.ddbRead || [],
    },
    stepfn: {
      present: (hourly.sfnStarted || []).length > 0,
      started: Math.round(sum(hourly.sfnStarted)), succeeded: Math.round(sum(hourly.sfnSucceeded)),
      failed: Math.round(sum(hourly.sfnFailed)), timedOut: Math.round(sum(hourly.sfnTimedOut)), aborted: Math.round(sum(hourly.sfnAborted)),
      avgDurationMs: hourly.sfnDuration?.length ? Math.round(avg(hourly.sfnDuration)) : null,
      series: hourly.sfnStarted || [],
    },
    eventbridge: {
      present: [hourly.evInvocations, hourly.evInvocationsBus, hourly.evMatched, hourly.evMatchedBus].some(points => (points || []).length > 0),
      invocations: Math.round(sum(hourly.evInvocations) + sum(hourly.evInvocationsBus)),
      failed: Math.round(sum(hourly.evFailed) + sum(hourly.evFailedBus)),
      matched: Math.round(sum(hourly.evMatched) + sum(hourly.evMatchedBus)),
      series: hourly.evInvocations || [],
    },
    cloudfront: {
      present: (hourly.cfRequests || []).length > 0,
      requests: Math.round(sum(hourly.cfRequests)), bytes: Math.round(sum(hourly.cfBytes)),
      error4xxRate: hourly.cf4xx?.length ? round(avg(hourly.cf4xx), 2) : null,
      error5xxRate: hourly.cf5xx?.length ? round(avg(hourly.cf5xx), 2) : null,
      series: hourly.cfRequests || [],
    },
    eks: {
      present: (hourly.eksCpu || []).length > 0 || (hourly.eksNodes || []).length > 0,
      nodes: round(last(hourly.eksNodes), 0), failedNodes: round(last(hourly.eksFailedNodes), 0),
      cpuAvg: round(avg(hourly.eksCpu), 1), memoryAvg: round(avg(hourly.eksMemory), 1),
      series: hourly.eksCpu || [],
    },
  };
}

/** Account-wide activity of the last 24h from CloudWatch (plus daily S3 storage). */
async function loadActivity(sdk, cfg, now = Date.now()) {
  const { CloudWatchClient, GetMetricDataCommand } = sdk('client-cloudwatch');
  const client = new CloudWatchClient(cfg);
  const query = (queries, windowMs) => client.send(new GetMetricDataCommand({
    StartTime: new Date(now - windowMs), EndTime: new Date(now), ScanBy: 'TimestampAscending', MetricDataQueries: queries,
  }));
  const global = cfg.region === 'us-east-1' ? client : new CloudWatchClient({ ...cfg, region: 'us-east-1' });
  const cloudfront = () => global.send(new GetMetricDataCommand({
    StartTime: new Date(now - DAY_S * 1000), EndTime: new Date(now), ScanBy: 'TimestampAscending', MetricDataQueries: CLOUDFRONT_QUERIES,
  }));
  const [hourly, daily, edge] = await Promise.all([
    query(HOURLY_QUERIES, DAY_S * 1000),
    settle(query(DAILY_QUERIES, 3 * DAY_S * 1000)),
    settle(cloudfront()),
  ]);
  const hourlySeries = { ...seriesById(hourly), ...(edge.ok ? seriesById(edge.value) : {}) };
  return { status: 'ok', windowHours: 24, ...summarizeActivity(hourlySeries, daily.ok ? seriesById(daily.value) : {}) };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const GLUE_FAILED = new Set(['FAILED', 'ERROR', 'TIMEOUT']);
const GLUE_RUNNING = new Set(['STARTING', 'RUNNING', 'STOPPING', 'WAITING']);

/** Glue job runs started in the last 24h, with the jobs that failed. */
async function loadGlueRuns(sdk, cfg, now = Date.now()) {
  const { GlueClient, GetJobsCommand, GetJobRunsCommand } = sdk('client-glue');
  const client = new GlueClient(cfg);
  const jobs = [];
  let token;
  do {
    const response = await client.send(new GetJobsCommand({ MaxResults: 100, ...(token ? { NextToken: token } : {}) }));
    jobs.push(...(response.Jobs || []).map(job => job.Name));
    token = response.NextToken;
  } while (token && jobs.length < GLUE_MAX_JOBS);
  const since = now - DAY_S * 1000;
  let truncated = !!token;
  const perJob = await mapWithConcurrency(jobs, GLUE_CONCURRENCY, async name => {
    const response = await client.send(new GetJobRunsCommand({ JobName: name, MaxResults: GLUE_RUNS_PER_JOB }));
    const runs = (response.JobRuns || []).filter(run => new Date(run.StartedOn).getTime() >= since);
    if (runs.length === GLUE_RUNS_PER_JOB) truncated = true;
    return { name, runs };
  });
  const runs = perJob.flatMap(job => job.runs.map(run => ({ ...run, job: job.name })));
  const failedByJob = {};
  runs.filter(run => GLUE_FAILED.has(run.JobRunState)).forEach(run => { failedByJob[run.job] = (failedByJob[run.job] || 0) + 1; });
  return {
    status: 'ok',
    present: jobs.length > 0,
    jobs: jobs.length,
    runs: runs.length,
    succeeded: runs.filter(run => run.JobRunState === 'SUCCEEDED').length,
    failed: runs.filter(run => GLUE_FAILED.has(run.JobRunState)).length,
    running: runs.filter(run => GLUE_RUNNING.has(run.JobRunState)).length,
    executionSeconds: runs.reduce((total, run) => total + (run.ExecutionTime || 0), 0),
    failedJobs: Object.entries(failedByJob).map(([job, count]) => ({ job, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    truncated,
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
    // Costs may come from the 12h disk cache, written before a service got its
    // tab: coverage is always decided by the current catalog.
    const known = BY_KEY.get(cost.key);
    const covered = known ? known.tab && !known.partial : cost.tab && !cost.partial;
    if (covered) continue;
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

async function buildAwsInsights(cfg, { sdk = defaultSdk, cache = createCostCache(), cacheKey = 'default', refreshCosts = false, costTtlMs, now = Date.now() } = {}) {
  const section = async (promise, route) => {
    const result = await settle(withTimeout(promise));
    return result.ok ? result.value : failure(result.error, route);
  };
  const [costs, activity, tags, trail, glue] = await Promise.all([
    loadCosts(sdk, cfg, { cache, cacheKey, refresh: refreshCosts, now, ...(costTtlMs ? { ttlMs: costTtlMs } : {}) }),
    section(loadActivity(sdk, cfg, now)),
    section(loadTaggedResources(sdk, cfg)),
    section(loadRecentChanges(sdk, cfg, now)),
    section(loadGlueRuns(sdk, cfg, now)),
  ]);
  return {
    generatedAt: new Date(now).toISOString(),
    costs,
    // One block per service; a failed CloudWatch read marks them all unavailable.
    usage: activity.status === 'ok'
      ? {
        lambda: activity.lambda, ec2: activity.ec2, elb: activity.elb, eks: activity.eks, rds: activity.rds,
        dynamodb: activity.dynamodb, stepfn: activity.stepfn, eventbridge: activity.eventbridge,
        cloudfront: activity.cloudfront, s3: activity.s3, glue,
      }
      : { cloudwatch: activity, glue },
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
  summarizeActivity,
  loadGlueRuns,
  findUncoveredServices,
  buildAwsInsights,
};
