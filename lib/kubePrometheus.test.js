'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidNamespace, rangeWindow, timeseriesQueries, nodeUsageQueries,
  parseMatrix, parseVectorBy, nodeMetricsFromPrometheus, summarizeSeries,
} = require('./kubePrometheus');
const { summarizeNodes } = require('./kubeOverview');

test('rangeWindow yields ~120 points with a 30s-aligned step', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  assert.deepEqual(rangeWindow('1h', now), { range: '1h', start: now / 1000 - 3600, end: now / 1000, step: 30 });
  assert.equal(rangeWindow('6h', now).step, 180);
  assert.equal(rangeWindow('24h', now).step, 720);
  assert.equal(rangeWindow('7d', now).step, 5040);
  assert.equal(rangeWindow('90d', now), null);
});

test('isValidNamespace only accepts Kubernetes namespace names', () => {
  assert.equal(isValidNamespace('all'), true);
  assert.equal(isValidNamespace('backend-360'), true);
  assert.equal(isValidNamespace('bad"}) or vector(1'), false);
  assert.equal(isValidNamespace('Upper'), false);
  assert.equal(isValidNamespace(''), false);
});

test('cluster-wide queries prefer node-exporter and fall back to cAdvisor', () => {
  const q = timeseriesQueries('all', 30);
  assert.match(q.cpu.query, /^sum\(rate\(node_cpu_seconds_total\{mode!="idle"\}\[5m\]\)\) or sum\(rate\(container_cpu_usage_seconds_total\{container!="",container!="POD"\}/);
  assert.match(q.memory.query, /node_memory_MemAvailable_bytes\) or sum\(container_memory_working_set_bytes/);
  assert.equal(q.restarts.query, 'sum(increase(kube_pod_container_status_restarts_total[300s]))');
  assert.equal(q.restarts.windowSeconds, 300);
  assert.equal(q.notReady.query, 'sum(kube_pod_status_ready{condition="false"})');
  assert.deepEqual(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.unit])), {
    cpu: 'cores', memory: 'bytes', restarts: 'count', notReady: 'count',
  });
});

test('namespace queries are scoped to that namespace', () => {
  const q = timeseriesQueries('backend360', 720);
  assert.equal(q.cpu.query, 'sum(rate(container_cpu_usage_seconds_total{namespace="backend360",container!="",container!="POD"}[5m]))');
  assert.equal(q.memory.query, 'sum(container_memory_working_set_bytes{namespace="backend360",container!="",container!="POD"})');
  assert.equal(q.restarts.query, 'sum(increase(kube_pod_container_status_restarts_total{namespace="backend360"}[720s]))');
  assert.equal(q.notReady.query, 'sum(kube_pod_status_ready{namespace="backend360",condition="false"})');
});

test('nodeUsageQueries join node-exporter samples to node names', () => {
  const q = nodeUsageQueries();
  assert.match(q.cpu, /^sum by \(nodename\) \(rate\(node_cpu_seconds_total\{mode!="idle"\}\[5m\]\) \* on\(instance\) group_left\(nodename\) node_uname_info\)$/);
  assert.match(q.memory, /group_left\(nodename\) node_uname_info/);
});

test('parseMatrix converts samples to epoch ms and drops NaN', () => {
  const body = { data: { result: [{ values: [[1790582400, '0.5'], [1790582430, 'NaN'], [1790582460.5, '1.25']] }] } };
  assert.deepEqual(parseMatrix(body), [{ t: 1790582400000, v: 0.5 }, { t: 1790582460500, v: 1.25 }]);
  assert.deepEqual(parseMatrix({ data: { result: [] } }), []);
});

test('parseVectorBy keys instant samples by label', () => {
  const body = { data: { result: [
    { metric: { nodename: 'a' }, value: [1, '0.1'] },
    { metric: {}, value: [1, '9'] },
  ] } };
  assert.deepEqual([...parseVectorBy(body, 'nodename')], [['a', 0.1]]);
});

test('Prometheus node usage feeds the same node summary as metrics-server', () => {
  const vector = (label, entries) => ({ data: { result: entries.map(([name, v]) => ({ metric: { [label]: name }, value: [1, String(v)] })) } });
  const items = nodeMetricsFromPrometheus(
    vector('nodename', [['n1', 0.5], ['n2', 1]]),
    vector('nodename', [['n1', 1024 ** 3], ['n2', 2 * 1024 ** 3]]),
  );
  assert.deepEqual(items[0], { metadata: { name: 'n1' }, usage: { cpu: '0.5', memory: String(1024 ** 3) } });

  const node = name => ({ metadata: { name }, spec: {}, status: { allocatable: { cpu: '2', memory: '4Gi' }, conditions: [{ type: 'Ready', status: 'True' }] } });
  const summary = summarizeNodes([node('n1'), node('n2')], items);
  assert.equal(summary.usage.cpu.percent, 37.5);
  assert.equal(summary.usage.memory.percent, 37.5);
  assert.equal(summary.items.find(n => n.name === 'n1').cpu.percent, 25);
});

test('summarizeSeries reports latest, max and average', () => {
  assert.deepEqual(summarizeSeries([{ t: 1, v: 1 }, { t: 2, v: 3 }, { t: 3, v: 2 }]), { latest: 2, max: 3, avg: 2 });
  assert.deepEqual(summarizeSeries([]), { latest: null, max: null, avg: null });
});

test('PromQL literals escape quotes and backslashes; regex matchers double the regex escapes', () => {
  const { promString, promRegexOf } = require('./kubePrometheus');
  assert.equal(promString('a"b\\c'), 'a\\"b\\\\c');
  // ip-1.ec2 as a regex is ip-1\.ec2; inside a PromQL string the backslash is doubled.
  assert.equal(promRegexOf(['ip-1.ec2', 'web']), 'ip-1\\\\.ec2|web');
});

test('node usage matches the node by nodename, not by the node-exporter instance', () => {
  const { nodeQueries } = require('./kubePrometheus');
  const q = nodeQueries('ip-20-0-7-87.ec2.internal');
  assert.match(q.nodeExporter.cpu, /node_uname_info\{nodename="ip-20-0-7-87\.ec2\.internal"\}/);
  assert.doesNotMatch(q.nodeExporter.cpu, /instance=~/);
  assert.match(q.cadvisor.memory, /container_memory_working_set_bytes\{node="ip-20-0-7-87\.ec2\.internal"/);
});
