'use strict';

// Aggregation for the Kubernetes Overview: turns raw Kubernetes API objects
// into pod/node/workload/event health summaries. Pure functions, no I/O.

function parseCpu(value = '0') {
  const raw = String(value);
  const num = parseFloat(raw);
  if (Number.isNaN(num)) return 0;
  if (raw.endsWith('n')) return num;
  if (raw.endsWith('u')) return num * 1000;
  if (raw.endsWith('m')) return num * 1e6;
  return num * 1e9;
}

function parseMemory(value = '0') {
  const raw = String(value);
  const num = parseFloat(raw);
  if (Number.isNaN(num)) return 0;
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1000, M: 1000 ** 2, G: 1000 ** 3, T: 1000 ** 4 };
  const unit = raw.replace(String(num), '');
  return num * (units[unit] || 1);
}

// Waiting reasons that are part of a normal start-up, not a problem.
const STARTING_REASONS = new Set(['ContainerCreating', 'PodInitializing']);
const PHASES = ['Running', 'Pending', 'Succeeded', 'Failed', 'Unknown'];

/** Why a pod is unhealthy, as kubectl would show it (e.g. CrashLoopBackOff), or null. */
function podProblem(pod = {}) {
  const status = pod.status || {};
  if (status.phase === 'Succeeded') return null;
  const containers = [...(status.initContainerStatuses || []), ...(status.containerStatuses || [])];
  for (const c of containers) {
    const reason = c.state?.waiting?.reason;
    if (reason && !STARTING_REASONS.has(reason)) return reason;
  }
  for (const c of containers) {
    const terminated = c.state?.terminated;
    if (terminated && terminated.reason !== 'Completed') return terminated.reason || 'Error';
  }
  if (status.phase === 'Failed') return status.reason || 'Failed';
  const conditions = status.conditions || [];
  const scheduled = conditions.find(cond => cond.type === 'PodScheduled');
  if (status.phase === 'Pending' && scheduled?.status === 'False') return scheduled.reason || 'Unschedulable';
  // Running but failing its readiness probe (kubectl shows Running 0/1).
  const ready = conditions.find(cond => cond.type === 'Ready');
  if (status.phase === 'Running' && ready?.status === 'False' && !pod.metadata?.deletionTimestamp) return 'NotReady';
  return null;
}

function podRestarts(pod = {}) {
  return (pod.status?.containerStatuses || []).reduce((sum, c) => sum + (c.restartCount || 0), 0);
}

function summarizePods(pods = [], { limit = 10 } = {}) {
  const phases = Object.fromEntries(PHASES.map(phase => [phase, 0]));
  const reasons = {};
  const problems = [];
  let restarts = 0;
  let ready = 0;
  for (const pod of pods) {
    const phase = PHASES.includes(pod.status?.phase) ? pod.status.phase : 'Unknown';
    phases[phase] += 1;
    const containers = pod.status?.containerStatuses || [];
    if (phase === 'Running' && containers.length && containers.every(c => c.ready)) ready += 1;
    const podRestartCount = podRestarts(pod);
    restarts += podRestartCount;
    const reason = podProblem(pod);
    if (!reason) continue;
    reasons[reason] = (reasons[reason] || 0) + 1;
    problems.push({ name: pod.metadata?.name, namespace: pod.metadata?.namespace, reason, restarts: podRestartCount });
  }
  problems.sort((a, b) => b.restarts - a.restarts || String(a.name).localeCompare(String(b.name)));
  return {
    total: pods.length,
    ready,
    restarts,
    phases,
    reasons,
    problemCount: problems.length,
    problems: problems.slice(0, limit),
  };
}

const PRESSURE_CONDITIONS = ['MemoryPressure', 'DiskPressure', 'PIDPressure', 'NetworkUnavailable'];

function nodeRoles(node = {}) {
  return Object.keys(node.metadata?.labels || {})
    .filter(label => label.startsWith('node-role.kubernetes.io/'))
    .map(label => label.replace('node-role.kubernetes.io/', ''))
    .join(', ') || 'worker';
}

function percent(used, total) {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : null;
}

/** usage: optional metrics.k8s.io NodeMetrics items; omitted when the Metrics API is unavailable. */
function summarizeNodes(nodes = [], usage = null) {
  const usageByName = new Map((usage || []).map(item => [item.metadata?.name, item.usage || {}]));
  const pressure = Object.fromEntries(PRESSURE_CONDITIONS.map(type => [type, 0]));
  const totals = { cpuAllocatable: 0, memoryAllocatable: 0, cpuUsed: 0, memoryUsed: 0 };
  const items = nodes.map(node => {
    const conditions = node.status?.conditions || [];
    const ready = conditions.find(c => c.type === 'Ready')?.status === 'True';
    const pressures = PRESSURE_CONDITIONS.filter(type => conditions.find(c => c.type === type)?.status === 'True');
    pressures.forEach(type => { pressure[type] += 1; });
    const allocatable = node.status?.allocatable || node.status?.capacity || {};
    const cpuAllocatable = parseCpu(allocatable.cpu);
    const memoryAllocatable = parseMemory(allocatable.memory);
    totals.cpuAllocatable += cpuAllocatable;
    totals.memoryAllocatable += memoryAllocatable;
    const nodeUsage = usageByName.get(node.metadata?.name);
    let cpu = null;
    let memory = null;
    if (nodeUsage) {
      const cpuUsed = parseCpu(nodeUsage.cpu);
      const memoryUsed = parseMemory(nodeUsage.memory);
      totals.cpuUsed += cpuUsed;
      totals.memoryUsed += memoryUsed;
      cpu = { usedNano: cpuUsed, allocatableNano: cpuAllocatable, percent: percent(cpuUsed, cpuAllocatable) };
      memory = { usedBytes: memoryUsed, allocatableBytes: memoryAllocatable, percent: percent(memoryUsed, memoryAllocatable) };
    }
    return {
      name: node.metadata?.name,
      ready,
      cordoned: !!node.spec?.unschedulable,
      roles: nodeRoles(node),
      version: node.status?.nodeInfo?.kubeletVersion || '-',
      pressures,
      cpu,
      memory,
    };
  });
  items.sort((a, b) => Number(a.ready) - Number(b.ready) || b.pressures.length - a.pressures.length || String(a.name).localeCompare(String(b.name)));
  const hasUsage = usageByName.size > 0;
  return {
    total: items.length,
    ready: items.filter(n => n.ready).length,
    notReady: items.filter(n => !n.ready).length,
    cordoned: items.filter(n => n.cordoned).length,
    pressure,
    usage: hasUsage ? {
      cpu: { usedNano: totals.cpuUsed, allocatableNano: totals.cpuAllocatable, percent: percent(totals.cpuUsed, totals.cpuAllocatable) },
      memory: { usedBytes: totals.memoryUsed, allocatableBytes: totals.memoryAllocatable, percent: percent(totals.memoryUsed, totals.memoryAllocatable) },
    } : null,
    items,
  };
}

function workloadReadiness(kind, item = {}) {
  if (kind === 'daemonsets') return { ready: item.status?.numberReady ?? 0, desired: item.status?.desiredNumberScheduled ?? 0 };
  return { ready: item.status?.readyReplicas ?? 0, desired: item.spec?.replicas ?? 0 };
}

function summarizeWorkloads(workloads = {}, { limit = 10 } = {}) {
  const summary = {};
  for (const [kind, items] of Object.entries(workloads)) {
    const notReady = [];
    let scaledToZero = 0;
    for (const item of items || []) {
      const { ready, desired } = workloadReadiness(kind, item);
      if (desired === 0 && kind !== 'daemonsets') scaledToZero += 1;
      if (ready < desired) notReady.push({ name: item.metadata?.name, namespace: item.metadata?.namespace, ready, desired });
    }
    notReady.sort((a, b) => (a.ready / a.desired) - (b.ready / b.desired) || String(a.name).localeCompare(String(b.name)));
    summary[kind] = { total: (items || []).length, notReady: notReady.length, scaledToZero, items: notReady.slice(0, limit) };
  }
  return summary;
}

function eventTime(evt = {}) {
  return evt.lastTimestamp || evt.series?.lastObservedTime || evt.eventTime || evt.firstTimestamp || evt.metadata?.creationTimestamp || null;
}

/** Warning events seen within the window, newest first. */
function summarizeEvents(events = [], { now = Date.now(), windowMs = 60 * 60 * 1000, limit = 8 } = {}) {
  const since = now - windowMs;
  const warnings = events
    .filter(evt => evt.type === 'Warning')
    .map(evt => ({ evt, time: eventTime(evt) }))
    .filter(({ time }) => time && new Date(time).getTime() >= since)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  const reasons = {};
  warnings.forEach(({ evt }) => { reasons[evt.reason || 'Unknown'] = (reasons[evt.reason || 'Unknown'] || 0) + 1; });
  return {
    windowMinutes: Math.round(windowMs / 60000),
    warnings: warnings.length,
    reasons,
    recent: warnings.slice(0, limit).map(({ evt, time }) => ({
      namespace: evt.metadata?.namespace || evt.involvedObject?.namespace,
      reason: evt.reason || 'Unknown',
      object: evt.involvedObject ? `${evt.involvedObject.kind}/${evt.involvedObject.name}` : '-',
      message: evt.message || evt.note || '',
      count: evt.count || evt.series?.count || 1,
      lastTimestamp: time,
    })),
  };
}

function sectionError(err) {
  const status = err?.statusCode || err?.response?.statusCode;
  const body = typeof err?.body === 'string' ? err.body.trim() : err?.body?.message;
  const message = body || err?.message || String(err);
  if (status === 403) return `Forbidden: ${message}`;
  if (status === 404) return `Not found (HTTP 404): ${message}`;
  return status && !message.includes(String(status)) ? `HTTP ${status}: ${message}` : message;
}

/**
 * Builds the Overview payload. Each source is a settled result
 * ({ ok: true, value: items } | { ok: false, error }) so one failing list
 * (e.g. RBAC on nodes) degrades only its own section.
 */
function buildOverview({ namespace = 'all', sources = {}, metricsSource = 'metrics.k8s.io', prometheus = null, now = Date.now() } = {}) {
  const section = (result, summarize) => (result?.ok ? summarize(result.value) : { error: sectionError(result?.error) });
  const metricsOk = !!sources.nodeMetrics?.ok;
  const workloadKinds = ['deployments', 'statefulsets', 'daemonsets'];
  const failedWorkload = workloadKinds.find(kind => sources[kind] && !sources[kind].ok);
  return {
    namespace,
    generatedAt: new Date(now).toISOString(),
    pods: section(sources.pods, summarizePods),
    nodes: section(sources.nodes, nodes => summarizeNodes(nodes, metricsOk ? sources.nodeMetrics.value : null)),
    workloads: failedWorkload
      ? { error: sectionError(sources[failedWorkload].error) }
      : summarizeWorkloads(Object.fromEntries(workloadKinds.map(kind => [kind, sources[kind]?.value || []]))),
    events: section(sources.events, events => summarizeEvents(events, { now })),
    metrics: metricsOk
      ? { available: true, source: metricsSource }
      : { available: false, error: sources.nodeMetrics ? sectionError(sources.nodeMetrics.error) : 'Not requested' },
    prometheus: prometheus || { available: false },
  };
}

module.exports = {
  parseCpu,
  parseMemory,
  podProblem,
  summarizePods,
  summarizeNodes,
  summarizeWorkloads,
  summarizeEvents,
  buildOverview,
};
