'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseDuration, dashboardRangeSeconds, choosePeriod, resolveMetricRows, buildMetricQueries, alarmNameFromArn,
  alarmQueries, fetchMetricWidget, splitLogQuery, logGroupIdentifier, logGroupName, estimateLogScan, normalizeQueryResults, fetchAlarmWidget,
} = require('./cloudwatchDashboardData');

const NOW = Date.parse('2026-09-28T12:00:00Z');
class Cmd { constructor(input) { this.input = input; } }
const commands = { GetMetricDataCommand: class extends Cmd { get kind() { return 'data'; } }, DescribeAlarmsCommand: class extends Cmd { get kind() { return 'alarms'; } } };

test('parseDuration and dashboardRangeSeconds read ISO-8601 relative ranges', () => {
  assert.equal(parseDuration('-PT3H'), -10800);
  assert.equal(parseDuration('-P7D'), -604800);
  assert.equal(parseDuration('-P1W'), -604800);
  assert.equal(parseDuration('-PT15M'), -900);
  assert.equal(parseDuration('PT0H'), 0);
  assert.equal(parseDuration('yesterday'), null);
  assert.equal(dashboardRangeSeconds({ start: '-P7D' }), 604800);
  assert.equal(dashboardRangeSeconds({}), 10800);
});

test('choosePeriod honours the widget, the full-range option, or keeps ~360 points', () => {
  assert.equal(choosePeriod(10800, 30), 30);
  assert.equal(choosePeriod(10800, null), 60);
  assert.equal(choosePeriod(604800, null), 1800);
  assert.equal(choosePeriod(7200, 300, true), 7200);
});

test('resolveMetricRows expands "." and "..." like CloudWatch', () => {
  const rows = resolveMetricRows([
    ['AWS/Lambda', 'Invocations', 'FunctionName', 'a'],
    ['...', 'b'],
    ['.', 'Errors', '.', 'c', { stat: 'Sum' }],
    [{ expression: 'm1+m2', id: 'e1' }],
    'garbage',
  ]);
  assert.deepEqual(rows.map(r => r.kind === 'metric' ? [r.namespace, r.metricName, r.dimensions.map(d => `${d.Name}=${d.Value}`).join()] : ['expr', r.expression]), [
    ['AWS/Lambda', 'Invocations', 'FunctionName=a'],
    ['AWS/Lambda', 'Invocations', 'FunctionName=b'],
    ['AWS/Lambda', 'Errors', 'FunctionName=c'],
    ['expr', 'm1+m2'],
  ]);
  assert.equal(rows[2].options.stat, 'Sum');
});

test('buildMetricQueries keeps ids, stats, visibility, labels, colors and axes', () => {
  const { queries, series } = buildMetricQueries({ properties: {
    stat: 'Sum',
    metrics: [
      [{ expression: '100*(m2/m3)', label: '% Bounce', id: 'e1' }],
      ['AWS/SES', 'Reputation.BounceRate', { id: 'm1', color: '#2ca02c', yAxis: 'right' }],
      ['.', 'Bounce', { id: 'm2', visible: false }],
      ['.', 'Send', { id: 'm3', visible: false, stat: 'Average' }],
      ['.', 'Open'],
    ],
  } }, { period: 300 });
  assert.deepEqual(queries.map(q => [q.Id, q.ReturnData, q.Expression || q.MetricStat.Stat]), [
    ['e1', true, '100*(m2/m3)'], ['m1', true, 'Sum'], ['m2', false, 'Sum'], ['m3', false, 'Average'], ['kua0', true, 'Sum'],
  ]);
  assert.deepEqual(series.map(s => [s.id, s.label, s.color, s.yAxis]), [
    ['e1', '% Bounce', null, 'left'], ['m1', 'Reputation.BounceRate', '#2ca02c', 'right'], ['kua0', 'Open', null, 'left'],
  ]);
});

test('alarmQueries draws single-metric and metric-math alarms with prefixed ids', () => {
  assert.equal(alarmNameFromArn('arn:aws:cloudwatch:us-east-1:1:alarm:Msg Error en cola'), 'Msg Error en cola');
  const single = alarmQueries({ AlarmName: 'a', Namespace: 'AWS/SQS', MetricName: 'Age', Dimensions: [{ Name: 'QueueName', Value: 'q' }], Period: 60, Statistic: 'Maximum' }, 'alarm0');
  assert.deepEqual(single[0], { Id: 'alarm0_m', MetricStat: { Metric: { Namespace: 'AWS/SQS', MetricName: 'Age', Dimensions: [{ Name: 'QueueName', Value: 'q' }] }, Period: 60, Stat: 'Maximum' }, Label: 'a', ReturnData: true });
  const math = alarmQueries({ AlarmName: 'b', Metrics: [
    { Id: 'e1', Expression: 'm1/m2*100', ReturnData: true },
    { Id: 'm1', MetricStat: { Metric: {}, Period: 60, Stat: 'Sum' }, ReturnData: false },
    { Id: 'm2', MetricStat: { Metric: {}, Period: 60, Stat: 'Sum' }, ReturnData: false },
  ] }, 'alarm1');
  assert.equal(math[0].Expression, 'alarm1_m1/alarm1_m2*100');
  assert.deepEqual(math.map(q => q.Id), ['alarm1_e1', 'alarm1_m1', 'alarm1_m2']);
});

test('fetchMetricWidget pages results, keeps multi-series labels and adds alarm thresholds', async () => {
  const sent = [];
  const client = {
    async send(command) {
      sent.push(command);
      if (command.kind === 'alarms') return { MetricAlarms: [{ AlarmName: 'Queue age', Namespace: 'AWS/SQS', MetricName: 'Age', Period: 60, Statistic: 'Maximum', Threshold: 300, ComparisonOperator: 'GreaterThanThreshold', StateValue: 'ALARM' }] };
      if (!command.input.NextToken) {
        return { NextToken: 'p2', MetricDataResults: [
          { Id: 'q1', Label: 'DELIVERED', Timestamps: [new Date(NOW - 120000)], Values: [5] },
          { Id: 'q1', Label: 'FAILED', Timestamps: [new Date(NOW - 120000)], Values: [1] },
        ] };
      }
      return { MetricDataResults: [
        { Id: 'alarm0_m', Label: 'Queue age', Timestamps: [new Date(NOW - 60000), new Date(NOW - 120000)], Values: [320, 290] },
      ] };
    },
  };
  const widget = { properties: {
    metrics: [[{ expression: 'SELECT SUM(x) FROM SCHEMA("N", a) GROUP BY status', id: 'q1', label: 'Consulta1' }]],
    annotations: { alarms: ['arn:aws:cloudwatch:us-east-1:1:alarm:Queue age'], horizontal: [{ value: 10, label: 'SLO' }] },
  } };
  const data = await fetchMetricWidget(widget, { client, commands, start: NOW - 3 * 3600000, end: NOW, now: NOW });
  assert.equal(data.period, 60);
  assert.equal(sent.filter(c => c.kind === 'data').length, 2);
  assert.deepEqual(sent.find(c => c.kind === 'alarms').input.AlarmNames, ['Queue age']);
  assert.deepEqual(data.series.map(s => [s.label, s.points.length]), [['DELIVERED', 1], ['FAILED', 1], ['Queue age', 2]]);
  assert.deepEqual(data.series.find(s => s.label === 'Queue age').points.map(p => p.v), [290, 320]);
  assert.deepEqual(data.horizontal.map(h => [h.value, h.label]), [[10, 'SLO'], [300, 'Queue age (GreaterThanThreshold)']]);
  assert.deepEqual(data.alarms, [{ name: 'Queue age', state: 'ALARM', reason: null, threshold: 300 }]);
});

test('fetchMetricWidget widens the query to one full period when the period exceeds the range', async () => {
  let startTime;
  const client = { async send(command) { startTime = command.input.StartTime; return { MetricDataResults: [] }; } };
  const widget = { properties: { period: 2592000, stat: 'Sum', view: 'singleValue', metrics: [['AWS/SES', 'Send']] } };
  await fetchMetricWidget(widget, { client, commands, start: NOW - 3 * 3600000, end: NOW, now: NOW });
  assert.equal(startTime.getTime(), NOW - 2592000 * 1000);
});

test('fetchMetricWidget honours a widget-level relative range', async () => {
  let input;
  const client = { async send(command) { input = command.input; return { MetricDataResults: [] }; } };
  const widget = { properties: { start: '-P30D', period: 3600, metrics: [['AWS/Lambda', 'Invocations']] } };
  const data = await fetchMetricWidget(widget, { client, commands, start: NOW - 3 * 3600000, end: NOW, now: NOW });
  assert.equal(input.StartTime.getTime(), NOW - 30 * 86400000);
  assert.deepEqual(data.ownRange, { start: NOW - 30 * 86400000, end: NOW });
});

test('splitLogQuery separates SOURCE log groups from the Logs Insights query', () => {
  assert.deepEqual(
    splitLogQuery("SOURCE '/aws/lambda/a' | SOURCE '/aws/lambda/b' | fields @timestamp, @message\n| sort @timestamp desc"),
    { logGroups: ['/aws/lambda/a', '/aws/lambda/b'], queryString: 'fields @timestamp, @message\n| sort @timestamp desc' },
  );
  assert.deepEqual(splitLogQuery("SOURCE '/aws-glue/jobs/output'\n| filter @message like /x/"), { logGroups: ['/aws-glue/jobs/output'], queryString: 'filter @message like /x/' });
  assert.deepEqual(splitLogQuery('fields @message'), { logGroups: [], queryString: 'fields @message' });
});

test('SOURCE may be a log group ARN (as in production dashboards)', () => {
  const query = 'SOURCE "arn:aws:logs:us-east-1:341710078349:log-group:/aws/lambda/StartProcessCampaignFunction-v1" |\nfields @timestamp, @message\n# | filter @message like \'\'\n| limit 10000';
  const { logGroups, queryString } = splitLogQuery(query);
  assert.deepEqual(logGroups, ['arn:aws:logs:us-east-1:341710078349:log-group:/aws/lambda/StartProcessCampaignFunction-v1']);
  assert.match(queryString, /^fields @timestamp, @message/);
  assert.equal(logGroupName(logGroups[0]), '/aws/lambda/StartProcessCampaignFunction-v1');
  assert.equal(logGroupIdentifier('arn:aws:logs:us-east-1:1:log-group:/a:*'), 'arn:aws:logs:us-east-1:1:log-group:/a');
  assert.equal(logGroupName('/aws/lambda/plain'), '/aws/lambda/plain');
});

test('estimateLogScan spreads stored bytes over retention and decides auto-run', () => {
  const small = estimateLogScan([
    { name: 'a', found: true, storedBytes: 5 * 1024 ** 2, retentionInDays: 5, creationTime: NOW - 100 * 86400000 },
  ], 3 * 3600, NOW);
  assert.equal(small.logGroups[0].estimatedBytes, Math.round((5 * 1024 ** 2) / 5 / 8));
  assert.equal(small.autoRun, true);
  const big = estimateLogScan([{ name: 'b', found: true, storedBytes: 300 * 1024 ** 3, retentionInDays: 30, creationTime: NOW - 400 * 86400000 }], 7 * 86400, NOW);
  assert.equal(big.estimatedBytes, 70 * 1024 ** 3);
  assert.equal(big.estimatedCostUsd, 0.35);
  assert.equal(big.autoRun, false);
  const unknown = estimateLogScan([{ name: 'x', found: false }], 3600, NOW);
  assert.deepEqual([unknown.autoRun, unknown.unknown, unknown.estimatedBytes], [false, true, null]);
  const mixed = estimateLogScan([
    { name: 'a', found: true, storedBytes: 1000, retentionInDays: 1, creationTime: NOW - 86400000 },
    { name: 'other-account', found: false },
  ], 3600, NOW);
  assert.equal(mixed.autoRun, false);
});

test('normalizeQueryResults keeps field order and drops @ptr', () => {
  const out = normalizeQueryResults({
    status: 'Complete',
    results: [[{ field: 'tabla', value: 'x' }, { field: 'avg', value: '1.5' }, { field: '@ptr', value: 'p' }], [{ field: 'tabla', value: 'y' }]],
    statistics: { bytesScanned: 1024, recordsMatched: 2, recordsScanned: 10 },
  });
  assert.deepEqual(out, { status: 'Complete', fields: ['tabla', 'avg'], rows: [{ tabla: 'x', avg: '1.5' }, { tabla: 'y' }], statistics: { bytesScanned: 1024, recordsMatched: 2, recordsScanned: 10 } });
});

test('fetchAlarmWidget reports states and missing alarms', async () => {
  const client = { async send(command) { assert.deepEqual(command.input.AlarmNames, ['a', 'gone']); return { MetricAlarms: [{ AlarmName: 'a', StateValue: 'OK' }], CompositeAlarms: [] }; } };
  const out = await fetchAlarmWidget({ properties: { alarms: ['arn:aws:cloudwatch:us-east-1:1:alarm:a', 'arn:aws:cloudwatch:us-east-1:1:alarm:gone'] } }, { client, commands });
  assert.deepEqual(out, { alarms: [{ name: 'a', state: 'OK', reason: null, updated: null }], missing: ['gone'] });
});
