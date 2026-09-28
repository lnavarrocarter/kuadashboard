'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  costWindows, summarizeCostResponse, createCostCache, loadCosts, findUncoveredServices, buildAwsInsights,
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
  await loadCosts(sdk, {}, { cache, cacheKey: 'other', now: NOW });
  assert.equal(calls, 8);
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
    tags: { counts: { lambda: 50, sqs: 4, kinesis: 2, logs: 9, iam: 3 } },
    trail: { counts: { kinesis: 5, ssm: 7, lambda: 3, sts: 20 } },
  });
  assert.deepEqual(services.map(s => s.key), ['kinesis', 'ce:mongodb-r-vm-packaged-by-bitnami', 'sqs', 'ssm', 'logs']);
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
        { Id: 'invocations', Timestamps: [new Date(NOW - 7200000), new Date(NOW - 3600000)], Values: [100, 300] },
        { Id: 'errors', Timestamps: [new Date(NOW - 3600000)], Values: [4] },
        { Id: 'throttles', Timestamps: [], Values: [] },
      ] };
      case 'GetResourcesCommand': return { ResourceTagMappingList: [{ ResourceARN: 'arn:aws:sqs:us-east-1:1:queue' }] };
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
  assert.equal(insights.usage.lambda.series.invocations.length, 2);
  assert.equal(insights.uncovered.sources.tags.status, 'ok');
  assert.equal(insights.uncovered.sources.cloudtrail.status, 'unavailable');
  assert.equal(insights.uncovered.sources.cloudtrail.error.action, 'cloudtrail:LookupEvents');
  assert.ok(insights.uncovered.services.some(s => s.key === 'sqs'));
});
