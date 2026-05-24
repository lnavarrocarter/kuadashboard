// Resource table column / row / action definitions

export function age(ts) {
  if (!ts) return '-'
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(ts)) / 1000))
  const days = Math.floor(diffSeconds / 86400)
  const hours = Math.floor((diffSeconds % 86400) / 3600)
  const minutes = Math.floor((diffSeconds % 3600) / 60)
  const seconds = diffSeconds % 60
  const parts = []
  if (days) parts.push(`${days}day${days === 1 ? '' : 's'}`)
  if (hours) parts.push(`${hours}hrs`)
  if (minutes) parts.push(`${minutes}min`)
  if (!parts.length) parts.push(`${seconds}sec`)
  return { text: parts.join(' '), sort: diffSeconds }
}

const yamlOnly = (type, clusterScoped = false) => r => [
  { icon: 'file-code-2', label: 'YAML', cls: 'blue', fn: 'viewYaml', args: [type, clusterScoped ? null : r.namespace, r.name] },
]

export const RESOURCES = {
  pods: {
    title: 'Pods',
    cols:  ['Name', 'Namespace', 'Status', 'Ready', 'Restarts', 'Ports', 'Env', 'Age', 'Node'],
    row:   r => [r.name, r.namespace, { badge: r.status }, r.ready, r.restarts, r.ports || '-', r.envCount ?? 0, age(r.age), r.nodeName],
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
    actions: yamlOnly('replicasets'),
  },
  jobs: {
    title: 'Jobs',
    cols: ['Name', 'Namespace', 'Completions', 'Active', 'Failed', 'Age'],
    row: r => [r.name, r.namespace, r.completions, r.active, r.failed, age(r.age)],
    actions: yamlOnly('jobs'),
  },
  cronjobs: {
    title: 'CronJobs',
    cols: ['Name', 'Namespace', 'Schedule', 'Suspend', 'Active', 'Last Schedule', 'Age'],
    row: r => [r.name, r.namespace, r.schedule, r.suspend, r.active, r.lastSchedule, age(r.age)],
    actions: yamlOnly('cronjobs'),
  },
  services: {
    title: 'Services',
    cols:  ['Name', 'Namespace', 'Type', 'Cluster IP', 'Ports', 'Age'],
    row:   r => [r.name, r.namespace, r.type, r.clusterIP, r.ports, age(r.age)],
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
    actions: yamlOnly('endpointslices'),
  },
  endpoints: {
    title: 'Endpoints',
    cols: ['Name', 'Namespace', 'Endpoints', 'Ports', 'Age'],
    row: r => [r.name, r.namespace, r.endpoints, r.ports, age(r.age)],
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
    actions: yamlOnly('networkpolicies'),
  },
  configmaps: {
    title: 'ConfigMaps',
    cols:  ['Name', 'Namespace', 'Keys', 'Age'],
    row:   r => [r.name, r.namespace, r.keys, age(r.age)],
    actions: r => [
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['configmaps', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['configmaps', r.namespace, r.name] },
    ],
  },
  secrets: {
    title: 'Secrets',
    cols:  ['Name', 'Namespace', 'Type', 'Keys', 'Age'],
    row:   r => [r.name, r.namespace, r.type, r.keys, age(r.age)],
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
    actions: yamlOnly('hpas'),
  },
  pdbs: {
    title: 'PodDisruptionBudgets',
    cols: ['Name', 'Namespace', 'Min Available', 'Max Unavailable', 'Allowed', 'Age'],
    row: r => [r.name, r.namespace, r.minAvailable, r.maxUnavailable, r.allowed, age(r.age)],
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
    actions: r => [
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['pvcs', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['pvcs', r.namespace, r.name] },
    ],
  },
  pvs: {
    title: 'PersistentVolumes',
    cols: ['Name', 'Status', 'Capacity', 'Storage Class', 'Reclaim', 'Claim', 'Age'],
    row: r => [r.name, { badge: r.status }, r.capacity, r.storageClass, r.reclaimPolicy, r.claim, age(r.age)],
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
    actions: yamlOnly('namespaces', true),
  },
  nodes: {
    title: 'Nodes',
    cols:  ['Name', 'Status', 'Roles', 'Version', 'OS', 'CPU', 'Memory', 'Age'],
    row:   r => [r.name, { badge: r.unschedulable ? 'Cordoned' : r.status }, r.roles, r.version, r.os, r.cpu, r.memory, age(r.age)],
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
    cols:  ['Namespace', 'Type', 'Reason', 'Object', 'Count', 'Message', 'Age'],
    row:   r => [r.namespace, r.type, r.reason, r.object, r.count,
                 { truncate: r.message, max: 80 }, age(r.age)],
    actions: () => [],
  },
}
