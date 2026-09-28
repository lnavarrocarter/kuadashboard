// Criticality of Kubernetes events for colour coding and filtering in the Events table.
//
// critical — the workload or node is failing right now (crash loops, OOM, image pulls,
//            volume mounts, evictions, node pressure / not ready)
// warning  — any other Warning event (probe failures, scheduling retries, etc.)
// normal   — Normal events

export const SEVERITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'warning',  label: 'Warning'  },
  { value: 'normal',   label: 'Normal'   },
]

const CRITICAL_REASONS = new Set([
  // Pods / containers
  'BackOff', 'CrashLoopBackOff', 'Failed', 'Error',
  'ErrImagePull', 'ImagePullBackOff', 'ErrImageNeverPull', 'InvalidImageName', 'InspectFailed',
  'OOMKilled', 'OOMKilling', 'Evicted', 'Preempted', 'FailedKillPod', 'FailedCreatePodSandBox',
  'FailedCreatePodContainer', 'FailedSync', 'FailedPostStartHook', 'FailedPreStopHook',
  // Volumes
  'FailedMount', 'FailedAttachVolume', 'FailedMapVolume', 'VolumeResizeFailed', 'ProvisioningFailed',
  // Controllers
  'FailedCreate', 'BackoffLimitExceeded', 'DeadlineExceeded',
  // Nodes
  'NodeNotReady', 'NodeHasDiskPressure', 'NodeHasInsufficientMemory', 'NodeHasInsufficientPID',
  'EvictionThresholdMet', 'SystemOOM', 'Rebooted', 'NetworkNotReady', 'ContainerGCFailed', 'ImageGCFailed',
])

const ORDER = { critical: 0, warning: 1, normal: 2 }

export function eventSeverity(evt) {
  const reason = String(evt?.reason || '')
  const type = String(evt?.type || 'Normal')
  if (CRITICAL_REASONS.has(reason)) return 'critical'
  // Kubelet reports these as Warning with a descriptive message instead of a reason code
  if (type === 'Warning' && /OOMKilled|CrashLoopBackOff|ImagePullBackOff|ErrImagePull/.test(evt?.message || '')) return 'critical'
  if (type === 'Warning') return 'warning'
  return 'normal'
}

export function severityLabel(value) {
  return SEVERITIES.find(s => s.value === value)?.label || value
}

export function severityOrder(value) {
  return ORDER[value] ?? 3
}
