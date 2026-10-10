// Readable names and environment hints for kubeconfig contexts. Context names
// are often long ARNs, so the header and confirmations show the cluster name
// and keep the full name available.

// EKS: arn:aws:eks:<region>:<account>:cluster/<name>
// GKE: gke_<project>_<zone>_<name>
export function shortContextName(name = '') {
  const value = String(name || '')
  const eks = value.match(/^arn:aws[\w-]*:eks:[^:]*:[^:]*:cluster\/(.+)$/)
  if (eks) return eks[1]
  const gke = value.match(/^gke_[^_]+_[^_]+_(.+)$/)
  if (gke) return gke[1]
  return value
}

const ENVIRONMENT_TOKENS = [
  // Checked in order: "preprod" must not read as production.
  ['staging', ['staging', 'stage', 'stg', 'uat', 'qa', 'preprod', 'preproduction', 'pre']],
  ['production', ['production', 'prod', 'prd', 'live']],
  ['development', ['development', 'develop', 'dev', 'test', 'sandbox', 'sbx', 'local', 'minikube', 'kind', 'docker-desktop', 'rancher-desktop']],
]

// Best-effort guess from the context name; null when nothing matches, so the
// UI can say the environment is unknown instead of implying it is safe.
export function contextEnvironment(name = '') {
  const value = String(name || '').toLowerCase()
  const tokens = new Set(value.split(/[^a-z0-9]+/).filter(Boolean))
  for (const [environment, words] of ENVIRONMENT_TOKENS) {
    if (words.some(word => (word.includes('-') ? value.includes(word) : tokens.has(word)))) return environment
  }
  return null
}

// Official Kubernetes kind names stay untranslated: they match kubectl and docs.
const KIND_LABELS = {
  pods: ['Pod', 'Pods'], deployments: ['Deployment', 'Deployments'], statefulsets: ['StatefulSet', 'StatefulSets'],
  daemonsets: ['DaemonSet', 'DaemonSets'], replicasets: ['ReplicaSet', 'ReplicaSets'], jobs: ['Job', 'Jobs'], cronjobs: ['CronJob', 'CronJobs'],
  services: ['Service', 'Services'], ingresses: ['Ingress', 'Ingresses'], configmaps: ['ConfigMap', 'ConfigMaps'], secrets: ['Secret', 'Secrets'],
  pvcs: ['PersistentVolumeClaim', 'PersistentVolumeClaims'], pvs: ['PersistentVolume', 'PersistentVolumes'], nodes: ['Node', 'Nodes'],
  namespaces: ['Namespace', 'Namespaces'], hpas: ['HorizontalPodAutoscaler', 'HorizontalPodAutoscalers'],
}

export function kubeKindLabel(type = '', { plural = false } = {}) {
  const labels = KIND_LABELS[type]
  if (!labels) return type || ''
  return plural ? labels[1] : labels[0]
}
