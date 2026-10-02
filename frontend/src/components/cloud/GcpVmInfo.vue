<template>
  <div class="gi-root">
    <!-- ══ Resumen ══ -->
    <template v-if="section === 'overview'">
      <div v-if="notes.length" class="gi-notes" data-test="notes">
        <div class="gi-notes-title">{{ t('gi.notes') }}</div>
        <ul><li v-for="n in notes" :key="n.text" :class="n.level">{{ n.text }}</li></ul>
      </div>

      <div class="gi-grid">
        <div class="gi-card">
          <div class="gi-card-title">{{ t('ec2d.instance') }}</div>
          <dl>
            <dt>{{ t('res.name') }}</dt><dd>{{ d.name }}</dd>
            <dt>ID</dt><dd class="gi-mono">{{ d.instanceId || '—' }}</dd>
            <dt>{{ t('res.state') }}</dt><dd><span :class="['gi-badge', statusTone(d.status)]">{{ d.status }}</span><div v-if="d.statusMessage" class="gi-dim">{{ d.statusMessage }}</div></dd>
            <dt>{{ t('res.zone') }}</dt><dd class="gi-mono">{{ d.zone }}</dd>
            <dt>{{ t('gri.createdF') }}</dt><dd>{{ fmt(d.created) }}</dd>
            <dt>{{ t('gvi.lastStart') }}</dt><dd>{{ fmt(d.lastStart) }}</dd>
            <dt>{{ t('gvi.lastStop') }}</dt><dd>{{ fmt(d.lastStop) }}</dd>
            <dt v-if="d.description">{{ t('res.description') }}</dt><dd v-if="d.description">{{ d.description }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('gvi.machine') }}</div>
          <dl>
            <dt>{{ t('res.type') }}</dt><dd class="gi-mono">{{ d.machine?.type }}</dd>
            <dt>{{ t('ec2d.system') }}</dt><dd>{{ d.machine?.os || '—' }}</dd>
            <dt>{{ t('gvi.cpuPlatform') }}</dt><dd>{{ d.machine?.cpuPlatform || '—' }}</dd>
            <dt v-if="d.machine?.minCpuPlatform">{{ t('gvi.minCpu') }}</dt><dd v-if="d.machine?.minCpuPlatform">{{ d.machine.minCpuPlatform }}</dd>
            <dt>GPUs</dt><dd>{{ d.machine?.gpus?.length ? d.machine.gpus.map(g => `${g.count}× ${g.type}`).join(', ') : '—' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('gvi.availability') }}</div>
          <dl>
            <dt>{{ t('gvi.model') }}</dt><dd><span :class="['gi-badge', d.scheduling?.provisioningModel === 'STANDARD' ? '' : 'warn']">{{ d.scheduling?.provisioningModel }}</span></dd>
            <dt>{{ t('gvi.autoRestart') }}</dt><dd>{{ yesNo(d.scheduling?.automaticRestart) }}</dd>
            <dt>{{ t('gvi.hostMaintenance') }}</dt><dd>{{ d.scheduling?.onHostMaintenance === 'MIGRATE' ? t('gvi.liveMigrate') : d.scheduling?.onHostMaintenance === 'TERMINATE' ? t('gvi.stop') : '—' }}</dd>
            <dt v-if="d.scheduling?.terminationAction">{{ t('gvi.onPreemption') }}</dt><dd v-if="d.scheduling?.terminationAction">{{ d.scheduling.terminationAction === 'STOP' ? t('gvi.stop') : t('gvi.delete') }}</dd>
            <dt v-if="d.scheduling?.maxRunDurationSeconds">{{ t('gvi.maxDuration') }}</dt><dd v-if="d.scheduling?.maxRunDurationSeconds">{{ Math.round(d.scheduling.maxRunDurationSeconds / 3600) }} h</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('ec2d.tabSecurity') }}</div>
          <dl>
            <dt>{{ t('gvi.deletionProtection') }}</dt><dd><span :class="['gi-badge', d.security?.deletionProtection ? 'ok' : '']">{{ yesNo(d.security?.deletionProtection) }}</span></dd>
            <dt>Secure Boot</dt><dd>{{ yesNo(d.security?.secureBoot) }}</dd>
            <dt>{{ t('gvi.vtpmIntegrity') }}</dt><dd>{{ yesNo(d.security?.vtpm) }} · {{ yesNo(d.security?.integrityMonitoring) }}</dd>
            <dt>Confidential VM</dt><dd>{{ yesNo(d.security?.confidentialCompute) }}</dd>
            <dt>OS Login</dt><dd>{{ d.security?.osLogin ? (String(d.security.osLogin).toUpperCase() === 'TRUE' ? t('gvi.osLoginOn') : t('gvi.osLoginOff')) : t('gvi.osLoginProject') }}</dd>
            <dt>{{ t('gvi.ipForwarding') }}</dt><dd>{{ yesNo(d.security?.canIpForward) }}</dd>
            <dt>{{ t('gvi.serialPort') }}</dt><dd>{{ yesNo(d.security?.serialPortEnabled) }}</dd>
          </dl>
        </div>

        <div class="gi-card wide">
          <div class="gi-card-title">{{ t('gvi.serviceAccounts') }}</div>
          <div v-if="!d.security?.serviceAccounts?.length" class="gi-empty">{{ t('gvi.noServiceAccount') }}</div>
          <div v-for="sa in d.security?.serviceAccounts || []" :key="sa.email" style="margin-bottom:6px">
            <div class="gi-mono">{{ sa.email }}</div>
            <span v-for="s in sa.scopes" :key="s" class="gi-chip">{{ s }}</span>
          </div>
        </div>

        <div class="gi-card wide">
          <div class="gi-card-title">{{ t('gvi.tagsMetadata') }}</div>
          <dl>
            <dt>Network tags</dt>
            <dd><span v-for="tag in d.tags" :key="tag" class="gi-chip">{{ tag }}</span><span v-if="!d.tags?.length" class="gi-dim">—</span></dd>
            <dt>Metadata</dt>
            <dd>
              <span v-if="!d.metadata?.length" class="gi-dim">—</span>
              <div v-for="m in d.metadata" :key="m.key" class="gi-mono">
                {{ m.key }}
                <span v-if="m.sensitive" class="gi-dim">· {{ t('gvi.hiddenValue', { n: m.size }) }}</span>
                <span v-else class="gi-dim">= {{ m.value || '""' }}</span>
              </div>
            </dd>
          </dl>
        </div>
      </div>
    </template>

    <!-- ══ Discos ══ -->
    <template v-else-if="section === 'disks'">
      <div class="gi-card">
        <div class="gi-card-title">{{ t('gvi.disks', { n: d.disks?.length || 0, gb: totalDiskGb }) }}</div>
        <table v-if="d.disks?.length" class="gi-table" data-test="disks">
          <thead><tr><th>{{ t('eksd.disk') }}</th><th>{{ t('res.type') }}</th><th>{{ t('ec2d.size') }}</th><th>{{ t('gvi.interface') }}</th><th>{{ t('gvi.mode') }}</th><th>{{ t('gvi.sourceImage') }}</th><th>{{ t('ec2d.encrypted') }}</th><th>Auto-delete</th></tr></thead>
          <tbody>
            <tr v-for="disk in d.disks" :key="disk.deviceName">
              <td><span class="gi-mono">{{ disk.name || disk.deviceName }}</span> <span v-if="disk.boot" class="gi-badge">boot</span><div class="gi-dim">{{ disk.os || '' }}</div></td>
              <td class="gi-mono">{{ disk.type || disk.kind }}</td>
              <td>{{ disk.sizeGb ? `${disk.sizeGb} GB` : '—' }}</td>
              <td>{{ disk.interface || '—' }}</td>
              <td>{{ disk.mode === 'READ_WRITE' ? t('gvi.readWrite') : disk.mode === 'READ_ONLY' ? t('gvi.readOnly') : disk.mode }}</td>
              <td class="gi-mono gi-wrap">{{ disk.sourceImage || '—' }}</td>
              <td>{{ disk.encryption }}</td>
              <td><span :class="['gi-badge', disk.autoDelete ? '' : 'warn']" :title="disk.autoDelete ? '' : t('gvi.keptDiskHint')">{{ yesNo(disk.autoDelete) }}</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="gi-empty">{{ t('gvi.noDisks') }}</div>
      </div>
    </template>

    <!-- ══ Red ══ -->
    <template v-else-if="section === 'network'">
      <div v-for="n in d.networks || []" :key="n.name" class="gi-card">
        <div class="gi-card-title">{{ t('ec2d.interface', { id: n.name }) }}</div>
        <dl>
          <dt>{{ t('gvi.networkSubnet') }}</dt><dd class="gi-mono">{{ n.network }} / {{ n.subnetwork }}</dd>
          <dt>{{ t('gvi.internalIp') }}</dt><dd class="gi-mono">{{ n.internalIp || '—' }}</dd>
          <dt>{{ t('gvi.externalIp') }}</dt><dd class="gi-mono">{{ n.externalIp || '—' }} <span v-if="n.networkTier" class="gi-badge">{{ n.networkTier }}</span></dd>
          <dt v-if="n.ipv6">IPv6</dt><dd v-if="n.ipv6" class="gi-mono">{{ n.ipv6 }}</dd>
          <dt>Stack</dt><dd>{{ n.stackType || 'IPV4_ONLY' }}</dd>
          <dt v-if="n.aliasRanges?.length">{{ t('gvi.aliasRanges') }}</dt><dd v-if="n.aliasRanges?.length"><span v-for="r in n.aliasRanges" :key="r" class="gi-chip">{{ r }}</span></dd>
        </dl>
      </div>
      <div v-if="!d.networks?.length" class="gi-empty">{{ t('ec2d.noInterfaces') }}</div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import './gcpInfo.css'

const props = defineProps({
  detail:  { type: Object, required: true },
  section: { type: String, default: 'overview' },   // overview | disks | network
})
const d = computed(() => props.detail || {})
const { t } = useI18n()

const totalDiskGb = computed(() => (d.value.disks || []).reduce((sum, disk) => sum + (disk.sizeGb || 0), 0))

// Security / cost observations worth a second look
const notes = computed(() => {
  const out = []
  const v = d.value
  const hasExternalIp = (v.networks || []).some(n => n.externalIp)
  if (hasExternalIp) out.push({ level: 'warn', text: t('gvi.notePublicIp') })
  if ((v.security?.serviceAccounts || []).some(sa => sa.scopes.some(s => s.startsWith('cloud-platform')))) {
    out.push({ level: 'warn', text: t('gvi.noteCloudPlatform') })
  }
  if ((v.security?.serviceAccounts || []).some(sa => /-compute@developer\.gserviceaccount\.com$/.test(sa.email))) {
    out.push({ level: 'warn', text: t('gvi.noteDefaultSa') })
  }
  if (v.security && !v.security.secureBoot) out.push({ level: 'warn', text: t('gvi.noteSecureBoot') })
  if (v.security && !v.security.deletionProtection) out.push({ level: 'warn', text: t('gvi.noteDeletionProtection') })
  if (v.security?.serialPortEnabled) out.push({ level: 'err', text: t('gvi.noteSerialPort') })
  if (['SPOT', 'PREEMPTIBLE'].includes(v.scheduling?.provisioningModel)) out.push({ level: 'warn', text: t('gvi.noteSpot') })
  if ((v.disks || []).some(disk => !disk.autoDelete)) out.push({ level: 'warn', text: t('gvi.noteKeptDisks') })
  return out
})

function statusTone(s) {
  if (s === 'RUNNING') return 'ok'
  if (['STOPPING', 'PROVISIONING', 'STAGING', 'SUSPENDING', 'REPAIRING'].includes(s)) return 'warn'
  if (['TERMINATED', 'SUSPENDED'].includes(s)) return ''
  return 'err'
}
function yesNo(v) { return v == null ? '—' : t(v ? 'common.yes' : 'common.no') }
function fmt(v) { return v ? new Date(v).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US') : '—' }
</script>
