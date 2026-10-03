<template>
  <section class="cwl-section cwl-scans" data-test="log-scans">
    <div class="cwl-section-head">
      <h5>{{ t('awsLogs.scan.title') }}</h5>
      <span class="cwl-hint">{{ t('awsLogs.scan.hint', { days: maxDays }) }}</span>
    </div>

    <div class="cwl-toolbar">
      <input v-model.trim="form.group" class="ctrl-input cwl-search" list="cwl-scan-groups" :placeholder="t('awsLogs.scan.groupPlaceholder')" :aria-label="t('awsLogs.colGroup')" />
      <datalist id="cwl-scan-groups">
        <option v-for="name in groupNames" :key="name" :value="name" />
      </datalist>
      <select v-model.number="form.days" class="ctrl-select" :aria-label="t('awsLogs.scan.range')">
        <option v-for="d in DAY_OPTIONS" :key="d" :value="d">{{ dayLabel(d) }}</option>
      </select>
      <button class="btn sm" :disabled="!form.group || loading.estimate" data-test="scan-estimate" @click="estimate">{{ loading.estimate ? '…' : t('awsLogs.scan.estimate') }}</button>
      <button class="btn sm primary" :disabled="!estimateReady || loading.start" data-test="scan-start" @click="start">{{ loading.start ? '…' : t('awsLogs.scan.start') }}</button>
    </div>

    <div v-if="estimateData && estimateReady" class="cwl-scan-estimate" :class="{ warn: !estimateData.fits }" data-test="scan-estimate-result">
      <span>{{ t('awsLogs.scan.estimateText', { size: formatBytes(estimateData.estimatedBytes), days: estimateData.days, free: formatBytes(estimateData.freeBytes), budget: formatBytes(estimateData.budgetBytes) }) }}</span>
      <span v-if="estimateData.limitedBy">{{ t(`awsLogs.scan.limited_${estimateData.limitedBy}`, { days: estimateData.days }) }}</span>
      <span v-if="!estimateData.fits">{{ t('awsLogs.scan.mayNotFit') }}</span>
      <span v-if="!estimateData.cached">{{ t('awsLogs.scan.willCache') }}</span>
      <span class="text-dim">{{ t('awsLogs.scan.cost') }}</span>
    </div>

    <div v-if="error" class="activity-notice">{{ error }}</div>

    <table v-if="scans.length" class="cloud-table cwl-scan-table">
      <thead><tr>
        <th>{{ t('awsLogs.colGroup') }}</th>
        <th>{{ t('awsLogs.colRange') }}</th>
        <th>{{ t('awsLogs.scan.progress') }}</th>
        <th>{{ t('awsLogs.colEvents') }}</th>
        <th>{{ t('awsLogs.colStatus') }}</th>
        <th></th>
      </tr></thead>
      <tbody>
        <tr v-for="scan in scans" :key="scan.id" :data-test="`scan-${scan.id}`">
          <td class="cwl-name">{{ scan.logGroup }}</td>
          <td class="text-dim cwl-range">{{ formatTime(scan.from, settings.lang) }} → {{ formatTime(scan.to, settings.lang) }}</td>
          <td class="cwl-scan-progress">
            <div class="cwl-bar" role="progressbar" :aria-valuenow="percent(scan)" aria-valuemin="0" aria-valuemax="100"><div :style="{ width: `${percent(scan)}%` }"></div></div>
            <span class="text-dim">{{ percent(scan) }}%<template v-if="eta(scan)"> · {{ t('awsLogs.scan.eta', { time: eta(scan) }) }}</template></span>
          </td>
          <td class="activity-cell" :title="t('awsLogs.scan.pagesHint', { pages: scan.pages, fetched: scan.fetched })">{{ scan.inserted }}</td>
          <td>
            <span class="msg-chip" :class="STATUS_CLASS[scan.status] || ''" :title="scan.error || ''">{{ t(`awsLogs.scan.status_${scan.status}`) }}</span>
            <div v-if="scan.error" class="text-dim cwl-scan-error">{{ scan.error }}</div>
          </td>
          <td class="cwl-actions">
            <button v-if="scan.status === 'running' || scan.status === 'queued'" class="btn sm" :disabled="busy[scan.id]" @click="act(scan, 'pause')">{{ t('awsLogs.scan.pause') }}</button>
            <button v-if="RESUMABLE.includes(scan.status)" class="btn sm" :disabled="busy[scan.id]" @click="act(scan, 'resume')">{{ t('awsLogs.scan.resume') }}</button>
            <button v-if="scan.inserted > 0" class="btn sm" @click="emit('open', scan)">{{ t('awsLogs.scan.view') }}</button>
            <button v-if="!FINISHED.includes(scan.status)" class="btn sm" :disabled="busy[scan.id]" @click="act(scan, 'cancel')">{{ t('awsLogs.scan.cancel') }}</button>
            <button v-if="scan.status !== 'running'" class="btn sm danger" :disabled="busy[scan.id]" :title="t('awsLogs.scan.removeHint')" @click="remove(scan)">{{ t('awsLogs.remove') }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="text-dim">{{ t('awsLogs.scan.empty') }}</div>
  </section>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { formatBytes, formatTime } from '../../../lib/awsLogs'

const props = defineProps({
  profileId: { type: String, default: '' },
  groupNames: { type: Array, default: () => [] },
  // Prefills the form (e.g. "Scan" on a cached group row).
  prefill: { type: Object, default: null },
  pollMs: { type: Number, default: 3000 },
})
const emit = defineEmits(['open', 'changed', 'active', 'active-groups'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()

const BASE = '/api/cloud/aws/cloudwatch/log-scans'
const DAY_OPTIONS = [0.25, 0.5, 1, 2, 3, 4, 5]
const ACTIVE = ['running', 'queued']
const RESUMABLE = ['paused', 'error', 'budget']
const FINISHED = ['done', 'cancelled']
const STATUS_CLASS = { done: 'ok', running: 'ok', queued: '', paused: 'warn', budget: 'warn', error: 'err', cancelled: '' }

const scans = ref([])
const maxDays = ref(5)
const form = reactive({ group: '', days: 1 })
const estimateData = ref(null)
const error = ref('')
const busy = reactive({})
const loading = reactive({ estimate: false, start: false })
const clock = ref(Date.now())
let timer = null

const estimateReady = computed(() => !!estimateData.value && estimateData.value.group === form.group && estimateData.value.requestedDays === form.days)
const activeCount = computed(() => scans.value.filter(scan => ACTIVE.includes(scan.status)).length)

function headers(json = false) {
  return { 'X-Profile-Id': props.profileId, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}

function dayLabel(days) {
  return days < 1 ? t('awsLogs.scan.hours', { n: Math.round(days * 24) }) : t('awsLogs.days', { n: days })
}

function percent(scan) {
  return Math.floor((scan.progress || 0) * 100)
}

// Remaining time from the pace so far (only while running and once there is a pace).
function eta(scan) {
  if (scan.status !== 'running' || !scan.startedAt || !(scan.progress > 0.02)) return ''
  const elapsed = clock.value - scan.startedAt
  const remaining = (elapsed / scan.progress) * (1 - scan.progress)
  const minutes = Math.max(1, Math.round(remaining / 60000))
  return minutes < 60 ? t('awsLogs.scan.minutes', { n: minutes }) : t('awsLogs.scan.hours', { n: Math.round(minutes / 6) / 10 })
}

async function load() {
  if (!props.profileId) return
  try {
    const previous = new Map(scans.value.map(scan => [scan.id, scan.status]))
    const data = await apiFetch(BASE, { headers: headers(), background: true })
    maxDays.value = data.maxDays || 5
    scans.value = data.scans || []
    for (const scan of scans.value) {
      const before = previous.get(scan.id)
      if (before && ACTIVE.includes(before) && !ACTIVE.includes(scan.status)) {
        toast(t(`awsLogs.scan.finished_${scan.status === 'done' ? 'done' : 'stopped'}`, { group: scan.logGroup, n: scan.inserted }), scan.status === 'done' ? 'success' : 'error')
        emit('changed', scan)
      }
    }
    error.value = ''
  } catch (err) { error.value = err.message }
  emit('active', activeCount.value)
  emit('active-groups', [...new Set(scans.value.filter(scan => ACTIVE.includes(scan.status)).map(scan => scan.logGroup))])
  schedule()
}

function schedule() {
  clearTimeout(timer)
  timer = null
  clock.value = Date.now()
  if (activeCount.value) timer = setTimeout(load, props.pollMs)
}

async function estimate() {
  loading.estimate = true
  error.value = ''
  try {
    const query = new URLSearchParams({ group: form.group, days: form.days })
    estimateData.value = { ...(await apiFetch(`${BASE}/estimate?${query}`, { headers: headers() })), requestedDays: form.days }
  } catch (err) { error.value = err.message; estimateData.value = null } finally { loading.estimate = false }
}

async function start() {
  loading.start = true
  error.value = ''
  try {
    const result = await apiFetch(BASE, { method: 'POST', headers: headers(true), body: JSON.stringify({ group: form.group, days: form.days }) })
    toast(t('awsLogs.scan.started', { group: form.group }), 'success')
    estimateData.value = null
    emit('changed', result.scan)
    await load()
  } catch (err) { error.value = err.message } finally { loading.start = false }
}

async function act(scan, action) {
  busy[scan.id] = true
  try {
    await apiFetch(`${BASE}/${scan.id}/${action}`, { method: 'POST', headers: headers(true), body: '{}' })
    await load()
  } catch (err) { error.value = err.message } finally { busy[scan.id] = false }
}

async function remove(scan) {
  busy[scan.id] = true
  try {
    await apiFetch(`${BASE}/${scan.id}`, { method: 'DELETE', headers: headers() })
    await load()
  } catch (err) { error.value = err.message } finally { busy[scan.id] = false }
}

watch(() => props.prefill, value => {
  if (!value?.group) return
  form.group = value.group
  estimateData.value = null
}, { immediate: true })
watch(() => props.profileId, () => { scans.value = []; load() })

onMounted(load)
onUnmounted(() => clearTimeout(timer))

defineExpose({ load })
</script>

<style scoped>
/* Same look as the Logs tab sections (its styles are scoped to AwsLogsTab). */
.cwl-scans { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.cwl-scans h5 { margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-dim); }
.cwl-section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cwl-hint { font-size: 11px; color: var(--text-dim); }
.cwl-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cwl-search { min-width: 220px; flex: 1 1 220px; max-width: 420px; }
.cwl-name { font-family: monospace; font-size: 12px; overflow-wrap: anywhere; white-space: normal; }
.cwl-range { font-size: 11px; white-space: nowrap; }
.cwl-bar { height: 6px; border-radius: 3px; background: var(--bg-hover); overflow: hidden; }
.cwl-bar div { height: 100%; background: var(--accent); }
.cwl-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.cwl-scan-estimate { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; }
.cwl-scan-estimate.warn { border-color: color-mix(in srgb, var(--yellow) 55%, var(--border)); }
.cwl-scan-progress { min-width: 140px; }
.cwl-scan-progress .cwl-bar { margin-bottom: 2px; }
.cwl-scan-error { font-size: 11px; max-width: 280px; overflow-wrap: anywhere; }
</style>
