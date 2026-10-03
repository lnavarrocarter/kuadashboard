<template>
  <div class="klv" data-test="kube-logs">
    <header class="klv-header">
      <div class="klv-title">
        <h2>{{ t('kubeLogs.title') }}</h2>
        <span class="text-dim">{{ store.currentContext }} · {{ namespaceLabel }}</span>
      </div>
      <div class="klv-views" role="tablist">
        <button v-for="v in ['workloads', 'cache']" :key="v" role="tab" :aria-selected="view === v" :class="['btn', 'sm', { accent: view === v }]" :data-test="`kube-logs-view-${v}`" @click="setView(v)">
          {{ t(`kubeLogs.view_${v}`) }}
          <span v-if="v === 'cache' && cache?.groups?.length" class="klv-count">{{ cache.groups.length }}</span>
          <span v-if="v === 'cache' && activeScans" class="klv-count klv-scanning" :title="t('awsLogs.scan.activeHint', { n: activeScans })">⟳ {{ activeScans }}</span>
        </button>
      </div>
      <button class="btn btn-icon" :title="t('kubeLogs.refresh')" :disabled="loading" @click="refresh"><i data-lucide="refresh-cw"></i></button>
    </header>
    <p class="text-dim klv-hint">{{ t('kubeLogs.hint') }}</p>
    <p v-if="error" class="activity-notice">{{ error }}</p>

    <LogScansPanel
      v-show="view === 'cache'"
      :profile-id="profileId"
      :group-names="groupNames"
      :prefill="scanPrefill"
      @changed="loadCache"
      @active="n => { activeScans = n }"
      @active-groups="groups => { scanningGroups = groups }"
    />

    <!-- Workloads of the namespace -->
    <template v-if="view === 'workloads'">
      <div class="klv-toolbar">
        <input v-model.trim="filter" class="ctrl-input klv-search" :placeholder="t('kubeLogs.filter')" :aria-label="t('kubeLogs.filter')" />
      </div>
      <p v-if="loading && !workloads.length" class="empty-row">{{ t('common.loading') }}</p>
      <p v-else-if="!visibleWorkloads.length" class="empty-row">{{ t('kubeLogs.noWorkloads') }}</p>
      <table v-else class="data-table klv-table" data-test="kube-logs-workloads">
        <thead>
          <tr><th>{{ t('kubeLogs.colWorkload') }}</th><th>{{ t('kubeLogs.colNamespace') }}</th><th>{{ t('kubeLogs.colPods') }}</th><th></th></tr>
        </thead>
        <tbody>
          <template v-for="w in visibleWorkloads" :key="w.group">
            <tr>
              <td>
                <span class="msg-chip">{{ t(`kubeLogs.kind_${w.kind}`) }}</span>
                <span class="klv-name">{{ w.name }}</span>
                <span v-if="w.cached" class="msg-chip ok">{{ t('kubeLogs.cached') }}</span>
              </td>
              <td>{{ w.namespace }}</td>
              <td :class="{ 'klv-bad': w.ready < w.pods }">{{ w.ready }}/{{ w.pods }}</td>
              <td class="klv-actions">
                <button v-if="!w.cached" class="btn sm" :disabled="busy === w.group" :data-test="`kube-logs-cache-${w.name}`" @click="enableCache(w)">{{ busy === w.group ? '…' : t('kubeLogs.cache') }}</button>
                <button v-else class="btn sm" @click="openIntelligence(w.group)">{{ t('awsLogs.intel.button') }}</button>
                <button class="btn sm" @click="toggleQuery(w)">{{ t('kubeLogs.query') }}</button>
                <button class="btn sm" :title="t('awsLogs.scan.rowHint')" @click="scan(w.group)">{{ t('awsLogs.scan.button') }}</button>
              </td>
            </tr>
            <tr v-if="queryGroup === w.group">
              <td colspan="4">
                <LogsQueryEditor :key="w.group" :group="{ name: w.group, cache: w.cached ? {} : null }" :profile-id="profileId" @ingested="loadCache" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>

    <!-- Cached workloads with their intelligence -->
    <template v-else>
      <div class="klv-toolbar">
        <span v-if="cache" class="text-dim">{{ t('kubeLogs.usage', { size: formatBytes(cache.totalBytes), budget: formatBytes(cache.budgetBytes), events: cache.totalEvents }) }}</span>
        <button class="btn sm" :disabled="syncing || !cache?.groups?.length" data-test="kube-logs-sync-all" @click="sync()">{{ syncing ? t('kubeLogs.syncing') : t('kubeLogs.syncAll') }}</button>
      </div>
      <p v-if="!cache?.groups?.length" class="empty-row">{{ t('kubeLogs.noCache') }}</p>
      <table v-else class="data-table klv-table" data-test="kube-logs-cache">
        <thead>
          <tr><th>{{ t('kubeLogs.colWorkload') }}</th><th>{{ t('kubeLogs.colEvents') }}</th><th>{{ t('kubeLogs.colSize') }}</th><th>{{ t('kubeLogs.colSynced') }}</th><th></th></tr>
        </thead>
        <tbody>
          <template v-for="c in cache.groups" :key="c.logGroup">
            <tr>
              <td class="klv-name">{{ c.logGroup }}</td>
              <td>{{ formatNumber(c.events || 0) }}</td>
              <td>{{ formatBytes(c.bytes) }}</td>
              <td class="text-dim">{{ c.lastSyncAt ? formatTime(c.lastSyncAt, settings.lang) : '—' }}<span v-if="c.lastSyncStatus === 'error'" class="msg-chip warn" :title="c.lastError">{{ t('kubeLogs.syncError') }}</span></td>
              <td class="klv-actions">
                <button class="btn sm" :class="{ accent: openGroup === c.logGroup }" @click="openIntelligence(c.logGroup)">{{ t('awsLogs.intel.button') }}</button>
                <button class="btn sm" :disabled="syncing" @click="sync(c.logGroup)">{{ t('kubeLogs.sync') }}</button>
                <button class="btn sm" :title="t('awsLogs.scan.rowHint')" @click="scan(c.logGroup)">{{ t('awsLogs.scan.button') }}</button>
                <button class="btn sm" :title="t('kubeLogs.removeHint')" @click="remove(c.logGroup)">{{ t('kubeLogs.remove') }}</button>
              </td>
            </tr>
            <tr v-if="openGroup === c.logGroup">
              <td colspan="5">
                <LogIntelligencePanel :key="c.logGroup" :group="c.logGroup" :profile-id="profileId" :revision="revision(c)" :scanning="scanningGroups.includes(c.logGroup)" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../../composables/useApi'
import { formatNumber, useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { useKubeStore } from '../../../stores/useKubeStore'
import { formatBytes, formatTime } from '../../../lib/awsLogs'
import { KUBE_LOG_API, provideLogApi } from './logApi'
import LogIntelligencePanel from './LogIntelligencePanel.vue'
import LogScansPanel from './LogScansPanel.vue'
import LogsQueryEditor from './LogsQueryEditor.vue'

// The shared panels (intelligence, scans, queries) talk to /api/kube-logs here.
provideLogApi(KUBE_LOG_API)

const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const store = useKubeStore()

const view = ref('workloads')
const workloads = ref([])
const cache = ref(null)
const filter = ref('')
const loading = ref(false)
const syncing = ref(false)
const busy = ref('')
const error = ref('')
const openGroup = ref('')
const queryGroup = ref('')
const scanPrefill = ref(null)
const activeScans = ref(0)
const scanningGroups = ref([])

const profileId = computed(() => `k8s:${store.currentContext}`)
const namespaceLabel = computed(() => (store.namespace === 'all' || !store.namespace ? t('kubeLogs.allNamespaces') : store.namespace))
const headers = (json = false) => ({ 'X-Profile-Id': profileId.value, ...(json ? { 'Content-Type': 'application/json' } : {}) })
const visibleWorkloads = computed(() => {
  const needle = filter.value.toLowerCase()
  return workloads.value.filter(w => !needle || w.group.toLowerCase().includes(needle))
})
const groupNames = computed(() => [...new Set([...(cache.value?.groups || []).map(g => g.logGroup), ...workloads.value.map(w => w.group)])])
// Changes when a sync or scan caches new events: the panel then offers to refresh.
const revision = group => `${group.events ?? ''}|${group.newest ?? ''}|${group.lastSyncAt ?? ''}`

async function loadWorkloads() {
  loading.value = true
  error.value = ''
  try {
    const data = await apiFetch(`/api/kube-logs/workloads?namespace=${encodeURIComponent(store.namespace || 'all')}`, { headers: headers() })
    workloads.value = data.workloads || []
  } catch (err) { error.value = err.message } finally { loading.value = false }
}

async function loadCache() {
  try {
    cache.value = await apiFetch('/api/kube-logs/log-cache', { headers: headers() })
    const cached = new Set(cache.value.groups.map(g => g.logGroup))
    workloads.value = workloads.value.map(w => ({ ...w, cached: cached.has(w.group) }))
  } catch (err) { error.value = err.message }
}

function refresh() {
  loadWorkloads()
  loadCache()
}

function setView(next) {
  view.value = next
  if (next === 'cache') loadCache()
}

async function enableCache(workload) {
  busy.value = workload.group
  try {
    const result = await apiFetch('/api/kube-logs/log-cache', { method: 'POST', headers: headers(true), body: JSON.stringify({ group: workload.group, historyHours: 24 }) })
    toast(t('kubeLogs.cachedToast', { name: workload.name, n: result.inserted ?? 0 }), 'success')
    await loadCache()
  } catch (err) { toast(err.message, 'error') } finally { busy.value = '' }
}

async function sync(group = null) {
  syncing.value = true
  try {
    const result = await apiFetch('/api/kube-logs/log-cache/sync', { method: 'POST', headers: headers(true), body: JSON.stringify(group ? { group } : {}) })
    const inserted = (result.results || []).reduce((sum, r) => sum + (r.inserted || 0), 0)
    toast(t('kubeLogs.syncedToast', { n: inserted }), 'success')
    cache.value = result
  } catch (err) { toast(err.message, 'error') } finally { syncing.value = false }
}

async function remove(group) {
  try {
    cache.value = await apiFetch(`/api/kube-logs/log-cache?group=${encodeURIComponent(group)}`, { method: 'DELETE', headers: headers() })
    if (openGroup.value === group) openGroup.value = ''
    await loadCache()
  } catch (err) { toast(err.message, 'error') }
}

function openIntelligence(group) {
  view.value = 'cache'
  openGroup.value = openGroup.value === group ? '' : group
  loadCache()
}

function toggleQuery(workload) {
  queryGroup.value = queryGroup.value === workload.group ? '' : workload.group
}

function scan(group) {
  view.value = 'cache'
  scanPrefill.value = { group, at: Date.now() }
}

watch(() => [store.namespace, store.currentContext], () => {
  openGroup.value = ''
  queryGroup.value = ''
  refresh()
})

const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(() => { refresh(); refreshIcons() })
onUpdated(refreshIcons)
</script>

<style scoped>
.klv { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; min-width: 0; overflow: auto; }
.klv-header { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.klv-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.klv-title h2 { margin: 0; font-size: 16px; }
.klv-title span { font-size: 12px; overflow-wrap: anywhere; }
.klv-views { display: flex; gap: 4px; margin-left: auto; }
.klv-count { margin-left: 6px; font-size: 10px; opacity: .8; }
.klv-scanning { color: var(--accent); opacity: 1; }
.klv-hint { margin: 0; font-size: 11px; }
.klv-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.klv-search { min-width: 220px; flex: 1 1 220px; max-width: 420px; }
.klv-table { width: 100%; }
.klv-table td { vertical-align: top; white-space: normal; }
.klv-name { font-family: monospace; font-size: 12px; overflow-wrap: anywhere; }
.klv-actions { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
.klv-bad { color: var(--yellow); }
</style>
