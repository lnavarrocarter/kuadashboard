'use strict';

// PromQL and response parsing for the Kubernetes Overview. Pure functions:
// the server runs the queries through the Kubernetes API service proxy.

const RANGES = {
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
};
const TARGET_POINTS = 120;
const NAMESPACE_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function isValidNamespace(namespace) {
  return namespace === 'all' || (NAMESPACE_RE.test(namespace) && namespace.length <= 63);
}

/** Query window for a named range, with a step that yields ~120 points (min 30s). */
function rangeWindow(range, now = Date.now()) {
  const seconds = RANGES[range];
  if (!seconds) return null;
  const end = Math.floor(now / 1000);
  const step = Math.max(30, Math.round(seconds / TARGET_POINTS / 30) * 30);
  return { range, start: end - seconds, end, step };
}

// Container series exclude the pause container and cgroup roll-ups.
function containerScope(namespace) {
  const ns = namespace === 'all' ? '' : `namespace="${namespace}",`;
  return `${ns}container!="",container!="POD"`;
}

function podScope(namespace) {
  return namespace === 'all' ? '' : `{namespace="${namespace}"}`;
}

/**
 * Range series for the Overview charts. For the whole cluster CPU/memory come
 * from node-exporter (what the nodes really use), falling back to cAdvisor
 * container totals; a namespace only has container series.
 */
function timeseriesQueries(namespace, step) {
  const containers = containerScope(namespace);
  // increase() needs several scrapes, so the restart window never drops below 5 min.
  const windowSeconds = Math.max(step, 300);
  const window = `${windowSeconds}s`;
  const cpuContainers = `sum(rate(container_cpu_usage_seconds_total{${containers}}[5m]))`;
  const memoryContainers = `sum(container_memory_working_set_bytes{${containers}})`;
  const scope = podScope(namespace);
  return {
    cpu: {
      unit: 'cores',
      query: namespace === 'all' ? `sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) or ${cpuContainers}` : cpuContainers,
    },
    memory: {
      unit: 'bytes',
      query: namespace === 'all' ? `sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) or ${memoryContainers}` : memoryContainers,
    },
    restarts: {
      unit: 'count',
      windowSeconds,
      query: `sum(increase(kube_pod_container_status_restarts_total${scope}[${window}]))`,
    },
    notReady: {
      unit: 'count',
      query: namespace === 'all'
        ? 'sum(kube_pod_status_ready{condition="false"})'
        : `sum(kube_pod_status_ready{namespace="${namespace}",condition="false"})`,
    },
  };
}

/** Instant per-node usage, keyed by node name via node_uname_info. */
function nodeUsageQueries() {
  const byNode = expr => `sum by (nodename) (${expr} * on(instance) group_left(nodename) node_uname_info)`;
  return {
    cpu: byNode('rate(node_cpu_seconds_total{mode!="idle"}[5m])'),
    memory: byNode('(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)'),
  };
}

// PromQL string literals use Go escapes: a regex escape such as `\.` must be
// written `\\.` inside the quotes, or Prometheus rejects the query (400).
function promString(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Regex matcher value for a list of literal names (pod=~"a|b"), escaped for PromQL. */
function promRegexOf(values = []) {
  return promString(values.map(value => String(value).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')).join('|'));
}

/**
 * Usage queries for one node. node-exporter labels `instance` with IP:port, not
 * the node name, so the node is matched through node_uname_info's nodename.
 * cAdvisor (container usage on the node) is the fallback when node-exporter is
 * not scraped; it leaves out system processes, so callers name the source.
 */
function nodeQueries(name) {
  const node = promString(name);
  const byNode = expr => `sum(${expr} * on(instance) group_left(nodename) node_uname_info{nodename="${node}"})`;
  const containers = `node="${node}",container!="",container!="POD"`;
  return {
    nodeExporter: {
      cpu: byNode('rate(node_cpu_seconds_total{mode!="idle"}[5m])'),
      memory: byNode('(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)'),
    },
    cadvisor: {
      cpu: `sum(rate(container_cpu_usage_seconds_total{${containers}}[5m]))`,
      memory: `sum(container_memory_working_set_bytes{${containers}})`,
    },
  };
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** First series of a range query as [{ t: epochMs, v }]; NaN samples are dropped. */
function parseMatrix(body) {
  const values = body?.data?.result?.[0]?.values || [];
  return values
    .map(([t, v]) => ({ t: Math.round(Number(t) * 1000), v: toNumber(v) }))
    .filter(point => point.v !== null);
}

/** Instant vector as Map(labelValue -> number). */
function parseVectorBy(body, label) {
  const map = new Map();
  for (const item of body?.data?.result || []) {
    const key = item.metric?.[label];
    const value = toNumber(item.value?.[1]);
    if (key && value !== null) map.set(key, value);
  }
  return map;
}

/**
 * Converts per-node Prometheus usage into metrics.k8s.io NodeMetrics shape so
 * the Overview summarizes it exactly like metrics-server data.
 */
function nodeMetricsFromPrometheus(cpuBody, memoryBody) {
  const cpu = parseVectorBy(cpuBody, 'nodename');
  const memory = parseVectorBy(memoryBody, 'nodename');
  return [...cpu.keys()].filter(name => memory.has(name)).map(name => ({
    metadata: { name },
    usage: { cpu: String(cpu.get(name)), memory: String(Math.round(memory.get(name))) },
  }));
}

function summarizeSeries(points) {
  if (!points.length) return { latest: null, max: null, avg: null };
  const values = points.map(p => p.v);
  return {
    latest: values.at(-1),
    max: Math.max(...values),
    avg: values.reduce((sum, v) => sum + v, 0) / values.length,
  };
}

module.exports = {
  RANGES,
  isValidNamespace,
  rangeWindow,
  timeseriesQueries,
  nodeUsageQueries,
  nodeQueries,
  promRegexOf,
  promString,
  parseMatrix,
  parseVectorBy,
  nodeMetricsFromPrometheus,
  summarizeSeries,
};
