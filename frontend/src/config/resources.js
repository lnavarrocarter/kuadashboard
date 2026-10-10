// Resource table column / row / action definitions
//
// Optional per resource:
//   rowClass(row) → extra CSS class for the <tr> (e.g. colour coding)
//   facet         → { label, value(row), options: [{ value, label }] } renders
//                   toggle chips with counts in the toolbar to filter rows
//   quickFilters  → [{ id, label, test(row) }] one-click chips (label is an
//                   i18n key); active chips
//                   narrow the rows together (AND)

import { SEVERITIES, eventSeverity, severityLabel, severityOrder } from './eventSeverity'

// Node capacity comes as raw quantities ("16073388Ki", "4"): show GiB and cores.
function capacityText(value, kind) {
  if (value == null || value === '' || value === '-') return '-'
  const raw = String(value)
  if (kind === 'cpu') {
    const cores = raw.endsWith('m') ? parseFloat(raw) / 1000 : parseFloat(raw)
    return Number.isFinite(cores) ? { text: `${cores} cores`, sort: cores } : raw
  }
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1e3, M: 1e6, G: 1e9 }
  const unit = raw.replace(/^[\d.]+/, '')
  const bytes = parseFloat(raw) * (units[unit] || 1)
  return Number.isFinite(bytes) ? { text: `${(bytes / 1024 ** 3).toFixed(1)} GiB`, sort: bytes } : raw
}

export function age(ts) {
  if (!ts) return '-'
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(ts)) / 1000))
  const days = Math.floor(diffSeconds / 86400)
  const hours = Math.floor((diffSeconds % 86400) / 3600)
  const minutes = Math.floor((diffSeconds % 3600) / 60)
  const seconds = diffSeconds % 60
  // kubectl-style units (7d 9h, 12m, 30s) read the same in every language.
  const parts = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes && !days) parts.push(`${minutes}m`)
  if (!parts.length) parts.push(`${seconds}s`)
  return { text: parts.join(' '), sort: diffSeconds }
}

const yamlOnly = (type, clusterScoped = false) => r => [
  { icon: 'file-code-2', label: 'YAML', cls: 'blue', fn: 'viewYaml', args: [type, clusterScoped ? null : r.namespace, r.name] },
]

// "3/5" style readiness → true when fewer ready than desired.
function notReady(ready) {
  const [have, want] = String(ready ?? '').split('/').map(Number)
  return Number.isFinite(have) && Number.isFinite(want) && have < want
}

const WORKLOAD_QUICK_FILTERS = [
  { id: 'not-ready', label: 'quick.notReady', test: r => notReady(r.ready) },
  { id: 'scaled-zero', label: 'quick.scaledToZero', test: r => r.replicas === 0 },
]

export const RESOURCES = {
  pods: {
    title: 'Pods',
    cols:  ['Name', 'Namespace', 'Status', 'Ready', 'Restarts', 'Ports', 'Env', 'Age', 'Node'],
    row:   r => [r.name, r.namespace, { badge: r.reason || r.status }, r.ready, r.restarts, r.ports || '-', r.envCount ?? 0, age(r.age), r.nodeName],
    quickFilters: [
      { id: 'problems', label: 'quick.problems', test: r => !!r.reason },
      { id: 'not-running', label: 'quick.notRunning', test: r => !['Running', 'Succeeded'].includes(r.status) },
      { id: 'not-ready', label: 'quick.notReady', test: r => r.status === 'Running' && notReady(r.ready) },
      { id: 'recent-restarts', label: 'quick.restartedLastHour', test: r => !!r.lastRestartAt && Date.now() - r.lastRestartAt < 3600000 },
      { id: 'restarts', label: 'quick.withRestarts', test: r => Number(r.restarts) > 0 },
    ],
    actions: r => [
      ...(r.rawPorts?.length ? [{ icon: 'cable', label: 'Tunnel', cls: 'green', fn: 'openPortForward', args: [r.namespace, r.name, r.rawPorts, 'pods'] }] : []),
      { icon: 'scroll',     label: 'Logs',   cls: 'blue',  fn: 'viewLogs',   args: [r.namespace, r.name, r.containers] },
      { icon: 'terminal',   label: 'Shell',  cls: 'green', fn: 'openExec',   args: [r.namespace, r.name, r.containers] },
      { icon: 'file-code-2',label: 'YAML',   cls: 'blue',  fn: 'viewYaml',   args: ['pods', r.namespace, r.name] },
      { icon: 'trash-2',    label: 'Delete', cls: 'red',   fn: 'confirmDelete', args: ['pods', r.namespace, r.name] },
    ],
  },
  deployments: {
    title: 'Deployments',
    cols:  ['Name', 'Namespace', 'Ready', 'Replicas', 'Containers', 'Ports', 'Env', 'Age'],
    row:   r => [r.name, r.namespace, r.ready, r.replicas, r.containers?.join(', ') || '-', r.ports || '-', r.envCount ?? 0, age(r.age)],
    quickFilters: WORKLOAD_QUICK_FILTERS,
    actions: r => [
      { icon: 'scroll',      label: 'Logs',    cls: 'blue',  fn: 'viewLogs',       args: [r.namespace, r.name, r.containers, 'deployments'] },
      { icon: 'rotate-ccw',  label: 'Restart', cls: 'green', fn: 'restart',       args: ['deployments', r.namespace, r.name] },
      { icon: 'layers',      label: 'Scale',   cls: 'blue',  fn: 'openScale',      args: ['deployments', r.namespace, r.name, r.replicas] },
      { icon: 'file-code-2', label: 'YAML',    cls: 'blue',  fn: 'viewYaml',       args: ['deployments', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete',  cls: 'red',   fn: 'confirmDelete',  args: ['deployments', r.namespace, r.name] },
    ],
  },
  statefulsets: {
    title: 'StatefulSets',
    cols:  ['Name', 'Namespace', 'Ready', 'Replicas', 'Containers', 'Ports', 'Env', 'Age'],
    row:   r => [r.name, r.namespace, r.ready, r.replicas, r.containers?.join(', ') || '-', r.ports || '-', r.envCount ?? 0, age(r.age)],
    quickFilters: WORKLOAD_QUICK_FILTERS,
    actions: r => [
      { icon: 'scroll',      label: 'Logs',    cls: 'blue',  fn: 'viewLogs',      args: [r.namespace, r.name, r.containers, 'statefulsets'] },
      { icon: 'rotate-ccw',  label: 'Restart', cls: 'green', fn: 'restart',      args: ['statefulsets', r.namespace, r.name] },
      { icon: 'layers',      label: 'Scale',   cls: 'blue',  fn: 'openScale',    args: ['statefulsets', r.namespace, r.name, r.replicas] },
      { icon: 'file-code-2', label: 'YAML',    cls: 'blue',  fn: 'viewYaml',     args: ['statefulsets', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete',  cls: 'red',   fn: 'confirmDelete',args: ['statefulsets', r.namespace, r.name] },
    ],
  },
  daemonsets: {
    title: 'DaemonSets',
    cols:  ['Name', 'Namespace', 'Ready', 'Containers', 'Ports', 'Env', 'Age'],
    row:   r => [r.name, r.namespace, r.ready, r.containers?.join(', ') || '-', r.ports || '-', r.envCount ?? 0, age(r.age)],
    quickFilters: [{ id: 'not-ready', label: 'quick.notReady', test: r => r.ready < r.desired }],
    actions: r => [
      { icon: 'scroll',      label: 'Logs',    cls: 'blue',  fn: 'viewLogs',      args: [r.namespace, r.name, r.containers, 'daemonsets'] },
      { icon: 'rotate-ccw',  label: 'Restart', cls: 'green', fn: 'restart',      args: ['daemonsets', r.namespace, r.name] },
      { icon: 'file-code-2', label: 'YAML',    cls: 'blue',  fn: 'viewYaml',     args: ['daemonsets', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete',  cls: 'red',   fn: 'confirmDelete',args: ['daemonsets', r.namespace, r.name] },
    ],
  },
  replicasets: {
    title: 'ReplicaSets',
    cols: ['Name', 'Namespace', 'Desired', 'Current', 'Ready', 'Owner', 'Age'],
    row: r => [r.name, r.namespace, r.desired, r.current, r.ready, r.owner, age(r.age)],
    quickFilters: [
      { id: 'inactive', label: 'quick.inactive', test: r => Number(r.desired) === 0 },
      { id: 'not-ready', label: 'quick.notReady', test: r => Number(r.ready) < Number(r.desired) },
    ],
    actions: yamlOnly('replicasets'),
  },
  jobs: {
    title: 'Jobs',
    cols: ['Name', 'Namespace', 'Completions', 'Active', 'Failed', 'Age'],
    row: r => [r.name, r.namespace, r.completions, r.active, r.failed, age(r.age)],
    quickFilters: [
      { id: 'failed', label: 'quick.failed', test: r => Number(r.failed) > 0 },
      { id: 'active', label: 'quick.active', test: r => Number(r.active) > 0 },
      { id: 'complete', label: 'quick.completed', test: r => !Number(r.active) && !notReady(r.completions) },
    ],
    actions: yamlOnly('jobs'),
  },
  cronjobs: {
    title: 'CronJobs',
    cols: ['Name', 'Namespace', 'Schedule', 'Suspend', 'Active', 'Last Schedule', 'Age'],
    row: r => [r.name, r.namespace, r.schedule, r.suspend, r.active, r.lastSchedule, age(r.age)],
    quickFilters: [
      { id: 'suspended', label: 'quick.suspended', test: r => r.suspend === 'Yes' },
      { id: 'active', label: 'quick.running', test: r => Number(r.active) > 0 },
      { id: 'never-ran', label: 'quick.neverRan', test: r => !r.lastSchedule || r.lastSchedule === '-' },
    ],
    actions: yamlOnly('cronjobs'),
  },
  services: {
    title: 'Services',
    cols:  ['Name', 'Namespace', 'App', 'Type', 'Cluster IP', 'Backend IPs', 'Ports', 'Age'],
    row:   r => [r.name, r.namespace, r.app || '-', r.type, r.clusterIP, { truncate: r.backendIPs || '-', max: 48 }, r.ports, age(r.age)],
    quickFilters: [
      { id: 'no-backends', label: 'quick.noBackends', test: r => r.type !== 'ExternalName' && r.backendIPs === '-' },
      { id: 'load-balancer', label: 'quick.loadBalancer', test: r => r.type === 'LoadBalancer' },
    ],
    actions: r => [
      { icon: 'cable',       label: 'Forward', cls: 'green', fn: 'openPortForward', args: [r.namespace, r.name, r.rawPorts] },
      { icon: 'file-code-2', label: 'YAML',    cls: 'blue',  fn: 'viewYaml',        args: ['services', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete',  cls: 'red',   fn: 'confirmDelete',   args: ['services', r.namespace, r.name] },
    ],
  },
  ingresses: {
    title: 'Ingresses',
    cols:  ['Name', 'Namespace', 'Class', 'Hosts', 'Paths', 'ELB', 'URL', 'Age'],
    row:   r => [r.name, r.namespace, r.class, { truncate: r.hosts, max: 42 }, { truncate: r.paths, max: 64 }, { truncate: r.address, max: 46 }, { link: r.url, text: r.url, max: 52 }, age(r.age)],
    quickFilters: [
      { id: 'no-address', label: 'quick.noAddress', test: r => !r.address || r.address === '-' },
      { id: 'no-class', label: 'quick.noClass', test: r => !r.class || r.class === '-' },
    ],
    actions: r => [
      ...(r.url && r.url !== '-' ? [{ icon: 'external-link', label: 'Open URL', cls: 'green', fn: 'openExternal', args: [r.url] }] : []),
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['ingresses', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['ingresses', r.namespace, r.name] },
    ],
  },
  endpointslices: {
    title: 'EndpointSlices',
    cols: ['Name', 'Namespace', 'Address Type', 'Endpoints', 'Ports', 'Age'],
    row: r => [r.name, r.namespace, r.addressType, r.endpoints, r.ports, age(r.age)],
    quickFilters: [{ id: 'empty', label: 'quick.noEndpoints', test: r => Number(r.endpoints) === 0 }],
    actions: yamlOnly('endpointslices'),
  },
  endpoints: {
    title: 'Endpoints',
    cols: ['Name', 'Namespace', 'Endpoints', 'Ports', 'Age'],
    row: r => [r.name, r.namespace, r.endpoints, r.ports, age(r.age)],
    quickFilters: [{ id: 'empty', label: 'quick.noEndpoints', test: r => Number(r.endpoints) === 0 }],
    actions: yamlOnly('endpoints'),
  },
  ingressclasses: {
    title: 'IngressClasses',
    cols: ['Name', 'Controller', 'Parameters', 'Age'],
    row: r => [r.name, r.controller, r.parameters, age(r.age)],
    actions: yamlOnly('ingressclasses', true),
  },
  networkpolicies: {
    title: 'NetworkPolicies',
    cols: ['Name', 'Namespace', 'Pod Selector', 'Types', 'Ingress', 'Egress', 'Age'],
    row: r => [r.name, r.namespace, { truncate: r.podSelector, max: 48 }, r.types, r.ingress, r.egress, age(r.age)],
    quickFilters: [
      { id: 'deny-ingress', label: 'quick.denyIngress', test: r => String(r.types).includes('Ingress') && Number(r.ingress) === 0 },
      { id: 'deny-egress', label: 'quick.denyEgress', test: r => String(r.types).includes('Egress') && Number(r.egress) === 0 },
      { id: 'all-pods', label: 'quick.wholeNamespace', test: r => !r.podSelector || r.podSelector === '-' || r.podSelector === '{}' },
    ],
    actions: yamlOnly('networkpolicies'),
  },
  configmaps: {
    title: 'ConfigMaps',
    cols:  ['Name', 'Namespace', 'Keys', 'Age'],
    row:   r => [r.name, r.namespace, r.keys, age(r.age)],
    quickFilters: [{ id: 'empty', label: 'quick.empty', test: r => Number(r.keys) === 0 }],
    actions: r => [
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['configmaps', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['configmaps', r.namespace, r.name] },
    ],
  },
  secrets: {
    title: 'Secrets',
    cols:  ['Name', 'Namespace', 'Type', 'Keys', 'Age'],
    row:   r => [r.name, r.namespace, r.type, r.keys, age(r.age)],
    quickFilters: [
      { id: 'tls', label: 'quick.tls', test: r => r.type === 'kubernetes.io/tls' },
      { id: 'registry', label: 'quick.registry', test: r => String(r.type).startsWith('kubernetes.io/docker') },
      { id: 'opaque', label: 'quick.opaque', test: r => r.type === 'Opaque' },
      { id: 'empty', label: 'quick.empty', test: r => Number(r.keys) === 0 },
    ],
    actions: r => [
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['secrets', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['secrets', r.namespace, r.name] },
    ],
  },
  resourcequotas: {
    title: 'ResourceQuotas',
    cols: ['Name', 'Namespace', 'Hard', 'Used', 'Age'],
    row: r => [r.name, r.namespace, { truncate: r.hard, max: 48 }, { truncate: r.used, max: 48 }, age(r.age)],
    actions: yamlOnly('resourcequotas'),
  },
  limitranges: {
    title: 'LimitRanges',
    cols: ['Name', 'Namespace', 'Types', 'Items', 'Age'],
    row: r => [r.name, r.namespace, r.types, r.items, age(r.age)],
    actions: yamlOnly('limitranges'),
  },
  hpas: {
    title: 'HorizontalPodAutoscalers',
    cols: ['Name', 'Namespace', 'Target', 'Min', 'Max', 'Current', 'Age'],
    row: r => [r.name, r.namespace, r.target, r.min, r.max, r.current, age(r.age)],
    quickFilters: [
      { id: 'at-max', label: 'quick.atMax', test: r => Number.isFinite(Number(r.max)) && Number(r.current) >= Number(r.max) },
      { id: 'at-min', label: 'quick.atMin', test: r => Number.isFinite(Number(r.min)) && Number(r.current) <= Number(r.min) },
    ],
    actions: yamlOnly('hpas'),
  },
  pdbs: {
    title: 'PodDisruptionBudgets',
    cols: ['Name', 'Namespace', 'Min Available', 'Max Unavailable', 'Allowed', 'Age'],
    row: r => [r.name, r.namespace, r.minAvailable, r.maxUnavailable, r.allowed, age(r.age)],
    quickFilters: [{ id: 'blocking', label: 'quick.blockingEvictions', test: r => Number(r.allowed) === 0 }],
    actions: yamlOnly('pdbs'),
  },
  priorityclasses: {
    title: 'PriorityClasses',
    cols: ['Name', 'Value', 'Global Default', 'Description', 'Age'],
    row: r => [r.name, r.value, r.globalDefault, { truncate: r.description, max: 48 }, age(r.age)],
    actions: yamlOnly('priorityclasses', true),
  },
  runtimeclasses: {
    title: 'RuntimeClasses',
    cols: ['Name', 'Handler', 'Overhead', 'Scheduling', 'Age'],
    row: r => [r.name, r.handler, r.overhead, r.scheduling, age(r.age)],
    actions: yamlOnly('runtimeclasses', true),
  },
  leases: {
    title: 'Leases',
    cols: ['Name', 'Namespace', 'Holder', 'Renew Time', 'Age'],
    row: r => [r.name, r.namespace, { truncate: r.holder, max: 48 }, r.renewTime, age(r.age)],
    quickFilters: [{ id: 'no-holder', label: 'quick.noHolder', test: r => !r.holder || r.holder === '-' }],
    actions: yamlOnly('leases'),
  },
  mutatingwebhookconfigurations: {
    title: 'MutatingWebhookConfigurations',
    cols: ['Name', 'Webhooks', 'Age'],
    row: r => [r.name, r.webhooks, age(r.age)],
    actions: yamlOnly('mutatingwebhookconfigurations', true),
  },
  validatingwebhookconfigurations: {
    title: 'ValidatingWebhookConfigurations',
    cols: ['Name', 'Webhooks', 'Age'],
    row: r => [r.name, r.webhooks, age(r.age)],
    actions: yamlOnly('validatingwebhookconfigurations', true),
  },
  pvcs: {
    title: 'PersistentVolumeClaims',
    cols:  ['Name', 'Namespace', 'Status', 'Capacity', 'Storage Class', 'Age'],
    row:   r => [r.name, r.namespace, { badge: r.status }, r.capacity, r.storageClass, age(r.age)],
    quickFilters: [{ id: 'not-bound', label: 'quick.notBound', test: r => r.status !== 'Bound' }],
    actions: r => [
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['pvcs', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['pvcs', r.namespace, r.name] },
    ],
  },
  pvs: {
    title: 'PersistentVolumes',
    cols: ['Name', 'Status', 'Capacity', 'Storage Class', 'Reclaim', 'Claim', 'Age'],
    row: r => [r.name, { badge: r.status }, r.capacity, r.storageClass, r.reclaimPolicy, r.claim, age(r.age)],
    quickFilters: [
      { id: 'not-bound', label: 'quick.notBound', test: r => r.status !== 'Bound' },
      { id: 'released', label: 'quick.released', test: r => r.status === 'Released' },
    ],
    actions: yamlOnly('pvs', true),
  },
  storageclasses: {
    title: 'StorageClasses',
    cols: ['Name', 'Provisioner', 'Reclaim', 'Binding Mode', 'Age'],
    row: r => [r.name, r.provisioner, r.reclaimPolicy, r.volumeBindingMode, age(r.age)],
    actions: yamlOnly('storageclasses', true),
  },
  namespaces: {
    title: 'Namespaces',
    cols: ['Name', 'Status', 'Age'],
    row: r => [r.name, { badge: r.status }, age(r.age)],
    quickFilters: [{ id: 'not-active', label: 'quick.notActive', test: r => r.status !== 'Active' }],
    actions: yamlOnly('namespaces', true),
  },
  nodes: {
    title: 'Nodes',
    cols:  ['Name', 'Status', 'Roles', 'Version', 'OS', 'CPU', 'Memory', 'Age'],
    colLabels: [null, null, null, null, null, 'col.cpuCapacity', 'col.memoryCapacity', null],
    row:   r => [r.name, { badge: r.unschedulable ? 'Cordoned' : r.status }, r.roles, r.version, r.os, capacityText(r.cpu, 'cpu'), capacityText(r.memory, 'memory'), age(r.age)],
    quickFilters: [
      { id: 'not-ready', label: 'quick.nodeNotReady', test: r => r.status !== 'Ready' },
      { id: 'cordoned', label: 'quick.cordoned', test: r => !!r.unschedulable },
    ],
    actions: r => [
      r.unschedulable
        ? { icon: 'unlock',           label: 'Uncordon', cls: 'green', fn: 'cordonNode', args: [r.name, false] }
        : { icon: 'lock',             label: 'Cordon',   cls: 'blue',  fn: 'cordonNode', args: [r.name, true] },
      { icon: 'arrow-down-to-line', label: 'Drain',    cls: 'blue',  fn: 'confirmDrain', args: [r.name] },
      { icon: 'file-code-2',        label: 'YAML',     cls: 'blue',  fn: 'viewYaml',     args: ['nodes', null, r.name] },
    ],
  },
  events: {
    title: 'Events',
    cols:  ['Severity', 'Namespace', 'Type', 'Reason', 'Object', 'Count', 'Message', 'First seen', 'Age'],
    // Severity is KUA's reading of the reason; Type is what Kubernetes reported.
    colLabels: ['col.kuaSeverity', null, 'col.k8sType', null, null, 'col.repetitions', null, 'col.firstSeen', 'col.lastSeen'],
    colHelp: ['events.severityHelp', null, 'events.typeHelp', null, null, 'events.countHelp', null, null, 'events.lastSeenHelp'],
    row:   r => {
      const sev = eventSeverity(r)
      return [{ badge: severityLabel(sev), sort: severityOrder(sev) }, r.namespace, r.type, r.reason, r.object, r.count,
              { truncate: r.message, max: 80 }, age(r.firstTimestamp), age(r.age)]
    },
    rowClass: r => `sev-row sev-${eventSeverity(r)}`,
    facet: { label: 'Severity', value: eventSeverity, options: SEVERITIES },
    actions: () => [],
  },
}
