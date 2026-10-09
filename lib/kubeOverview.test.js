'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  podProblem, summarizePods, summarizeNodes, summarizeWorkloads, summarizeEvents, buildOverview,
} = require('./kubeOverview');

const pod = (name, phase, { containers = [], conditions = [], init = [] } = {}) => ({
  metadata: { name, namespace: 'default' },
  status: { phase, containerStatuses: containers, initContainerStatuses: init, conditions },
});
const running = (restartCount = 0) => ({ ready: true, restartCount, state: { running: {} } });
const waiting = (reason, restartCount = 0) => ({ ready: false, restartCount, state: { waiting: { reason } } });

const node = (name, { ready = true, unschedulable = false, pressures = [], cpu = '4', memory = '8Gi' } = {}) => ({
  metadata: { name, labels: { 'node-role.kubernetes.io/worker': '' } },
  spec: { unschedulable },
  status: {
    allocatable: { cpu, memory },
    conditions: [
      { type: 'Ready', status: ready ? 'True' : 'False' },
      ...pressures.map(type => ({ type, status: 'True' })),
    ],
    nodeInfo: { kubeletVersion: 'v1.30.1' },
  },
});

test('podProblem reports the kubectl-style reason for unhealthy pods', () => {
  assert.equal(podProblem(pod('a', 'Running', { containers: [waiting('CrashLoopBackOff', 5)] })), 'CrashLoopBackOff');
  assert.equal(podProblem(pod('b', 'Pending', { containers: [waiting('ImagePullBackOff')] })), 'ImagePullBackOff');
  assert.equal(podProblem(pod('c', 'Pending', { init: [waiting('CreateContainerConfigError')] })), 'CreateContainerConfigError');
  assert.equal(podProblem(pod('d', 'Pending', { conditions: [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable' }] })), 'Unschedulable');
  assert.equal(podProblem({ metadata: {}, status: { phase: 'Failed', reason: 'Evicted' } }), 'Evicted');
  assert.equal(podProblem(pod('e', 'Running', {
    containers: [{ ready: false, restartCount: 1, state: { terminated: { reason: 'OOMKilled' } } }],
  })), 'OOMKilled');
});

test('podProblem flags running pods that fail their readiness probe', () => {
  const notReady = pod('a', 'Running', {
    containers: [{ ready: false, restartCount: 0, state: { running: {} } }],
    conditions: [{ type: 'Ready', status: 'False' }],
  });
  assert.equal(podProblem(notReady), 'NotReady');
  notReady.metadata.deletionTimestamp = '2026-09-28T12:00:00Z';
  assert.equal(podProblem(notReady), null);
});

test('podProblem ignores healthy, starting and completed pods', () => {
  assert.equal(podProblem(pod('a', 'Running', { containers: [running()] })), null);
  assert.equal(podProblem(pod('b', 'Pending', { containers: [waiting('ContainerCreating')] })), null);
  assert.equal(podProblem(pod('c', 'Succeeded', {
    containers: [{ ready: false, restartCount: 0, state: { terminated: { reason: 'Completed' } } }],
  })), null);
});

test('summarizePods counts phases, readiness, restarts and problem reasons', () => {
  const summary = summarizePods([
    pod('ok-1', 'Running', { containers: [running()] }),
    pod('ok-2', 'Running', { containers: [running(2)] }),
    pod('crash', 'Running', { containers: [waiting('CrashLoopBackOff', 9)] }),
    pod('pull', 'Pending', { containers: [waiting('ImagePullBackOff')] }),
    pod('done', 'Succeeded'),
  ]);

  assert.equal(summary.total, 5);
  assert.equal(summary.ready, 2);
  assert.equal(summary.restarts, 11);
  assert.deepEqual(summary.phases, { Running: 3, Pending: 1, Succeeded: 1, Failed: 0, Unknown: 0 });
  assert.deepEqual(summary.reasons, { CrashLoopBackOff: 1, ImagePullBackOff: 1 });
  assert.equal(summary.problemCount, 2);
  assert.deepEqual(summary.problems.map(p => p.name), ['crash', 'pull']);
});

test('summarizePods limits the problem list but keeps the full count', () => {
  const pods = Array.from({ length: 15 }, (_, i) => pod(`p${i}`, 'Running', { containers: [waiting('CrashLoopBackOff', i)] }));
  const summary = summarizePods(pods, { limit: 5 });
  assert.equal(summary.problemCount, 15);
  assert.equal(summary.problems.length, 5);
  assert.equal(summary.problems[0].name, 'p14');
});

test('summarizeNodes reports readiness, cordons, pressure and usage', () => {
  const summary = summarizeNodes([
    node('n1'),
    node('n2', { ready: false }),
    node('n3', { unschedulable: true, pressures: ['MemoryPressure'] }),
  ], [
    { metadata: { name: 'n1' }, usage: { cpu: '2', memory: '4Gi' } },
    { metadata: { name: 'n3' }, usage: { cpu: '1000m', memory: '2Gi' } },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.ready, 2);
  assert.equal(summary.notReady, 1);
  assert.equal(summary.cordoned, 1);
  assert.equal(summary.pressure.MemoryPressure, 1);
  assert.equal(summary.items[0].name, 'n2');
  assert.equal(summary.items.find(n => n.name === 'n1').cpu.percent, 50);
  assert.equal(summary.items.find(n => n.name === 'n2').cpu, null);
  assert.equal(summary.usage.cpu.usedNano, 3e9);
  assert.equal(summary.usage.cpu.percent, 25);
  assert.equal(summary.usage.memory.percent, 25);
});

test('summarizeNodes omits usage when the Metrics API is unavailable', () => {
  const summary = summarizeNodes([node('n1')], null);
  assert.equal(summary.usage, null);
  assert.equal(summary.items[0].cpu, null);
});

test('summarizeWorkloads lists workloads below their desired replicas', () => {
  const deploy = (name, ready, replicas) => ({ metadata: { name, namespace: 'default' }, spec: { replicas }, status: { readyReplicas: ready } });
  const summary = summarizeWorkloads({
    deployments: [deploy('api', 2, 2), deploy('web', 0, 3), deploy('worker', 1, 2), deploy('idle', 0, 0)],
    statefulsets: [],
    daemonsets: [{ metadata: { name: 'agent' }, status: { numberReady: 2, desiredNumberScheduled: 3 } }],
  });

  assert.equal(summary.deployments.total, 4);
  assert.equal(summary.deployments.notReady, 2);
  assert.equal(summary.deployments.scaledToZero, 1);
  assert.deepEqual(summary.deployments.items.map(i => i.name), ['web', 'worker']);
  assert.equal(summary.daemonsets.notReady, 1);
  assert.equal(summary.statefulsets.total, 0);
});

test('summarizeEvents keeps only recent warnings, newest first', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const evt = (reason, type, lastTimestamp) => ({
    type, reason, lastTimestamp, message: reason, count: 1,
    metadata: { namespace: 'default' }, involvedObject: { kind: 'Pod', name: 'api' },
  });
  const summary = summarizeEvents([
    evt('BackOff', 'Warning', '2026-09-28T11:50:00Z'),
    evt('FailedMount', 'Warning', '2026-09-28T11:55:00Z'),
    evt('Old', 'Warning', '2026-09-28T09:00:00Z'),
    evt('Scheduled', 'Normal', '2026-09-28T11:59:00Z'),
  ], { now });

  assert.equal(summary.warnings, 2);
  assert.deepEqual(summary.recent.map(e => e.reason), ['FailedMount', 'BackOff']);
  assert.equal(summary.recent[0].object, 'Pod/api');
  assert.deepEqual(summary.reasons, { BackOff: 1, FailedMount: 1 });
});

test('buildOverview degrades each failing section on its own', () => {
  const forbidden = Object.assign(new Error('nodes is forbidden'), { statusCode: 403 });
  const overview = buildOverview({
    namespace: 'default',
    now: Date.parse('2026-09-28T12:00:00Z'),
    sources: {
      pods: { ok: true, value: [pod('ok', 'Running', { containers: [running()] })] },
      nodes: { ok: false, error: forbidden },
      deployments: { ok: true, value: [] },
      statefulsets: { ok: true, value: [] },
      daemonsets: { ok: true, value: [] },
      events: { ok: true, value: [] },
      nodeMetrics: { ok: false, error: Object.assign(new Error('the server could not find the requested resource'), { statusCode: 404 }) },
    },
    prometheus: { available: false },
  });

  assert.equal(overview.namespace, 'default');
  assert.equal(overview.pods.total, 1);
  assert.match(overview.nodes.error, /^Forbidden: nodes is forbidden/);
  assert.equal(overview.workloads.deployments.total, 0);
  assert.equal(overview.metrics.available, false);
  assert.match(overview.metrics.error, /^Not found \(HTTP 404\): the server could not find/);
  assert.deepEqual(overview.prometheus, { available: false });
});

test('buildOverview reports cluster usage when node metrics are available', () => {
  const overview = buildOverview({
    sources: {
      pods: { ok: true, value: [] },
      nodes: { ok: true, value: [node('n1')] },
      deployments: { ok: true, value: [] },
      statefulsets: { ok: true, value: [] },
      daemonsets: { ok: true, value: [] },
      events: { ok: true, value: [] },
      nodeMetrics: { ok: true, value: [{ metadata: { name: 'n1' }, usage: { cpu: '1', memory: '2Gi' } }] },
    },
    prometheus: { available: true, service: 'monitoring/prometheus' },
  });

  assert.deepEqual(overview.metrics, { available: true, source: 'metrics.k8s.io' });
  assert.equal(overview.nodes.usage.cpu.percent, 25);
  assert.equal(overview.prometheus.service, 'monitoring/prometheus');
});

test('buildOverview explains SDK errors that only say the request failed', () => {
  const sdkError = Object.assign(new Error('HTTP request failed'), { statusCode: 503, body: 'service unavailable' });
  const overview = buildOverview({ sources: { nodeMetrics: { ok: false, error: sdkError } } });
  assert.equal(overview.metrics.error, 'HTTP 503: service unavailable');
});

test('summarizePods counts pods restarted in the last hour apart from the restart history', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  const pod = (name, restartCount, finishedAt) => ({
    metadata: { name, namespace: 'shop' },
    status: { phase: 'Running', containerStatuses: [{ ready: true, restartCount, lastState: finishedAt ? { terminated: { finishedAt } } : {} }] },
  });
  const summary = summarizePods([
    pod('recent', 1, '2026-10-09T11:30:00Z'),
    pod('old', 40, '2026-10-01T00:00:00Z'),
    pod('never', 0),
  ], { now });
  assert.equal(summary.restarts, 41);
  assert.equal(summary.recentlyRestarted, 1);
  assert.equal(summary.recentRestartMinutes, 60);
});
