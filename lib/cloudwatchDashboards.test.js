'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardConsoleUrl, summarizeWidget, summarizeDashboard } = require('./cloudwatchDashboards');

test('dashboardConsoleUrl links to the dashboard in the right console partition', () => {
  assert.equal(dashboardConsoleUrl('us-east-1', 'Ops Board'), 'https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/Ops%20Board');
  assert.equal(dashboardConsoleUrl('cn-north-1', 'x'), 'https://cn-north-1.console.amazonaws.cn/cloudwatch/home?region=cn-north-1#dashboards/dashboard/x');
  assert.equal(dashboardConsoleUrl('us-gov-west-1', 'x'), 'https://us-gov-west-1.console.amazonaws-us-gov.com/cloudwatch/home?region=us-gov-west-1#dashboards/dashboard/x');
  assert.match(dashboardConsoleUrl(null, 'x'), /^https:\/\/us-east-1\./);
});

test('summarizeWidget reads metric widgets, following "..." repeats and expressions', () => {
  const widget = summarizeWidget({
    type: 'metric', x: 0, y: 0, width: 12, height: 6,
    properties: {
      view: 'timeSeries', region: 'eu-west-1',
      metrics: [
        ['AWS/Lambda', 'Invocations', 'FunctionName', 'a'],
        ['...', 'b'],
        ['AWS/SQS', 'NumberOfMessagesSent', 'QueueName', 'q', { label: 'Sent' }],
        [{ expression: 'm1+m2', label: 'Total' }],
      ],
    },
  }, 'us-east-1');
  assert.equal(widget.metrics, 4);
  assert.deepEqual(widget.namespaces, ['AWS/Lambda', 'AWS/SQS']);
  assert.equal(widget.expressions, 1);
  assert.equal(widget.region, 'eu-west-1');
  assert.equal(widget.title, 'Invocations');
  assert.deepEqual(widget.position, { x: 0, y: 0, width: 12, height: 6 });
});

test('summarizeWidget reads log, alarm and text widgets', () => {
  const log = summarizeWidget({ type: 'log', properties: { title: 'Errors', query: "SOURCE '/aws/lambda/a' | SOURCE '/aws/lambda/b' | fields @message", view: 'table' } }, 'us-east-1');
  assert.deepEqual(log.logGroups, ['/aws/lambda/a', '/aws/lambda/b']);
  assert.equal(log.region, 'us-east-1');
  assert.equal(summarizeWidget({ type: 'alarm', properties: { alarms: ['arn:1', 'arn:2'] } }).alarms, 2);
  assert.equal(summarizeWidget({ type: 'text', properties: { markdown: '\n## **Payments** overview\nmore' } }).title, 'Payments overview');
});

test('summarizeDashboard counts widgets by type, regions and metrics in reading order', () => {
  const body = JSON.stringify({
    widgets: [
      { type: 'log', x: 0, y: 6, properties: { title: 'Logs', region: 'us-east-1', query: '' } },
      { type: 'metric', x: 12, y: 0, properties: { title: 'Right', region: 'us-east-1', metrics: [['AWS/EC2', 'CPUUtilization']] } },
      { type: 'metric', x: 0, y: 0, properties: { title: 'Left', region: 'eu-west-1', metrics: [['AWS/EC2', 'CPUUtilization'], ['AWS/EC2', 'NetworkIn']] } },
    ],
  });
  const summary = summarizeDashboard(body, { defaultRegion: 'us-east-1' });
  assert.equal(summary.valid, true);
  assert.deepEqual(summary.widgets.map(w => w.title), ['Left', 'Right', 'Logs']);
  assert.deepEqual(summary.widgets.map(w => w.index), [2, 1, 0]);
  assert.deepEqual(summary.counts, { log: 1, metric: 2 });
  assert.deepEqual(summary.regions, ['eu-west-1', 'us-east-1']);
  assert.equal(summary.metricCount, 3);
});

test('summarizeDashboard tolerates invalid or empty bodies', () => {
  assert.deepEqual(summarizeDashboard('{not json'), { valid: false, widgets: [], counts: {}, regions: [], metricCount: 0 });
  assert.equal(summarizeDashboard('{}').widgets.length, 0);
});
