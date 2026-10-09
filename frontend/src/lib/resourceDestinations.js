// Where a resource of a KUA Application can be opened in KUA (#239): AWS resources in their tab of
// the AWS view (or their AWS console page), Kubernetes resources in the Kubernetes view (detail,
// pods of a workload, logs). The first destination is the primary one, offered on each row of
// Resources; the inspector offers them all.
import { awsConsoleUrl, awsViewTarget } from './awsResourceLinks'

const KIND_BY_TYPE = {
  pod: 'Pod', deployment: 'Deployment', statefulset: 'StatefulSet', daemonset: 'DaemonSet',
  service: 'Service', ingress: 'Ingress', configmap: 'ConfigMap', secret: 'Secret',
  pvc: 'PersistentVolumeClaim', persistentvolumeclaim: 'PersistentVolumeClaim',
}
const KINDS = new Set(Object.values(KIND_BY_TYPE))
const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet'])
const WITH_LOGS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'Pod'])

/** The Kubernetes object behind a node or registry resource: { kind, name, namespace, kubeContext }, or null. */
export function kubernetesObject(resource = {}) {
  if (resource.provider && resource.provider !== 'kubernetes') return null
  // A registry key is "<context>/<namespace>/<Kind>/<name>"; the context itself may contain "/".
  const key = String(resource.nativeIdentifier || resource.discoveryKey || resource.key || '').split('/')
  const keyKind = key.length >= 4 ? key[key.length - 2] : ''
  const kind = KINDS.has(resource.kind) ? resource.kind
    : KIND_BY_TYPE[String(resource.resourceType || resource.kind || '').toLowerCase()] || (KINDS.has(keyKind) ? keyKind : '')
  const name = resource.name || resource.displayName || (key.length >= 4 ? key[key.length - 1] : '')
  const namespace = resource.namespace || (key.length >= 4 ? key[key.length - 3] : '')
  const kubeContext = resource.kubeContext || (key.length >= 4 ? key.slice(0, -3).join('/') : '') || resource.scopeId || ''
  if (!kind || !name || !namespace || !kubeContext) return null
  return { provider: 'kubernetes', kind, name, namespace, kubeContext }
}

/**
 * [{ key, event, label, icon, payload | url }]: event is what KUApps emits to open it ('open-aws',
 * 'open-kubernetes-detail', 'open-kubernetes-pods', 'open-kubernetes-logs'); url opens outside KUA.
 */
export function resourceDestinations(resource = {}) {
  const destinations = []
  if (awsViewTarget(resource)) destinations.push({ key: 'aws-view', event: 'open-aws', label: 'archCanvas.action.openAws', icon: 'external-link', payload: resource })
  else {
    const url = awsConsoleUrl(resource)
    if (url) destinations.push({ key: 'aws-console', label: 'archCanvas.action.openAwsConsole', icon: 'square-arrow-out-up-right', url })
  }
  const object = kubernetesObject(resource)
  if (object) {
    destinations.push({ key: 'kubernetes-detail', event: 'open-kubernetes-detail', label: 'kuapps.destination.kubernetesDetail', icon: 'ship-wheel', payload: object })
    if (WORKLOADS.has(object.kind)) destinations.push({ key: 'kubernetes-pods', event: 'open-kubernetes-pods', label: 'archCanvas.action.viewPods', icon: 'boxes', payload: object })
    if (WITH_LOGS.has(object.kind)) destinations.push({ key: 'kubernetes-logs', event: 'open-kubernetes-logs', label: 'kuapps.destination.kubernetesLogs', icon: 'scroll-text', payload: object })
  }
  return destinations
}
