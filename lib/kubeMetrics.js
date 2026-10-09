'use strict';

// Usage payload for the Kubernetes Metrics tab. Pure functions, no I/O.
//
// A missing sample is `null`, never 0: an empty Prometheus answer or a pod the
// Metrics API has not scraped yet does not mean the pod uses nothing. Percents
// are only given against a real reference (container limits, else requests,
// or node allocatable), are not clamped and have no visual floor.

const { parseCpu, parseMemory } = require('./kubeOverview');

function formatCpu(nano) {
  if (nano == null) return null;
  if (nano < 1e6) return `${Math.round(nano / 1000)}u`;
  if (nano < 1e9) return `${Math.round(nano / 1e6)}m`;
  return `${(nano / 1e9).toFixed(2)} cores`;
}

function formatBytes(bytes) {
  if (bytes == null) return null;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

function finiteOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** First value of a Prometheus instant vector, or null when there is no sample. */
function prometheusValue(body) {
  return finiteOrNull(body?.data?.result?.[0]?.value?.[1]);
}

/** Map pod name -> value from a `sum by (pod)` instant vector; pods without a sample are absent. */
function prometheusByPod(body) {
  const values = new Map();
  for (const series of body?.data?.result || []) {
    const pod = series.metric?.pod;
    const value = finiteOrNull(series.value?.[1]);
    if (pod && value != null) values.set(pod, (values.get(pod) || 0) + value);
  }
  return values;
}

function sumOrNull(values) {
  const present = values.filter(value => value != null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

// Containers that run for the pod's whole life; init containers do not count
// toward steady-state usage.
function podContainers(pod) {
  return pod?.spec?.containers || [];
}

/**
 * The reference a usage percent is measured against: the sum of container
 * limits when every container sets one, else the sum of requests when every
 * container sets one, else null (no percent is shown).
 */
function podsReference(pods = [], resource) {
  const parse = resource === 'cpu' ? parseCpu : parseMemory;
  const containers = pods.flatMap(podContainers);
  if (!containers.length) return null;
  for (const kind of ['limit', 'request']) {
    const field = kind === 'limit' ? 'limits' : 'requests';
    const values = containers.map(container => container.resources?.[field]?.[resource]);
    if (values.every(value => value != null && value !== '')) {
      const total = values.reduce((sum, value) => sum + parse(value), 0);
      if (total > 0) return { kind, value: total };
    }
  }
  return null;
}

/** Node allocatable (what pods can actually use), else capacity. */
function nodeReference(node, resource) {
  const parse = resource === 'cpu' ? parseCpu : parseMemory;
  const allocatable = node?.status?.allocatable?.[resource];
  if (allocatable) return { kind: 'allocatable', value: parse(allocatable) };
  const capacity = node?.status?.capacity?.[resource];
  if (capacity) return { kind: 'capacity', value: parse(capacity) };
  return null;
}

function percentOf(value, reference) {
  if (value == null || !reference?.value) return null;
  return Math.round((value / reference.value) * 1000) / 10;
}

function usageBlock(value, reference, format, unitKey) {
  return {
    available: value != null,
    [unitKey]: value,
    display: format(value),
    percent: percentOf(value, reference),
    reference: reference ? { kind: reference.kind, [unitKey]: reference.value, display: format(reference.value) } : null,
  };
}

function metricPayload({
  cpuNano = null,
  memoryBytes = null,
  cpuReference = null,
  memoryReference = null,
  coverage = null,
  items = [],
  containers = [],
  timestamp,
  window,
  source = 'metrics.k8s.io',
} = {}) {
  const cpu = usageBlock(cpuNano, cpuReference, formatCpu, 'nano');
  cpu.cores = cpuNano == null ? null : cpuNano / 1e9;
  return {
    timestamp,
    window,
    source,
    items,
    containers,
    coverage,
    cpu,
    memory: usageBlock(memoryBytes, memoryReference, formatBytes, 'bytes'),
  };
}

/** Per-pod usage from metrics.k8s.io items; pods the API has no sample for are null. */
function metricsApiUsage(pods, metricItems) {
  const byPod = new Map(metricItems.map(item => [item.metadata?.name, item]));
  const perPod = pods.map(pod => {
    const name = pod.metadata?.name;
    const item = byPod.get(name);
    if (!item) return { name, cpuNano: null, memoryBytes: null };
    const podContainerUsage = item.containers || [];
    return {
      name,
      cpuNano: podContainerUsage.reduce((sum, c) => sum + parseCpu(c.usage?.cpu), 0),
      memoryBytes: podContainerUsage.reduce((sum, c) => sum + parseMemory(c.usage?.memory), 0),
    };
  });
  return perPod;
}

/** Per-pod usage from `sum by (pod)` Prometheus answers (CPU in cores). */
function prometheusUsage(pods, cpuBody, memoryBody) {
  const cpu = prometheusByPod(cpuBody);
  const memory = prometheusByPod(memoryBody);
  return pods.map(pod => {
    const name = pod.metadata?.name;
    return {
      name,
      cpuNano: cpu.has(name) ? cpu.get(name) * 1e9 : null,
      memoryBytes: memory.has(name) ? memory.get(name) : null,
    };
  });
}

/** Payload for a set of pods from their per-pod usage. References only count sampled pods. */
function podsMetricPayload(pods, perPod, extra = {}) {
  const sampledNames = new Set(perPod.filter(p => p.cpuNano != null || p.memoryBytes != null).map(p => p.name));
  const sampledPods = pods.filter(pod => sampledNames.has(pod.metadata?.name));
  return metricPayload({
    ...extra,
    cpuNano: sumOrNull(perPod.map(p => p.cpuNano)),
    memoryBytes: sumOrNull(perPod.map(p => p.memoryBytes)),
    cpuReference: podsReference(sampledPods, 'cpu'),
    memoryReference: podsReference(sampledPods, 'memory'),
    coverage: { pods: pods.length, sampled: sampledNames.size },
    items: perPod.map(p => ({ name: p.name, cpu: formatCpu(p.cpuNano), memory: formatBytes(p.memoryBytes) })),
  });
}

module.exports = {
  formatBytes,
  formatCpu,
  metricPayload,
  metricsApiUsage,
  nodeReference,
  podsMetricPayload,
  podsReference,
  prometheusByPod,
  prometheusUsage,
  prometheusValue,
};
