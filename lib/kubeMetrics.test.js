const test = require('node:test');
const assert = require('node:assert/strict');
const {
  metricPayload, metricsApiUsage, nodeReference, podsMetricPayload, podsReference,
  prometheusByPod, prometheusUsage, prometheusValue,
} = require('./kubeMetrics');

function pod(name, resources = {}) {
  return { metadata: { name }, spec: { containers: [{ name: 'app', resources }] } };
}

const vector = series => ({ data: { result: series } });

test('an empty Prometheus answer is no sample, not zero', () => {
  assert.equal(prometheusValue(vector([])), null);
  assert.equal(prometheusValue(vector([{ value: [0, 'NaN'] }])), null);
  assert.equal(prometheusValue(undefined), null);
  assert.equal(prometheusValue(vector([{ value: [0, '0'] }])), 0);
});

test('a pod without samples reads as unavailable with no bar', () => {
  const pods = [pod('web-1', { limits: { cpu: '500m', memory: '256Mi' } })];
  const payload = podsMetricPayload(pods, prometheusUsage(pods, vector([]), vector([])));
  assert.equal(payload.cpu.available, false);
  assert.equal(payload.cpu.nano, null);
  assert.equal(payload.cpu.display, null);
  assert.equal(payload.cpu.percent, null);
  assert.equal(payload.memory.available, false);
  assert.deepEqual(payload.coverage, { pods: 1, sampled: 0 });
  assert.deepEqual(payload.items, [{ name: 'web-1', cpu: null, memory: null }]);
});

test('percent is measured against container limits, without floor or ceiling', () => {
  const pods = [pod('web-1', { limits: { cpu: '100m', memory: '100Mi' } })];
  const cpu = vector([{ metric: { pod: 'web-1' }, value: [0, '0.15'] }]);
  const memory = vector([{ metric: { pod: 'web-1' }, value: [0, String(1024 * 1024)] }]);
  const payload = podsMetricPayload(pods, prometheusUsage(pods, cpu, memory));
  assert.equal(payload.cpu.percent, 150);
  assert.equal(payload.cpu.reference.kind, 'limit');
  assert.equal(payload.memory.percent, 1);
  assert.equal(payload.memory.reference.display, '100.0 MiB');
});

test('a real zero stays zero', () => {
  const pods = [pod('idle', { requests: { cpu: '100m' } })];
  const cpu = vector([{ metric: { pod: 'idle' }, value: [0, '0'] }]);
  const payload = podsMetricPayload(pods, prometheusUsage(pods, cpu, vector([])));
  assert.equal(payload.cpu.available, true);
  assert.equal(payload.cpu.percent, 0);
  assert.equal(payload.cpu.reference.kind, 'request');
});

test('no percent without limits or requests on every container', () => {
  assert.equal(podsReference([pod('a'), pod('b', { limits: { cpu: '1' } })], 'cpu'), null);
  const payload = metricPayload({ cpuNano: 5e8 });
  assert.equal(payload.cpu.percent, null);
  assert.equal(payload.cpu.display, '500m');
});

test('workload coverage counts only pods with samples and sizes the reference to them', () => {
  const pods = [pod('a', { limits: { cpu: '1' } }), pod('b', { limits: { cpu: '1' } })];
  const items = [{ metadata: { name: 'a' }, containers: [{ usage: { cpu: '500m', memory: '10Mi' } }] }];
  const payload = podsMetricPayload(pods, metricsApiUsage(pods, items));
  assert.deepEqual(payload.coverage, { pods: 2, sampled: 1 });
  assert.equal(payload.cpu.percent, 50);
  assert.deepEqual(payload.items[1], { name: 'b', cpu: null, memory: null });
});

test('Prometheus series are grouped per pod', () => {
  const values = prometheusByPod(vector([
    { metric: { pod: 'a' }, value: [0, '1'] },
    { metric: { pod: 'b' }, value: [0, 'NaN'] },
  ]));
  assert.deepEqual([...values], [['a', 1]]);
});

test('nodes use allocatable as reference', () => {
  const node = { status: { allocatable: { cpu: '1930m', memory: '7Gi' }, capacity: { cpu: '2' } } };
  assert.deepEqual(nodeReference(node, 'cpu'), { kind: 'allocatable', value: 1.93e9 });
  assert.equal(nodeReference({}, 'memory'), null);
});
