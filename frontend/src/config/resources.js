// Resource table column / row / action definitions

export function age(ts) {
  if (!ts) return '-'
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (diff < 60)    return `${diff}s`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export const RESOURCES = {
  pods: {
    title: 'Pods',
    cols:  ['Name', 'Namespace', 'Status', 'Ready', 'Restarts', 'Age', 'Node'],
    row:   r => [r.name, r.namespace, { badge: r.status }, r.ready, r.restarts, age(r.age), r.nodeName],
    actions: r => [
      { icon: 'scroll',     label: 'Logs',   cls: 'blue',  fn: 'viewLogs',   args: [r.namespace, r.name, r.containers] },
      { icon: 'terminal',   label: 'Shell',  cls: 'green', fn: 'openExec',   args: [r.namespace, r.name, r.containers] },
      { icon: 'file-code-2',label: 'YAML',   cls: 'blue',  fn: 'viewYaml',   args: ['pods', r.namespace, r.name] },
      { icon: 'trash-2',    label: 'Delete', cls: 'red',   fn: 'confirmDelete', args: ['pods', r.namespace, r.name] },
    ],
  },
  deployments: {
    title: 'Deployments',
    cols:  ['Name', 'Namespace', 'Ready', 'Replicas', 'Age'],
    row:   r => [r.name, r.namespace, r.ready, r.replicas, age(r.age)],
    actions: r => [
      { icon: 'rotate-ccw',  label: 'Restart', cls: 'green', fn: 'restart',       args: ['deployments', r.namespace, r.name] },
      { icon: 'layers',      label: 'Scale',   cls: 'blue',  fn: 'openScale',      args: ['deployments', r.namespace, r.name, r.replicas] },
      { icon: 'file-code-2', label: 'YAML',    cls: 'blue',  fn: 'viewYaml',       args: ['deployments', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete',  cls: 'red',   fn: 'confirmDelete',  args: ['deployments', r.namespace, r.name] },
    ],
  },
  statefulsets: {
    title: 'StatefulSets',
    cols:  ['Name', 'Namespace', 'Ready', 'Replicas', 'Age'],
    row:   r => [r.name, r.namespace, r.ready, r.replicas, age(r.age)],
    actions: r => [
      { icon: 'rotate-ccw',  label: 'Restart', cls: 'green', fn: 'restart',      args: ['statefulsets', r.namespace, r.name] },
      { icon: 'layers',      label: 'Scale',   cls: 'blue',  fn: 'openScale',    args: ['statefulsets', r.namespace, r.name, r.replicas] },
      { icon: 'file-code-2', label: 'YAML',    cls: 'blue',  fn: 'viewYaml',     args: ['statefulsets', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete',  cls: 'red',   fn: 'confirmDelete',args: ['statefulsets', r.namespace, r.name] },
    ],
  },
  daemonsets: {
    title: 'DaemonSets',
    cols:  ['Name', 'Namespace', 'Ready', 'Age'],
    row:   r => [r.name, r.namespace, r.ready, age(r.age)],
    actions: r => [
      { icon: 'rotate-ccw',  label: 'Restart', cls: 'green', fn: 'restart',      args: ['daemonsets', r.namespace, r.name] },
      { icon: 'file-code-2', label: 'YAML',    cls: 'blue',  fn: 'viewYaml',     args: ['daemonsets', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete',  cls: 'red',   fn: 'confirmDelete',args: ['daemonsets', r.namespace, r.name] },
    ],
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
    cols:  ['Name', 'Namespace', 'Class', 'Hosts', 'Age'],
    row:   r => [r.name, r.namespace, r.class, r.hosts, age(r.age)],
    actions: r => [
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['ingresses', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['ingresses', r.namespace, r.name] },
    ],
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
  pvcs: {
    title: 'PersistentVolumeClaims',
    cols:  ['Name', 'Namespace', 'Status', 'Capacity', 'Storage Class', 'Age'],
    row:   r => [r.name, r.namespace, { badge: r.status }, r.capacity, r.storageClass, age(r.age)],
    actions: r => [
      { icon: 'file-code-2', label: 'YAML',   cls: 'blue', fn: 'viewYaml',      args: ['pvcs', r.namespace, r.name] },
      { icon: 'trash-2',     label: 'Delete', cls: 'red',  fn: 'confirmDelete', args: ['pvcs', r.namespace, r.name] },
    ],
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
