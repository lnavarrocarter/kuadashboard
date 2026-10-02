'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  costWindows, summarizeCostResponse, createCostCache, loadCosts, summarizeActivity, loadGlueRuns, findUncoveredServices, buildAwsInsights,
} = require('./awsInsights');

const NOW = Date.parse('2026-09-28T12:00:00Z');

function fakeSdk(handler) {
  return () => new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      if (name.endsWith('Client')) return class { constructor(cfg) { this.cfg = cfg; } send(command) { return handler(command.name, command.input, this.cfg); } };
      return class { constructor(input) { this.name = name; this.input = input; } };
    },
  });
}

function tempCache(ttlMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kua-cost-'));
  return createCostCache({ file: path.join(dir, 'aws-cost-cache.json'), ...(ttlMs ? { ttlMs } : {}) });
}

const costResponse = {
  ResultsByTime: [
    { TimePeriod: { Start: '2026-08-01' }, Estimated: false, Groups: [
      { Keys: ['Amazon Elastic Compute Cloud - Compute'], Metrics: { UnblendedCost: { Amount: '100', Unit: 'USD' } } },
      { Keys: ['EC2 - Other'], Metrics: { UnblendedCost: { Amount: '50', Unit: 'USD' } } },
      { Keys: ['Amazon Kinesis'], Metrics: { UnblendedCost: { Amount: '30', Unit: 'USD' } } },
      { Keys: ['Tax'], Metrics: { UnblendedCost: { Amount: '5', Unit: 'USD' } } },
    ] },
    { TimePeriod: { Start: '2026-09-01' }, Estimated: true, Groups: [
      { Keys: ['Amazon Elastic Compute Cloud - Compute'], Metrics: { UnblendedCost: { Amount: '80.456', Unit: 'USD' } } },
      { Keys: ['Amazon Kinesis'], Metrics: { UnblendedCost: { Amount: '25', Unit: 'USD' } } },
      { Keys: ['MongoDB(R) VM packaged by Bitnami'], Metrics: { UnblendedCost: { Amount: '2', Unit: 'USD' } } },
    ] },
  ],
};

test('costWindows covers last month to tomorrow and forecasts to the end of the month (UTC)', () => {
  assert.deepEqual(costWindows(NOW), {
    usage: { Start: '2026-08-01', End: '2026-09-29' },
    forecast: { Start: '2026-09-28', End: '2026-10-01' },
    monthStart: '2026-09-01',
  });
  assert.equal(costWindows(Date.parse('2026-01-15T00:00:00Z')).usage.Start, '2025-12-01');
});

test('summarizeCostResponse totals per service and maps KUA tabs', () => {
  const summary = summarizeCostResponse(costResponse, '2026-09-01');
  assert.equal(summary.monthToDate, 107.46);
  assert.equal(summary.lastMonth, 180);
  assert.equal(summary.estimated, true);
  assert.equal(summary.currency, 'USD');
  const ec2 = summary.byService.filter(s => s.key === 'ec2');
  assert.deepEqual(ec2.map(s => [s.name, s.monthToDate, s.lastMonth, s.tab]), [
    ['Amazon Elastic Compute Cloud - Compute', 80.46, 100, 'ec2'],
    ['EC2 - Other', 0, 50, 'ec2'],
  ]);
  assert.equal(summary.byService.find(s => s.key === 'kinesis').tab, null);
  assert.equal(summary.byService.find(s => s.name.startsWith('MongoDB')).marketplace, true);
  assert.equal(summary.byService.some(s => s.name === 'Tax'), false);
});

test('Cost Explorer results are cached for 12h and reused without new charges', async () => {
  let calls = 0;
  const sdk = fakeSdk(async (name, _input, cfg) => {
    calls += 1;
    assert.equal(cfg.region, 'us-east-1');
    if (name === 'GetCostAndUsageCommand') return costResponse;
    if (name === 'GetCostForecastCommand') return { Total: { Amount: '130.2', Unit: 'USD' } };
    throw new Error(name);
  });
  const cache = tempCache();
  const first = await loadCosts(sdk, { region: 'eu-west-1' }, { cache, cacheKey: 'p1', now: NOW });
  assert.equal(first.fromCache, false);
  assert.equal(first.forecast.monthEnd, 130.2);
  assert.equal(first.cachedUntil, NOW + 12 * 3600 * 1000);
  assert.equal(calls, 2);

  const second = await loadCosts(sdk, {}, { cache, cacheKey: 'p1', now: NOW + 11 * 3600 * 1000 });
  assert.equal(second.fromCache, true);
  assert.equal(second.monthToDate, 107.46);
  assert.equal(calls, 2);

  await loadCosts(sdk, {}, { cache, cacheKey: 'p1', now: NOW + 13 * 3600 * 1000 });
  assert.equal(calls, 4);
  await loadCosts(sdk, {}, { cache, cacheKey: 'p1', refresh: true, now: NOW + 13 * 3600 * 1000 });
  assert.equal(calls, 6);
  // A shorter TTL chosen in Options re-reads sooner; a longer one keeps the entry.
  const shortTtl = await loadCosts(sdk, {}, { cache, cacheKey: 'p1', now: NOW + 13 * 3600 * 1000 + 2 * 3600 * 1000, ttlMs: 3600 * 1000 });
  assert.equal(shortTtl.fromCache, false);
  assert.equal(calls, 8);
  const longTtl = await loadCosts(sdk, {}, { cache, cacheKey: 'p1', now: NOW + 40 * 3600 * 1000, ttlMs: 48 * 3600 * 1000 });
  assert.equal(longTtl.fromCache, true);
  assert.equal(calls, 8);
  await loadCosts(sdk, {}, { cache, cacheKey: 'other', now: NOW });
  assert.equal(calls, 10);
});

test('the forecast never goes below what was already spent, and its failure is not fatal', async () => {
  const sdk = fakeSdk(async name => {
    if (name === 'GetCostAndUsageCommand') return costResponse;
    throw Object.assign(new Error('Insufficient amount of historical data'), { name: 'DataUnavailableException' });
  });
  const costs = await loadCosts(sdk, {}, { cache: tempCache(), cacheKey: 'p', now: NOW });
  assert.equal(costs.status, 'ok');
  assert.equal(costs.forecast.monthEnd, null);
  assert.equal(costs.forecast.error.kind, 'error');
});

test('without Cost Explorer access, costs fall back to CloudWatch billing and offer an access request', async () => {
  const sdk = fakeSdk(async name => {
    if (name === 'GetCostAndUsageCommand') {
      throw Object.assign(new Error('User: arn:aws:iam::1:user/dev is not authorized to perform: ce:GetCostAndUsage on resource: arn:aws:ce:us-east-1:1:/GetCostAndUsage'), { name: 'AccessDeniedException' });
    }
    if (name === 'GetMetricStatisticsCommand') return { Datapoints: [{ Timestamp: new Date(NOW - 3600000), Maximum: 88.5 }, { Timestamp: new Date(NOW - 86400000), Maximum: 80 }] };
    throw new Error(name);
  });
  const cache = tempCache();
  const costs = await loadCosts(sdk, {}, { cache, cacheKey: 'p', now: NOW });
  assert.equal(costs.status, 'ok');
  assert.equal(costs.source, 'cloudwatch-billing');
  assert.equal(costs.monthToDate, 88.5);
  assert.equal(costs.explorer.error.action, 'ce:GetCostAndUsage');
  assert.deepEqual(costs.explorer.access.actions, ['ce:GetCostAndUsage']);
  assert.equal(cache.get('p', NOW), null);
});

test('costs are unavailable when neither source answers', async () => {
  const sdk = fakeSdk(async () => { throw Object.assign(new Error('not authorized to perform: ce:GetCostAndUsage'), { name: 'AccessDeniedException' }); });
  const costs = await loadCosts(sdk, {}, { cache: tempCache(), cacheKey: 'p', now: NOW });
  assert.equal(costs.status, 'unavailable');
  assert.equal(costs.error.kind, 'denied');
  assert.equal(costs.fallback.kind, 'denied');
});

test('findUncoveredServices merges cost, tags and CloudTrail for services outside KUA', () => {
  const costs = summarizeCostResponse(costResponse, '2026-09-01');
  const services = findUncoveredServices({
    costs,
    tags: { counts: { lambda: 50, sqs: 4, kinesis: 2, logs: 9, cloudwatch: 6, iam: 3 } },
    trail: { counts: { kinesis: 5, ssm: 7, lambda: 3, sts: 20 } },
  });
  // SQS and CloudWatch Logs have their own tabs now, so they no longer count as outside KUA;
  // CloudWatch (metrics) is still partial and listed last.
  assert.deepEqual(services.map(s => s.key), ['kinesis', 'ce:mongodb-r-vm-packaged-by-bitnami', 'ssm', 'cloudwatch']);
  const kinesis = services[0];
  assert.deepEqual([kinesis.cost, kinesis.lastMonthCost, kinesis.taggedResources, kinesis.recentChanges], [25, 30, 2, 5]);
  assert.deepEqual(kinesis.sources, ['cost', 'tags', 'cloudtrail']);
  assert.equal(services.at(-1).partial, true);
  assert.equal(services.some(s => ['lambda', 'iam', 'sts', 'ec2'].includes(s.key)), false);
});

test('buildAwsInsights degrades each section on its own', async () => {
  const sdk = fakeSdk(async name => {
    switch (name) {
      case 'GetCostAndUsageCommand': return costResponse;
      case 'GetCostForecastCommand': return { Total: { Amount: '140' } };
      case 'GetMetricDataCommand': return { MetricDataResults: [
        { Id: 'lambdaInvocations', Timestamps: [new Date(NOW - 7200000), new Date(NOW - 3600000)], Values: [100, 300] },
        { Id: 'lambdaErrors', Timestamps: [new Date(NOW - 3600000)], Values: [4] },
        { Id: 'lambdaThrottles', Timestamps: [], Values: [] },
      ] };
      case 'GetJobsCommand': return { Jobs: [] };
      case 'GetResourcesCommand': return { ResourceTagMappingList: [{ ResourceARN: 'arn:aws:kinesis:us-east-1:1:stream/events' }] };
      case 'LookupEventsCommand': throw Object.assign(new Error('not authorized to perform: cloudtrail:LookupEvents'), { name: 'AccessDeniedException' });
      default: throw new Error(name);
    }
  });
  const insights = await buildAwsInsights({ region: 'us-east-1' }, { sdk, cache: tempCache(), cacheKey: 'p', now: NOW });
  assert.equal(insights.costs.forecast.monthEnd, 140);
  assert.deepEqual(
    [insights.usage.lambda.invocations, insights.usage.lambda.errors, insights.usage.lambda.throttles, insights.usage.lambda.errorRate],
    [400, 4, 0, 1],
  );
  assert.equal(insights.usage.lambda.series.length, 2);
  assert.equal(insights.usage.ec2.present, false);
  assert.equal(insights.usage.glue.present, false);
  assert.equal(insights.uncovered.sources.tags.status, 'ok');
  assert.equal(insights.uncovered.sources.cloudtrail.status, 'unavailable');
  assert.equal(insights.uncovered.sources.cloudtrail.error.action, 'cloudtrail:LookupEvents');
  assert.ok(insights.uncovered.services.some(s => s.key === 'kinesis'));
  assert.ok(!insights.uncovered.services.some(s => s.key === 'sqs'));
});

const pts = (...values) => values.map((v, i) => ({ t: NOW - (values.length - i) * 3600000, v }));

test('summarizeActivity builds one KPI block per service and hides services without data', () => {
  const activity = summarizeActivity({
    lambdaInvocations: pts(100, 300), lambdaErrors: pts(3), lambdaThrottles: [],
    ec2CpuAvg: pts(10, 20, 30), ec2CpuMax: pts(40, 90, 50),
    albRequests: pts(10, 12), albTarget5xx: pts(1), albElb5xx: pts(5, 6), albLatency: pts(0.2, 0.4),
  }, { s3Bytes: pts(100, 200), s3Objects: pts(5, 7) });

  assert.deepEqual(activity.lambda, { present: true, invocations: 400, errors: 3, throttles: 0, errorRate: 0.75, series: pts(100, 300) });
  assert.deepEqual([activity.ec2.present, activity.ec2.cpuAvg, activity.ec2.cpuPeak, activity.ec2.cpuNow], [true, 20, 90, 30]);
  assert.deepEqual(
    [activity.elb.present, activity.elb.requests, activity.elb.errors5xx, activity.elb.elbGenerated5xx, activity.elb.errorRate, activity.elb.latencyMs, activity.elb.nlbBytes],
    [true, 22, 12, 11, 54.55, 300, null],
  );
  assert.deepEqual([activity.s3.present, activity.s3.bytes, activity.s3.objects], [true, 200, 7]);
  assert.equal(activity.eks.present, false);
});

test('summarizeActivity reports no data as absent services', () => {
  const activity = summarizeActivity({}, {});
  assert.deepEqual(['lambda', 'ec2', 'elb', 's3', 'eks'].map(k => activity[k].present), [false, false, false, false, false]);
  assert.equal(activity.elb.errorRate, null);
});

test('loadGlueRuns counts the last 24h of runs per state and lists failing jobs', async () => {
  let concurrent = 0;
  let peak = 0;
  const jobs = Array.from({ length: 12 }, (_, i) => ({ Name: `job-${i}` }));
  const sdk = fakeSdk(async (name, input) => {
    if (name === 'GetJobsCommand') return { Jobs: jobs };
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await new Promise(resolve => setTimeout(resolve, 5));
    concurrent -= 1;
    const index = Number(input.JobName.split('-')[1]);
    if (index === 0) return { JobRuns: [
      { JobRunState: 'FAILED', StartedOn: new Date(NOW - 3600000), ExecutionTime: 60 },
      { JobRunState: 'FAILED', StartedOn: new Date(NOW - 7200000), ExecutionTime: 30 },
      { JobRunState: 'SUCCEEDED', StartedOn: new Date(NOW - 3 * 86400000), ExecutionTime: 999 },
    ] };
    if (index === 1) return { JobRuns: [{ JobRunState: 'RUNNING', StartedOn: new Date(NOW - 600000), ExecutionTime: 10 }] };
    if (index === 2) return { JobRuns: [{ JobRunState: 'SUCCEEDED', StartedOn: new Date(NOW - 600000), ExecutionTime: 100 }, { JobRunState: 'TIMEOUT', StartedOn: new Date(NOW - 900000), ExecutionTime: 5 }] };
    return { JobRuns: [] };
  });
  const glue = await loadGlueRuns(sdk, {}, NOW);
  assert.deepEqual(
    [glue.present, glue.jobs, glue.runs, glue.succeeded, glue.failed, glue.running, glue.executionSeconds, glue.truncated],
    [true, 12, 5, 1, 3, 1, 205, false],
  );
  assert.deepEqual(glue.failedJobs, [{ job: 'job-0', count: 2 }, { job: 'job-2', count: 1 }]);
  assert.ok(peak <= 8, `concurrency ${peak}`);
});

test('summarizeActivity covers RDS, DynamoDB, Step Functions, EventBridge and CloudFront', () => {
  const a = summarizeActivity({
    rdsCpu: pts(4, 6), rdsCpuMax: pts(10, 30), rdsConnections: pts(3, 5), rdsFreeStorage: pts(20e9, 18e9),
    ddbRead: pts(100, 140), ddbWrite: pts(4), ddbThrottled: pts(2), ddbLatency: pts(0.5, 0.7),
    sfnStarted: pts(6, 4), sfnSucceeded: pts(7), sfnFailed: pts(3), sfnDuration: pts(1000, 3000),
    evInvocations: pts(90, 10), evInvocationsBus: pts(39), evFailed: pts(1), evMatched: pts(95), evMatchedBus: pts(40),
    cfRequests: pts(2, 1), cfBytes: pts(1000, 500), cf4xx: pts(0, 10), cf5xx: pts(0),
  }, {});
  assert.deepEqual([a.rds.present, a.rds.cpuAvg, a.rds.cpuPeak, a.rds.connections, a.rds.freeStorageMin], [true, 5, 30, 5, 18e9]);
  assert.deepEqual([a.dynamodb.readUnits, a.dynamodb.writeUnits, a.dynamodb.throttled, a.dynamodb.systemErrors, a.dynamodb.latencyMs], [240, 4, 2, 0, 0.6]);
  assert.deepEqual([a.stepfn.started, a.stepfn.succeeded, a.stepfn.failed, a.stepfn.timedOut, a.stepfn.avgDurationMs], [10, 7, 3, 0, 2000]);
  assert.deepEqual([a.eventbridge.invocations, a.eventbridge.failed, a.eventbridge.matched], [139, 1, 135]);
  assert.deepEqual([a.cloudfront.requests, a.cloudfront.bytes, a.cloudfront.error4xxRate, a.cloudfront.error5xxRate], [3, 1500, 5, 0]);
});

test('loadActivity reads CloudFront from us-east-1 when the profile is elsewhere', async () => {
  const regions = []
  const sdk = fakeSdk(async (name, input, cfg) => {
    regions.push([cfg.region, input.MetricDataQueries[0].Id]);
    if (input.MetricDataQueries[0].Id === 'cfRequests') return { MetricDataResults: [{ Id: 'cfRequests', Timestamps: [new Date(NOW - 3600000)], Values: [7] }] };
    return { MetricDataResults: [] };
  });
  const insights = await buildAwsInsights({ region: 'eu-west-1' }, { sdk: name => (name === 'client-cloudwatch' ? sdk() : fakeSdk(async () => ({}))()), cache: tempCache(), cacheKey: 'p', now: NOW });
  assert.deepEqual(regions.find(([, id]) => id === 'cfRequests'), ['us-east-1', 'cfRequests']);
  assert.ok(regions.some(([region, id]) => region === 'eu-west-1' && id === 'lambdaInvocations'));
  assert.equal(insights.usage.cloudfront.requests, 7);
});

test('coverage follows the current catalog even for costs cached before a service got its tab', () => {
  const services = findUncoveredServices({
    costs: { byService: [
      { key: 'sqs', label: 'SQS', tab: null, monthToDate: 3, lastMonth: 2 },
      { key: 'kinesis', label: 'Kinesis', tab: null, monthToDate: 1, lastMonth: 1 },
    ] },
    tags: { counts: {} },
    trail: { counts: {} },
  });
  assert.deepEqual(services.map(s => s.key), ['kinesis']);
});
