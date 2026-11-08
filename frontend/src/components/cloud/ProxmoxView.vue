<template>
  <div class="proxmox-view" data-test="proxmox-view">
    <div v-if="!profileId" class="empty-row" data-test="proxmox-no-profile">
      <p>{{ t('proxmox.noProfile') }}</p>
      <button class="btn sm primary" type="button" @click="emit('add-connection')">{{ t('proxmox.addProfile') }}</button>
    </div>

    <template v-else>
      <div class="pve-toolbar">
        <h2>
          <i data-lucide="server"></i>
          {{ inventory?.cluster?.name || t('proxmox.title') }}
          <small v-if="inventory?.cluster?.singleNode">{{ t('proxmox.singleNode') }}</small>
        </h2>
        <span v-if="inventory?.readAt" class="text-dim mono-xs" data-test="proxmox-read-at">{{ t('proxmox.readAt', { when: new Date(inventory.readAt).toLocaleTimeString() }) }}</span>
        <button class="btn sm" type="button" :disabled="loading" data-test="proxmox-refresh" @click="load(true)">
          <i data-lucide="refresh-cw"></i> {{ loading ? t('common.loading') : t('proxmox.refresh') }}
        </button>
      </div>

      <div v-if="error" class="alert-error" role="alert" data-test="proxmox-error">
        <strong>{{ t(`proxmox.error.${errorCode}`) }}</strong>
        <span>{{ error }}</span>
        <span v-if="errorFingerprint" class="mono-xs">{{ t('proxmox.error.seenFingerprint', { fingerprint: errorFingerprint }) }}</span>
      </div>

      <template v-if="inventory">
        <!-- Overview -->
        <div v-show="activeService === 'overview'" class="tab-panel" data-test="proxmox-overview">
          <div class="pve-cards">
            <div class="pve-card" :class="{ warn: inventory.cluster.quorate === false }" data-test="proxmox-quorum">
              <span>{{ t('proxmox.quorum') }}</span>
              <strong>{{ inventory.cluster.quorate === null ? t('proxmox.unknown') : inventory.cluster.quorate ? t('proxmox.quorate') : t('proxmox.notQuorate') }}</strong>
            </div>
            <div v-for="card in cards" :key="card.key" class="pve-card" :class="{ warn: card.warn }" :data-test="`proxmox-card-${card.key}`">
              <span>{{ t(`proxmox.card.${card.key}`) }}</span>
              <strong>{{ card.value === null ? t('proxmox.notRead') : card.value }}</strong>
              <small v-if="card.of !== undefined && card.of !== null">{{ t('proxmox.of', { total: card.of }) }}</small>
            </div>
          </div>
          <p v-for="name in unavailableSections" :key="name" class="pve-unavailable" data-test="proxmox-unavailable">
            {{ t('proxmox.sectionUnavailable', { section: t(`proxmox.section.${name}`), reason: t(`proxmox.error.${inventory.sections[name].reason}`) }) }}
          </p>
          <p class="text-dim pve-hint">{{ t('proxmox.tokenHint') }}</p>
        </div>

        <!-- Guests -->
        <div v-show="activeService === 'guests'" class="tab-panel">
          <SectionState :section="inventory.sections.guests" name="guests" />
          <table v-if="inventory.sections.guests.available && guests.length" class="cloud-table" data-test="proxmox-guests">
            <thead><tr>
              <th>{{ t('proxmox.col.vmid') }}</th><th>{{ t('proxmox.col.name') }}</th><th>{{ t('proxmox.col.type') }}</th>
              <th>{{ t('proxmox.col.status') }}</th><th>{{ t('proxmox.col.node') }}</th><th>{{ t('proxmox.col.cpu') }}</th>
              <th>{{ t('proxmox.col.memory') }}</th><th>{{ t('proxmox.col.backup') }}</th><th>{{ t('proxmox.col.ha') }}</th><th>{{ t('proxmox.col.tags') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="guest in guests" :key="guest.id">
                <td class="mono-xs">{{ guest.vmid }}</td>
                <td class="fw-medium">{{ guest.name }} <small v-if="guest.template" class="text-dim">{{ t('proxmox.template') }}</small></td>
                <td>{{ guest.type === 'lxc' ? 'LXC' : 'VM' }}</td>
                <td><span :class="['pve-state', guest.status]">{{ guest.status }}</span></td>
                <td>{{ guest.node }}</td>
                <td>{{ guest.maxcpu ?? '—' }}</td>
                <td>{{ bytes(guest.mem) }} / {{ bytes(guest.maxmem) }}</td>
                <td>{{ guest.backupJob === null ? '—' : guest.backupJob ? t('proxmox.yes') : t('proxmox.no') }}</td>
                <td>{{ guest.haState || '—' }}</td>
                <td>{{ guest.tags.join(', ') || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Nodes -->
        <div v-show="activeService === 'nodes'" class="tab-panel">
          <SectionState :section="inventory.sections.nodes" name="nodes" />
          <table v-if="inventory.sections.nodes.available && inventory.sections.nodes.items.length" class="cloud-table" data-test="proxmox-nodes">
            <thead><tr>
              <th>{{ t('proxmox.col.name') }}</th><th>{{ t('proxmox.col.status') }}</th><th>IP</th><th>{{ t('proxmox.col.cpu') }}</th>
              <th>{{ t('proxmox.col.memory') }}</th><th>{{ t('proxmox.col.uptime') }}</th><th>{{ t('proxmox.col.version') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="node in inventory.sections.nodes.items" :key="node.name">
                <td class="fw-medium">{{ node.name }}</td>
                <td><span :class="['pve-state', node.status]">{{ node.status }}</span></td>
                <td class="mono-xs">{{ node.ip || '—' }}</td>
                <td>{{ node.cpu === null ? '—' : `${Math.round(node.cpu * 100)} % · ${node.maxcpu}` }}</td>
                <td>{{ node.memPercent === null ? '—' : `${node.memPercent} %` }}</td>
                <td>{{ duration(node.uptime) }}</td>
                <td>{{ node.version || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Storage -->
        <div v-show="activeService === 'storage'" class="tab-panel">
          <SectionState :section="inventory.sections.storage" name="storage" />
          <table v-if="inventory.sections.storage.available && inventory.sections.storage.items.length" class="cloud-table" data-test="proxmox-storage">
            <thead><tr>
              <th>{{ t('proxmox.col.name') }}</th><th>{{ t('proxmox.col.node') }}</th><th>{{ t('proxmox.col.type') }}</th>
              <th>{{ t('proxmox.col.content') }}</th><th>{{ t('proxmox.col.used') }}</th><th>{{ t('proxmox.col.status') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="item in inventory.sections.storage.items" :key="item.id">
                <td class="fw-medium">{{ item.storage }} <small v-if="item.shared" class="text-dim">{{ t('proxmox.shared') }}</small></td>
                <td>{{ item.node }}</td>
                <td>{{ item.type || '—' }}</td>
                <td>{{ item.content.join(', ') || '—' }}</td>
                <td :class="{ 'pve-full': item.usedPercent >= STORAGE_FULL }">{{ item.usedPercent === null ? '—' : `${item.usedPercent} % · ${bytes(item.used)} / ${bytes(item.total)}` }}</td>
                <td>{{ item.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Backups -->
        <div v-show="activeService === 'backups'" class="tab-panel">
          <SectionState :section="inventory.sections.backups" name="backups" />
          <table v-if="inventory.sections.backups.available && inventory.sections.backups.items.length" class="cloud-table" data-test="proxmox-backups">
            <thead><tr>
              <th>{{ t('proxmox.col.job') }}</th><th>{{ t('proxmox.col.schedule') }}</th><th>{{ t('proxmox.col.guests') }}</th>
              <th>{{ t('proxmox.col.storage') }}</th><th>{{ t('proxmox.col.mode') }}</th><th>{{ t('proxmox.col.enabled') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="job in inventory.sections.backups.items" :key="job.id">
                <td class="fw-medium">{{ job.comment || job.id }}</td>
                <td class="mono-xs">{{ job.schedule || '—' }}</td>
                <td>{{ job.all ? (job.exclude.length ? t('proxmox.allExcept', { ids: job.exclude.join(', ') }) : t('proxmox.allGuests')) : job.vmids.join(', ') }}</td>
                <td>{{ job.storage || '—' }}</td>
                <td>{{ job.mode || '—' }}</td>
                <td>{{ job.enabled ? t('proxmox.yes') : t('proxmox.no') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Tasks -->
        <div v-show="activeService === 'tasks'" class="tab-panel">
          <SectionState :section="inventory.sections.tasks" name="tasks" />
          <table v-if="inventory.sections.tasks.available && inventory.sections.tasks.items.length" class="cloud-table" data-test="proxmox-tasks">
            <thead><tr>
              <th>{{ t('proxmox.col.started') }}</th><th>{{ t('proxmox.col.type') }}</th><th>{{ t('proxmox.col.target') }}</th>
              <th>{{ t('proxmox.col.node') }}</th><th>{{ t('proxmox.col.user') }}</th><th>{{ t('proxmox.col.status') }}</th>
            </tr></thead>
            <tbody>
              <tr v-for="task in inventory.sections.tasks.items" :key="task.upid">
                <td class="mono-xs">{{ task.startedAt ? new Date(task.startedAt).toLocaleString() : '—' }}</td>
                <td>{{ task.type }}</td>
                <td>{{ task.target || '—' }}</td>
                <td>{{ task.node }}</td>
                <td class="mono-xs">{{ task.user }}</td>
                <td><span :class="['pve-state', task.state]" :title="task.message">{{ t(`proxmox.task.${task.state}`) }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Guest and node RRD telemetry (#336). -->
        <div v-show="activeService === 'metrics'" class="tab-panel pve-metrics" data-test="proxmox-metrics">
          <div class="pve-toolbar">
            <p class="text-dim">{{ t('proxmox.metrics.retention', { days: telemetry?.retentionDays || 30 }) }}</p>
            <button class="btn sm" type="button" :disabled="metricsLoading" data-test="proxmox-metrics-refresh" @click="loadMetrics">
              <i data-lucide="refresh-cw"></i> {{ metricsLoading ? t('common.loading') : t('proxmox.refresh') }}
            </button>
          </div>
          <p v-if="metricsError" class="alert-error" role="alert" data-test="proxmox-metrics-error">{{ metricsError }}</p>
          <p v-else-if="metricsLoading && !telemetry" class="text-dim">{{ t('common.loading') }}</p>
          <p v-else-if="!telemetry?.entities?.length" class="empty-row" data-test="proxmox-metrics-empty">{{ t('proxmox.metrics.empty') }}</p>
          <article v-for="entity in telemetry?.entities || []" :key="entity.id" class="pve-metric-entity" :data-test="`proxmox-metric-entity-${entity.id.replaceAll('/', '-')}`">
            <header><strong>{{ entity.name }}</strong><span class="text-dim">{{ entity.type === 'node' ? t('proxmox.section.nodes') : entity.type.toUpperCase() }} · {{ entity.node }}</span></header>
            <small v-if="entity.stale" class="text-dim" data-test="proxmox-metrics-stale">{{ t('proxmox.metrics.stale', { reason: t(`proxmox.error.${entity.reason}`) }) }}</small>
            <p v-if="!entity.available" class="pve-unavailable">{{ entity.reason === 'no_data' ? t('proxmox.metrics.noData') : t(`proxmox.error.${entity.reason}`) }}</p>
            <div v-else class="pve-metric-grid">
              <div v-for="metric in METRIC_FIELDS" :key="metric" class="pve-metric-card" :data-test="`proxmox-metric-${metric}-${entity.id.replaceAll('/', '-')}`">
                <span>{{ t(`proxmox.metrics.${metric}`) }}</span>
                <strong>{{ formatMetric(entity.points.at(-1)?.[metric], metric) }}</strong>
                <svg viewBox="0 0 120 32" preserveAspectRatio="none" role="img" :aria-label="t(`proxmox.metrics.${metric}`)">
                  <polyline :points="chartPoints(entity.points, metric)" fill="none" stroke="currentColor" stroke-width="1.5" />
                </svg>
              </div>
            </div>
          </article>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'

// Proxmox VE (#195): the inventory of the selected profile, read-only. Sections the token cannot
// read say so; a value that was not read shows "Not read", never 0.
const props = defineProps({
  profileId: { type: String, default: '' },
  activeService: { type: String, default: 'overview' },
})
const emit = defineEmits(['add-connection'])

const { t } = useI18n()
const { apiFetch } = useApi()
const STORAGE_FULL = 85
const inventory = ref(null)
const loading = ref(false)
const error = ref('')
const errorCode = ref('unreachable')
const errorFingerprint = ref('')
const telemetry = ref(null)
const metricsLoading = ref(false)
const metricsError = ref('')
const METRIC_FIELDS = ['cpuPercent', 'memoryPercent', 'diskPercent', 'netIn', 'netOut']
let sequence = 0
let metricTimer = null

const SectionState = (sectionProps) => {
  const { section, name } = sectionProps
  if (!section) return null
  if (!section.available) return h('p', { class: 'pve-unavailable', 'data-test': 'proxmox-unavailable' }, t('proxmox.sectionUnavailable', { section: t(`proxmox.section.${name}`), reason: t(`proxmox.error.${section.reason}`) }))
  if (!section.items.length) return h('div', { class: 'empty-row' }, t(`proxmox.empty.${name}`))
  return null
}
SectionState.props = { section: Object, name: String }

const guests = computed(() => (inventory.value?.sections.guests.items || []).slice().sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0)))
const unavailableSections = computed(() => Object.entries(inventory.value?.sections || {}).filter(([, section]) => !section.available).map(([name]) => name))
const cards = computed(() => {
  const summary = inventory.value?.summary || {}
  return [
    { key: 'nodes', value: summary.nodesOnline, of: summary.nodes, warn: summary.nodes !== null && summary.nodesOnline < summary.nodes },
    { key: 'vms', value: summary.vms },
    { key: 'containers', value: summary.containers },
    { key: 'running', value: summary.running },
    { key: 'storageFull', value: summary.storageFull, warn: summary.storageFull > 0 },
    { key: 'guestsWithoutBackup', value: summary.guestsWithoutBackup, warn: summary.guestsWithoutBackup > 0 },
    { key: 'failedTasks24h', value: summary.failedTasks24h, warn: summary.failedTasks24h > 0 },
  ]
})

function bytes(value) {
  if (value === null || value === undefined) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let size = Number(value)
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

function duration(seconds) {
  if (!seconds) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return days ? `${days} d ${hours} h` : `${hours} h ${Math.floor((seconds % 3600) / 60)} min`
}

async function load(refresh = false) {
  if (!props.profileId) { inventory.value = null; return }
  const current = ++sequence
  const profileId = props.profileId
  loading.value = true
  error.value = ''
  errorFingerprint.value = ''
  try {
    const result = await apiFetch(`/api/cloud/proxmox/inventory${refresh ? '?refresh=1' : ''}`, { headers: { 'X-Profile-Id': profileId } })
    // A late answer of another profile never lands on this one.
    if (current !== sequence) return
    inventory.value = result
  } catch (e) {
    if (current !== sequence) return
    inventory.value = null
    error.value = e.message
    errorCode.value = e.details?.code || 'unreachable'
    errorFingerprint.value = e.details?.fingerprint || ''
  } finally {
    if (current === sequence) loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

async function loadMetrics() {
  if (!props.profileId) return
  metricsLoading.value = true
  metricsError.value = ''
  try {
    telemetry.value = await apiFetch('/api/cloud/proxmox/metrics?timeframe=day', { headers: { 'X-Profile-Id': props.profileId } })
  } catch (e) {
    metricsError.value = e.message
  } finally {
    metricsLoading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function stopMetricPolling() {
  if (metricTimer) clearInterval(metricTimer)
  metricTimer = null
}

function syncMetricPolling() {
  stopMetricPolling()
  if (props.profileId && props.activeService === 'metrics') {
    loadMetrics()
    metricTimer = setInterval(loadMetrics, 60_000)
  }
}

function chartPoints(points, metric) {
  const values = (points || []).map(point => point[metric]).filter(Number.isFinite)
  if (!values.length) return ''
  const low = Math.min(...values)
  const high = Math.max(...values)
  const spread = high - low || 1
  const source = (points || []).filter(point => Number.isFinite(point[metric]))
  return source.map((point, index) => `${source.length === 1 ? 60 : (index / (source.length - 1)) * 120},${30 - ((point[metric] - low) / spread) * 28}`).join(' ')
}

function formatMetric(value, metric) {
  if (!Number.isFinite(value)) return '—'
  if (metric.endsWith('Percent')) return `${value.toFixed(1)} %`
  return bytes(value) + '/s'
}

watch(() => props.profileId, () => { inventory.value = null; telemetry.value = null; load(); syncMetricPolling() })
watch(() => props.activeService, syncMetricPolling)
onMounted(() => { load(); syncMetricPolling() })
onBeforeUnmount(stopMetricPolling)
defineExpose({ load })
</script>

<style scoped>
.proxmox-view { padding: 16px; display: grid; gap: 12px; align-content: start; overflow: auto; }
.pve-metrics { display: grid; gap: 12px; }
.pve-metric-entity { border: 1px solid var(--border); border-radius: 8px; padding: 12px; display: grid; gap: 10px; }
.pve-metric-entity header { display: flex; gap: 8px; align-items: baseline; }
.pve-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 8px; }
.pve-metric-card { min-width: 0; display: grid; gap: 5px; padding: 8px; border-radius: 6px; background: var(--surface-raised); }
.pve-metric-card span { color: var(--text-dim); font-size: 12px; }
.pve-metric-card svg { width: 100%; height: 32px; overflow: visible; color: var(--accent); }
.pve-toolbar { display: flex; align-items: center; gap: 12px; }
.pve-toolbar h2 { margin: 0; font-size: 16px; display: inline-flex; align-items: center; gap: 8px; margin-right: auto; }
.pve-toolbar h2 small { font-weight: 400; color: var(--text-dim); font-size: 12px; }
.pve-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.pve-card { background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: grid; gap: 2px; }
.pve-card span, .pve-card small { color: var(--text-dim); font-size: 12px; }
.pve-card strong { font-size: 20px; }
.pve-card.warn { border-color: var(--yellow); }
.pve-unavailable { margin: 0; color: var(--yellow); font-size: 13px; }
.pve-hint { font-size: 12px; margin: 0; }
.pve-state.running, .pve-state.online, .pve-state.ok { color: var(--green); }
.pve-state.stopped, .pve-state.offline, .pve-state.error { color: var(--red); }
.pve-full { color: var(--yellow); font-weight: 600; }
.alert-error { display: grid; gap: 4px; }
</style>
