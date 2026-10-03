'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceCall } = require('./awsPricing');
const { createUsageLedger } = require('./ledger');
const { installAwsMeter, runWithUsageContext, usageContextMiddleware, featureFromPath } = require('./awsMeter');

const GB = 1024 ** 3;
// Commands are recognized by class name, like the SDK's.
const command = (name, input = {}) => new ({ [name]: class { constructor(value) { this.input = value; } } })[name](input);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≈ ${expected}`);

test('GetMetricData is priced per metric requested; math expressions are free', () => {
  const priced = priceCall(command('GetMetricDataCommand', { MetricDataQueries: [{ MetricStat: {} }, { MetricStat: {} }, { Expression: 'm1+m2' }] }), {});
  assert.equal(priced.quantity, 2);
  near(priced.usd, 0.00002);
  assert.equal(priced.unit, 'metric');
  assert.equal(priceCall(command('GetMetricDataCommand', { MetricDataQueries: [{ Expression: 'x' }] }), {}), null);
});

test('Logs Insights is priced once per query, on completion, by GB scanned', () => {
  const seen = new Set();
  const read = (status, bytes) => priceCall(command('GetQueryResultsCommand', { queryId: 'q1' }), { status, statistics: { bytesScanned: bytes } }, seen);
  assert.equal(read('Running', GB), null);
  const done = read('Complete', 2 * GB);
  near(done.usd, 0.01);
  assert.equal(done.quantity, 2);
  assert.equal(done.ref, 'q1');
  assert.equal(read('Complete', 2 * GB), null, 'reading the results again is not billed again');
  // Athena's GetQueryResults has the same name and is not a Logs Insights query.
  assert.equal(priceCall(command('GetQueryResultsCommand', { QueryExecutionId: 'a' }), {}), null);
});

test('FilterLogEvents downloads are free-tier transfer: shown as potential cost', () => {
  const priced = priceCall(command('FilterLogEventsCommand', { logGroupName: '/g' }), { events: [{ message: 'x'.repeat(880) }] });
  assert.equal(priced.bytes, 1000);
  assert.equal(priced.usd, 0);
  near(priced.potentialUsd, (1000 / GB) * 0.09);
  assert.match(priced.freeTier, /100 GB/);
  assert.equal(priceCall(command('FilterLogEventsCommand'), { events: [] }), null);
});

test('Cost Explorer, Athena and Lex prices; free reads are not priced', () => {
  assert.equal(priceCall(command('GetCostAndUsageCommand'), {}).usd, 0.01);
  const athena = priceCall(command('GetQueryExecutionCommand'), { QueryExecution: { QueryExecutionId: 'e1', Status: { State: 'SUCCEEDED' }, Statistics: { DataScannedInBytes: 1024 } } });
  near(athena.usd, (10 * 1024 * 1024 / 1024 ** 4) * 5); // 10 MB minimum per query
  assert.equal(athena.bytes, 1024);
  assert.equal(priceCall(command('RecognizeTextCommand'), {}).usd, 0.00075);
  assert.equal(priceCall(command('DescribeLogGroupsCommand'), {}), null);
  assert.equal(priceCall(command('ListFunctionsCommand'), {}), null);
});

test('the ledger sums today, month and window, keeps the calculation and prices a query once', () => {
  const NOW = new Date(2026, 9, 3, 15).getTime();
  const ledger = createUsageLedger({ dataDir: ':memory:', now: () => NOW });
  const base = { service: 'CloudWatch Logs', operation: 'Logs Insights query', kind: 'logsInsights', unit: 'GB scanned', unitPrice: 0.005, profileId: 'p1', feature: 'logs-insights' };
  ledger.record({ ...base, at: NOW - 1000, quantity: 2, usd: 0.01, ref: 'q1' });
  ledger.record({ ...base, at: NOW - 1000, quantity: 2, usd: 0.01, ref: 'q1' }); // same query: ignored
  ledger.record({ ...base, at: NOW - 3 * 86400000, quantity: 4, usd: 0.02, ref: 'q2' });
  ledger.record({ service: 'CloudWatch', operation: 'GetMetricData', kind: 'getMetricData', unit: 'metric', unitPrice: 0.00001, quantity: 100, usd: 0.001, profileId: 'p2', at: NOW - 60000 });
  const summary = ledger.summary({ days: 30 });
  near(summary.totals.today.usd, 0.011);
  assert.equal(summary.totals.window.calls, 3);
  const insights = summary.byOperation.find(row => row.kind === 'logsInsights');
  assert.deepEqual([insights.calls, insights.quantity, insights.unitPrice], [2, 6, 0.005]);
  near(insights.usd, 0.03);
  assert.deepEqual(summary.recent.map(row => row.kind), ['logsInsights', 'getMetricData', 'logsInsights']);
  assert.equal(ledger.summary({ profileId: 'p2' }).totals.window.calls, 1);
  assert.equal(ledger.summary({ service: 'CloudWatch Logs' }).byOperation.length, 1);
  assert.equal(summary.byFeature.find(row => row.feature === 'logs-insights').calls, 2);
});

test('the meter wraps send, attributes calls to the request context and never breaks a call', async () => {
  class FakeBase { constructor() { this.config = { region: async () => 'us-east-1' }; } async send(cmd) { return cmd.input.reply; } }
  const recorded = [];
  const ledger = { record: event => { if (event.kind === 'boom') throw new Error('disk full'); recorded.push(event); } };
  assert.equal(installAwsMeter({ ledger, bases: [FakeBase], log: { warn() {} } }), 1);
  assert.equal(installAwsMeter({ ledger, bases: [FakeBase], log: { warn() {} } }), 0, 'installs once');
  const client = new FakeBase();

  const output = await runWithUsageContext({ profileId: 'p1', feature: 'logs-insights' }, () =>
    client.send(command('GetMetricDataCommand', { MetricDataQueries: [{ MetricStat: {} }], reply: { ok: 1 } })));
  assert.deepEqual(output, { ok: 1 });
  assert.equal(recorded[0].profileId, 'p1');
  assert.equal(recorded[0].feature, 'logs-insights');
  assert.equal(recorded[0].region, 'us-east-1');

  await client.send(command('DescribeLogGroupsCommand', { reply: {} }));
  assert.equal(recorded.length, 1, 'free calls are not recorded');
  await client.send(command('GetCostAndUsageCommand', { reply: {} }));
  assert.equal(recorded[1].feature, 'background');

  // Express middleware: profile from the header, feature from the path.
  await new Promise(resolve => usageContextMiddleware({ get: () => 'p9', path: '/cloud/aws/log-scans' }, {}, async () => {
    await client.send(command('GetCostForecastCommand', { reply: {} }));
    resolve();
  }));
  assert.deepEqual([recorded[2].profileId, recorded[2].feature], ['p9', 'log-scans']);
});

test('features come from the API path', () => {
  assert.equal(featureFromPath('/cloud/aws/cloudwatch/logs-query'), 'logs-insights');
  assert.equal(featureFromPath('/cloud/aws/overview/insights'), 'overview-insights');
  assert.equal(featureFromPath('/cloud/aws/cloudwatch/log-cache/sync'), 'log-cache');
  assert.equal(featureFromPath('/cloud/aws/athena/queries'), 'athena');
});
