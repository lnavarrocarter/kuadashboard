<template>
  <div class="lw">
    <div v-if="phase === 'estimating'" class="lw-state">{{ t('awsDashboards.estimating') }}</div>

    <div v-else-if="phase === 'confirm'" class="lw-state">
      <span>{{ t('awsDashboards.logsEstimate', { bytes: formatBytes(estimate?.estimatedBytes), cost: costText }) }}</span>
      <button class="btn sm" @click="run">{{ t('awsDashboards.runQuery') }}</button>
    </div>

    <div v-else-if="phase === 'running'" class="lw-state">{{ t('awsDashboards.queryRunning') }}</div>

    <div v-else-if="phase === 'error'" class="lw-state error">
      <span>{{ error?.message }}</span>
      <button v-if="error?.details?.access" class="lw-link" @click="emit('request-access', { access: error.details.access, message: error.message })">{{ t('awsAccess.requestAccess') }}</button>
      <button class="lw-link" @click="run">{{ t('common.retry') }}</button>
    </div>

    <template v-else-if="phase === 'done'">
      <div v-if="!result.rows.length" class="lw-state">{{ t('awsDashboards.noLogResults') }}</div>

      <template v-else-if="showBars">
        <div class="lw-scroll">
        <DashboardChart
          type="bar" horizontal :style="{ height: `${barRows.length * 18 + 30}px` }"
          :labels="barRows.map(r => r.label)"
          :datasets="[{ label: barField, data: barRows.map(r => r.value), backgroundColor: '#1f77b4', borderRadius: 4, borderSkipped: 'start', maxBarThickness: 16 }]"
          :format-value="fmt" :aria-label="widget.properties?.title || barField"
        />
        </div>
        <button v-if="result.rows.length > barRows.length" class="lw-link" @click="forceTable = true">
          {{ t('awsDashboards.moreRows', { n: result.rows.length - barRows.length }) }}
        </button>
      </template>

      <div v-else class="lw-table-wrap">
        <table class="lw-table">
          <thead><tr><th v-for="f in result.fields" :key="f">{{ f }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in shownRows" :key="i">
              <td v-for="f in result.fields" :key="f" :title="row[f]">{{ cell(f, row[f]) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="result.rows.length > shownRows.length" class="lw-more">{{ t('awsDashboards.rowsShown', { shown: shownRows.length, total: result.rows.length }) }}</div>
      </div>

      <div class="lw-foot">
        <span>{{ t('awsDashboards.bytesScanned', { bytes: formatBytes(result.statistics.bytesScanned), records: fmt(result.statistics.recordsMatched) }) }}</span>
        <button v-if="forceTable && canBar" class="lw-link" @click="forceTable = false">{{ t('awsDashboards.showChart') }}</button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import DashboardChart from './DashboardChart.vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { settings } from '../../../composables/useSettings'
import { formatBytes, formatNumber, numericField } from './dashboardFormat'

const props = defineProps({
  dashboard: { type: String, required: true },
  index: { type: Number, required: true },
  widget: { type: Object, required: true },
  range: { type: Object, required: true },
  refreshKey: { type: Number, default: 0 },
})
const emit = defineEmits(['request-access'])

const POLL_MS = 1000
const MAX_POLLS = 90
const TABLE_ROWS = 200
const BAR_ROWS = 25

const awsStore = useAwsStore()
const { t } = useI18n()
const phase = ref('estimating')
const estimate = ref(null)
const result = ref(null)
const error = ref(null)
const forceTable = ref(false)
let runId = 0
let timer = null

const fmt = v => formatNumber(v, settings.lang)
const costText = computed(() => {
  const cost = estimate.value?.estimatedCostUsd ?? 0
  return cost < 0.01 ? '< USD 0.01' : `~USD ${cost.toFixed(2)}`
})

// Bar view: first text column as category, first numeric column as value.
const barField = computed(() => (result.value ? numericField(result.value.fields, result.value.rows) : null))
const labelField = computed(() => result.value?.fields.find(f => f !== barField.value))
const canBar = computed(() => props.widget.properties?.view === 'bar' && !!barField.value && !!labelField.value)
const showBars = computed(() => canBar.value && !forceTable.value)
const barRows = computed(() => (result.value?.rows || []).slice(0, BAR_ROWS).map(row => ({ label: row[labelField.value] ?? '—', value: Number(row[barField.value]) })))
const shownRows = computed(() => (result.value?.rows || []).slice(0, TABLE_ROWS))

function cell(field, value) {
  if (value == null) return ''
  if (field === '@timestamp') return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US')
  return value
}

function stopPolling() {
  clearTimeout(timer)
  timer = null
}

async function prepare() {
  const id = ++runId
  stopPolling()
  phase.value = 'estimating'
  forceTable.value = false
  try {
    const est = await awsStore.estimateCwWidgetLogs(props.dashboard, props.index, props.range)
    if (id !== runId) return
    estimate.value = est
    if (est.autoRun) run()
    else phase.value = 'confirm'
  } catch (e) {
    if (id !== runId) return
    error.value = e
    phase.value = 'error'
  }
}

async function run() {
  const id = ++runId
  stopPolling()
  phase.value = 'running'
  try {
    const { queryId, region } = await awsStore.startCwWidgetLogs(props.dashboard, props.index, props.range)
    let polls = 0
    const poll = async () => {
      if (id !== runId) return
      try {
        const res = await awsStore.fetchCwLogsQuery(queryId, region)
        if (id !== runId) return
        if (res.status === 'Complete') {
          result.value = res
          phase.value = 'done'
        } else if (['Failed', 'Cancelled', 'Timeout', 'Unknown'].includes(res.status) || ++polls >= MAX_POLLS) {
          error.value = new Error(t('awsDashboards.queryFailed', { status: res.status }))
          phase.value = 'error'
        } else {
          timer = setTimeout(poll, POLL_MS)
        }
      } catch (e) {
        if (id !== runId) return
        error.value = e
        phase.value = 'error'
      }
    }
    timer = setTimeout(poll, POLL_MS)
  } catch (e) {
    if (id !== runId) return
    error.value = e
    phase.value = 'error'
  }
}

watch(() => [props.dashboard, props.index, props.range.start, props.range.end, props.refreshKey], prepare, { immediate: true })
onBeforeUnmount(() => { runId += 1; stopPolling() })

defineExpose({ run })
</script>

<style scoped>
.lw { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
.lw-state { margin: auto; font-size: 12px; color: var(--text-dim); text-align: center; display: flex; flex-direction: column; gap: 6px; align-items: center; max-width: 90%; }
.lw-state.error { color: var(--red); }
.lw-link { border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 11px; padding: 0; align-self: flex-start; }
.lw-state .lw-link { align-self: center; }
.lw-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.lw-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.lw-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.lw-table th { position: sticky; top: 0; background: var(--bg-panel); text-align: left; font-weight: 600; color: var(--text-dim); padding: 3px 6px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.lw-table td { padding: 3px 6px; border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent); max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; }
.lw-more { font-size: 11px; color: var(--text-dim); padding: 4px 6px; }
.lw-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: var(--text-dim); }
</style>
