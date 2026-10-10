// Confirmation config for start / stop / delete on Cloud Run, Compute VMs and
// Cloud SQL (used by GcpView with GcpConfirmModal).
//
// Safety layers:
//   - start: resumes billing → cost estimate + "this generates costs" checkbox
//   - stop:  plain confirmation listing what keeps billing / side effects
//   - delete: irreversible → typed resource name; blocked outright when the
//     resource has deletion protection (GCP would reject it anyway)
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()

// Cloud Run "start/stop" only change template.scaling.minInstanceCount (1 or 0).
// Nothing is switched off: with minimum 0 the service still serves requests and
// starts instances on demand. Table and detail share these conditions.
function minOf(r) { return Number(r?.minInstances ?? r?.scaling?.minInstances ?? 0) || 0 }
export function cloudRunScaling(r) {
  const min = minOf(r)
  return { min, max: r?.maxInstances ?? r?.scaling?.maxInstances ?? null, canWarm: min < 1, canScaleToZero: min > 0 }
}

// '1000m' → '1 vCPU', '2' → '2 vCPU'; the raw value stays available as a title.
export function formatCloudRunCpu(cpu) {
  if (cpu == null || cpu === '') return '—'
  const raw = String(cpu)
  const n = raw.endsWith('m') ? Number(raw.slice(0, -1)) / 1000 : Number(raw)
  return Number.isFinite(n) ? `${n} vCPU` : raw
}
// '512Mi' → '512 MiB', '1Gi' → '1 GiB', '1G' → '1 GB'
export function formatCloudRunMemory(memory) {
  if (memory == null || memory === '') return '—'
  const m = String(memory).match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/)
  if (!m) return String(memory)
  return `${m[1]} ${m[2] || ''}B`
}

const KIND_LABEL = { cloudrun: 'gca.kind.cloudrun', vm: 'gca.kind.vm', sql: 'gca.kind.sql' }

function startConfig(kind, r) {
  const base = { tone: 'warning', costAck: true, confirmLabel: t('gca.start') }
  if (kind === 'cloudrun') return {
    ...base,
    confirmLabel: t('gca.run.warmConfirm'),
    title: t('gca.run.warmTitle', { name: r.name }),
    message: t('gca.startRunMessage'),
    lines: [t('gca.run.minChange', { from: minOf(r), to: 1 }), t('gca.startRunLine'), t('gca.run.trafficUnchanged')],
    blocked: cloudRunScaling(r).canWarm ? '' : t('gca.run.alreadyWarm', { min: minOf(r) }),
    estimateKind: 'cloudrun',
    estimateSpec: { cpu: r.cpu || '1', memory: r.memory || '512Mi', minInstances: 1 },
  }
  if (kind === 'vm') return {
    ...base,
    title: t('gca.startVmTitle', { name: r.name }),
    message: t('gca.startVmMessage'),
    lines: [t('gca.zoneLine', { zone: r.zone, machineType: r.machineType }), t('gca.ephemeralIpStart')],
    estimateKind: 'vm',
    estimateSpec: {
      machineType: r.machineType,
      diskSizeGb: r.diskSizeGb || 10,
      externalIp: !!r.externalIp,
      spot: r.provisioningModel === 'SPOT' || r.provisioningModel === 'PREEMPTIBLE',
    },
  }
  return {
    ...base,
    title: t('gca.startTitle', { name: r.name }),
    message: t('gca.startSqlMessage'),
    lines: [`${r.database || ''} · ${r.tier || ''}`.trim()],
    estimateKind: 'sql',
    estimateSpec: {
      tier: r.tier,
      storageGb: r.storageGb || 10,
      storageType: r.storageType || 'PD_SSD',
      availabilityType: r.availabilityType || 'ZONAL',
    },
  }
}

function stopConfig(kind, r) {
  const base = { tone: 'info', confirmLabel: t('gca.stop') }
  if (kind === 'cloudrun') return {
    ...base,
    confirmLabel: t('gca.run.scaleToZeroConfirm'),
    title: t('gca.run.scaleToZeroTitle', { name: r.name }),
    message: t('gca.stopRunMessage'),
    lines: [t('gca.run.minChange', { from: minOf(r), to: 0 }), t('gca.run.endpointStays'), t('gca.stopRunLine')],
    blocked: cloudRunScaling(r).canScaleToZero ? '' : t('gca.run.alreadyZero'),
  }
  if (kind === 'vm') return {
    ...base,
    title: t('gca.stopVmTitle', { name: r.name }),
    message: t('gca.stopVmMessage'),
    lines: [
      t('gca.stopVmProcesses'),
      t('gca.stopVmBilling'),
      r.externalIp ? t('gca.ephemeralIpRestart') : null,
    ].filter(Boolean),
  }
  return {
    ...base,
    title: t('gca.stopTitle', { name: r.name }),
    message: t('gca.stopSqlMessage'),
    lines: [t('gca.stopSqlBilling')],
  }
}

function deleteConfig(kind, r) {
  const base = {
    tone: 'danger',
    title: t('gca.deleteTitle', { kind: t(KIND_LABEL[kind]), name: r.name }),
    message: t('gca.cannotUndo'),
    requireName: r.name,
    confirmLabel: t('gca.deleteForever'),
  }
  if (kind === 'cloudrun') return {
    ...base,
    lines: [t('gca.deleteRunRevisions'), t('gca.deleteRunImages')],
  }
  if (kind === 'vm') {
    const kept = r.keptDiskCount || 0
    return {
      ...base,
      lines: [
        t('gca.deleteVmDisks'),
        kept ? t('gca.deleteVmKept', { n: kept }) : null,
        r.externalIp ? t('gca.deleteVmIp') : null,
      ].filter(Boolean),
      blocked: r.deletionProtection ? t('gca.vmProtected') : '',
    }
  }
  return {
    ...base,
    lines: [t('gca.deleteSqlData'), t('gca.deleteSqlBackground')],
    blocked: r.deletionProtection ? t('gca.sqlProtected') : '',
  }
}

// SSH into a VM: KUA authorizes a temporary key (OS Login profile or instance
// metadata), so this is a real change on the VM/account and is confirmed first.
function sshConfig(r) {
  const internal = !r.externalIp
  return {
    tone: 'info',
    title: t('gca.sshTitle', { name: r.name }),
    message: t('gca.sshMessage'),
    lines: [
      t('gca.sshKey'),
      t('gca.sshOsLogin'),
      internal
        ? t('gca.sshInternal', { ip: r.internalIp || '' })
        : t('gca.sshExternal', { ip: r.externalIp }),
    ],
    confirmLabel: t('gca.connect'),
    addressType: internal ? 'internal' : 'external',
    blocked: r.status !== 'RUNNING' ? t('gca.sshNotRunning', { status: r.status }) : '',
  }
}

export function gcpActionConfig(kind, action, resource) {
  if (!KIND_LABEL[kind]) throw new Error(`Unknown GCP resource kind: ${kind}`)
  if (action === 'ssh') {
    if (kind !== 'vm') throw new Error('SSH is only available for VMs')
    return sshConfig(resource)
  }
  if (action === 'start') return startConfig(kind, resource)
  if (action === 'stop') return stopConfig(kind, resource)
  if (action === 'delete') return deleteConfig(kind, resource)
  throw new Error(`Unknown GCP action: ${action}`)
}
