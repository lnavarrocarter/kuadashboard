<template>
  <div class="lq">
    <div class="lq-toolbar">
      <select v-model="source" class="ctrl-select" :aria-label="t('awsLogs.q.source')">
        <option value="cache" :disabled="!group.cache">{{ t('awsLogs.q.sourceCache') }}</option>
        <option value="live">{{ t('awsLogs.q.sourceLive') }}</option>
        <option v-if="logApi.insights" value="insights">{{ t('awsLogs.q.sourceInsights') }}</option>
      </select>
      <select v-model.number="minutes" class="ctrl-select" :aria-label="t('awsLogs.range')">
        <option v-for="r in LOG_RANGES" :key="r.minutes" :value="r.minutes">{{ r.label }}</option>
      </select>
      <button class="btn sm primary" :disabled="running || (!validation.ok && source !== 'insights')" @click="run">{{ running ? t('awsLogs.q.running') : t('awsLogs.q.run') }}</button>
      <button class="btn sm" :class="{ accent: helpOpen }" @click="helpOpen = !helpOpen">{{ t('awsLogs.q.helper') }}</button>
      <button class="btn sm" :title="t('awsLogs.q.copyHint')" @click="copyQuery">{{ t('awsLogs.q.copy') }}</button>
      <span class="lq-source-hint">{{ t(`awsLogs.q.sourceHint_${source}`) }}</span>
    </div>

    <div class="lq-editor">
      <textarea
        ref="editor"
        v-model="query"
        class="lq-textarea"
        spellcheck="false"
        :rows="Math.min(10, Math.max(3, query.split('\n').length + 1))"
        :aria-label="t('awsLogs.q.editor')"
        @input="refreshSuggestions"
        @click="refreshSuggestions"
        @keydown="onKeydown"
        @blur="closeSuggestionsSoon"
      ></textarea>
      <ul v-if="suggestions.items.length" class="lq-suggest" role="listbox">
        <li
          v-for="(item, i) in suggestions.items" :key="item.kind + item.label"
          role="option" :aria-selected="i === active" :class="{ active: i === active }"
          @mousedown.prevent="accept(item)"
        >
          <span class="lq-kind" :class="item.kind">{{ t(`awsLogs.q.kind_${item.kind}`) }}</span>
          <span class="lq-label">{{ item.label }}</span>
          <span v-if="item.detail" class="lq-detail">{{ item.detail }}</span>
        </li>
      </ul>
    </div>

    <div class="lq-status" :class="validation.ok ? 'ok' : 'err'">
      <template v-if="validation.ok">✓ {{ t('awsLogs.q.valid') }} <span class="text-dim">· {{ t('awsLogs.q.shortcuts') }}</span></template>
      <template v-else>
        ✗ {{ errorText(validation.error) }}
        <button v-if="validation.error.params?.suggestion" class="btn sm" @click="applySuggestion(validation.error)">{{ t('awsLogs.q.didYouMean', { word: validation.error.params.suggestion }) }}</button>
        <span v-if="source === 'insights'" class="text-dim"> · {{ t('awsLogs.q.insightsMayAccept') }}</span>
      </template>
    </div>

    <div v-if="helpOpen" class="lq-help">
      <section>
        <h5>{{ t('awsLogs.q.templates') }}</h5>
        <div class="lq-chips">
          <button v-for="tpl in templates" :key="tpl.id" class="btn sm" :title="tpl.query" @click="useTemplate(tpl)">{{ t(`awsLogs.tpl_${tpl.id}`) }}</button>
        </div>
      </section>
      <section>
        <h5>{{ t('awsLogs.q.addFilter') }}</h5>
        <div class="lq-row">
          <select v-model="builder.field" class="ctrl-select" :aria-label="t('awsLogs.q.field')">
            <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
          </select>
          <select v-model="builder.op" class="ctrl-select" :aria-label="t('awsLogs.q.operator')">
            <option v-for="op in BUILDER_OPERATORS" :key="op" :value="op">{{ t(`awsLogs.q.op_${opKey(op)}`) }}</option>
          </select>
          <input v-if="!['present', 'absent'].includes(builder.op)" v-model="builder.value" class="ctrl-input lq-value" :placeholder="builder.op === 'in' ? 'a, b, c' : t('awsLogs.q.value')" @keydown.enter.prevent="addFilter" />
          <button class="btn sm lq-add-filter" @click="addFilter">{{ t('awsLogs.q.add') }}</button>
          <code class="lq-preview">filter {{ conditionPreview }}</code>
        </div>
      </section>
      <section>
        <h5>{{ t('awsLogs.q.shape') }}</h5>
        <div class="lq-row">
          <span class="text-dim">{{ t('awsLogs.q.countBy') }}</span>
          <select v-model="shape.groupBy" class="ctrl-select" :aria-label="t('awsLogs.q.countBy')">
            <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
          </select>
          <button class="btn sm" @click="addStage(`stats count(*) as total by ${fieldRef(shape.groupBy)}`, 'sort total desc')">{{ t('awsLogs.q.add') }}</button>
          <span class="text-dim lq-sep">{{ t('awsLogs.q.overTime') }}</span>
          <select v-model="shape.bin" class="ctrl-select" :aria-label="t('awsLogs.q.overTime')">
            <option v-for="b in ['1m', '5m', '15m', '1h', '1d']" :key="b" :value="b">{{ b }}</option>
          </select>
          <button class="btn sm" @click="addStage(`stats count(*) as total by bin(${shape.bin})`, `sort bin(${shape.bin}) desc`)">{{ t('awsLogs.q.add') }}</button>
        </div>
        <div class="lq-row">
          <span class="text-dim">{{ t('awsLogs.q.sortBy') }}</span>
          <select v-model="shape.sortField" class="ctrl-select" :aria-label="t('awsLogs.q.sortBy')">
            <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
          </select>
          <select v-model="shape.sortDir" class="ctrl-select" :aria-label="t('awsLogs.q.direction')">
            <option value="desc">{{ t('awsLogs.q.desc') }}</option>
            <option value="asc">{{ t('awsLogs.q.asc') }}</option>
          </select>
          <button class="btn sm" @click="addStage(`sort ${fieldRef(shape.sortField)} ${shape.sortDir}`)">{{ t('awsLogs.q.add') }}</button>
          <span class="text-dim lq-sep">{{ t('awsLogs.q.limit') }}</span>
          <input v-model.number="shape.limit" type="number" min="1" max="10000" class="ctrl-input lq-num" :aria-label="t('awsLogs.q.limit')" />
          <button class="btn sm" @click="addStage(`limit ${shape.limit}`)">{{ t('awsLogs.q.add') }}</button>
        </div>
      </section>
      <details>
        <summary>{{ t('awsLogs.q.reference') }}</summary>
        <table class="msg-subtable">
          <tbody>
            <tr v-for="c in COMMANDS" :key="c.name">
              <td><code>{{ c.name }}</code></td>
              <td>{{ t(`awsLogs.q.cmd_${c.name}`) }}<div class="text-dim"><code>{{ c.syntax }}</code></div></td>
              <td><button class="btn sm" @click="addStage(c.example)">{{ t('awsLogs.q.insertExample') }}</button></td>
            </tr>
          </tbody>
        </table>
        <p class="lq-ref-line"><b>{{ t('awsLogs.q.operators') }}:</b> <code v-for="op in OPERATORS" :key="op">{{ op }}</code></p>
        <p class="lq-ref-line"><b>{{ t('awsLogs.q.aggregates') }}:</b> <code v-for="(sig, name) in AGGREGATES" :key="name">{{ sig }}</code></p>
        <p class="lq-ref-line"><b>{{ t('awsLogs.q.functions') }}:</b> <code v-for="(sig, name) in FUNCTIONS" :key="name">{{ sig }}</code></p>
        <p class="lq-ref-line text-dim">{{ t('awsLogs.q.regexTip') }}</p>
      </details>
    </div>

    <div v-if="confirm" class="activity-notice lq-confirm">
      <span v-if="confirm.estimatedBytes != null">{{ t('awsLogs.q.insightsEstimate', { size: formatBytes(confirm.estimatedBytes), cost: formatUsd(confirm.estimatedCostUsd) }) }}</span>
      <span v-else>{{ t('awsLogs.q.insightsUnknown') }}</span>
      <button class="btn sm primary" @click="startInsights">{{ t('awsLogs.q.runInsights') }}</button>
      <button class="btn sm" @click="confirm = null">{{ t('common.cancel') }}</button>
    </div>
    <div v-if="error" class="activity-notice">{{ error }}</div>

    <div v-if="result" class="lq-result">
      <div class="text-dim lq-meta">
        {{ t('awsLogs.q.resultMeta', { rows: result.rows.length, matched: result.statistics?.recordsMatched ?? '—', scanned: result.statistics?.recordsScanned ?? '—' }) }}
        <template v-if="result.statistics?.bytesScanned != null"> · {{ t('awsLogs.q.bytesScanned', { size: formatBytes(result.statistics.bytesScanned), cost: formatUsd(result.statistics.bytesScanned / 1024 ** 3 * 0.005) }) }}</template>
        <template v-if="result.status && result.status !== 'Complete'"> · {{ result.status }}</template>
      </div>
      <div v-if="result.coverage?.truncated" class="activity-notice">
        {{ result.source === 'live'
          ? t('awsLogs.q.liveTruncated', { n: result.coverage.events, to: formatTime(result.coverage.to, settings.lang) })
          : t('awsLogs.q.cacheTruncated', { n: result.coverage.events }) }}
      </div>
      <div v-if="timeChart" class="lq-chart">
        <select v-if="timeChart.numeric.length > 1" v-model="chartColumn" class="ctrl-select" :aria-label="t('awsLogs.chart.column')">
          <option v-for="column in timeChart.numeric" :key="column" :value="column">{{ column }}</option>
        </select>
        <LogHistogram
          :buckets="timeChart.buckets" :bin-ms="timeChart.binMs" :series="timeChart.series" :lang="settings.lang"
          :title="timeChart.column" :subtitle="t('awsLogs.chart.byTime', { field: timeChart.timeField })"
          :labels="{ total: t('awsLogs.chart.total'), time: t('awsLogs.chart.time'), table: t('awsLogs.chart.table'), chart: t('awsLogs.chart.chart'), empty: t('awsLogs.chart.empty'), zoomHint: '' }"
        />
      </div>
      <div v-if="!result.rows.length" class="empty-row">{{ t('awsLogs.q.noRows') }}</div>
      <div v-else class="lq-table-wrap">
        <table class="cloud-table lq-table">
          <thead><tr><th v-for="f in result.fields" :key="f">{{ f }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, i) in result.rows" :key="i">
              <td v-for="f in result.fields" :key="f" :class="{ 'lq-msg': f === '@message', 'lq-ts': f === '@timestamp' }">{{ row[f] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useLogApi } from './logApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { LOG_RANGES, formatBytes, formatTime } from '../../../lib/awsLogs'
import {
  AGGREGATES, BUILDER_OPERATORS, COMMANDS, FUNCTIONS, LAMBDA_FIELDS, OPERATORS,
  appendStage, buildCondition, discoverFields, fieldRef, suggest, templatesFor, validateQuery,
} from '../../../shared/logsQuery.mjs'
import LogHistogram from './LogHistogram.vue'
import { timeSeriesFromRows } from '../../../lib/awsLogs'

const props = defineProps({
  group: { type: Object, required: true },
  profileId: { type: String, default: '' },
  sampleEvents: { type: Array, default: () => [] },
})
const emit = defineEmits(['request-access', 'ingested'])
const logApi = useLogApi()
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()

const editor = ref(null)
const source = ref(props.group.cache ? 'cache' : 'live')
const minutes = ref(60)
const helpOpen = ref(true)
const running = ref(false)
const error = ref(null)
const result = ref(null)
const confirm = ref(null)
const active = ref(0)
const suggestions = ref({ from: 0, to: 0, items: [] })
let pollTimer = null
let blurTimer = null

const isJson = computed(() => props.sampleEvents.some(e => String(e.message || '').trim().startsWith('{')))
const templates = computed(() => templatesFor({ service: props.group.service, kind: props.group.kind, json: isJson.value }))
const query = ref(templates.value.find(tpl => tpl.id === 'recent')?.query || '')
const validation = computed(() => validateQuery(query.value))

const fields = computed(() => {
  const found = discoverFields(props.sampleEvents, { logGroup: props.group.name })
  const extra = props.group.service === 'lambda' ? LAMBDA_FIELDS : []
  const fromResult = result.value?.fields || []
  return [...new Set([...found, ...extra, ...fromResult])]
})

const chartColumn = ref('')
// A result with a time column (bin(), @timestamp…) and a numeric column is drawn as a chart.
const timeChart = computed(() => {
  const chart = timeSeriesFromRows(result.value?.fields, result.value?.rows, chartColumn.value)
  return chart && { ...chart, series: [{ key: 'value', label: chart.column, color: 'var(--lh-info)' }] }
})

const builder = reactive({ field: '@message', op: 'contains', value: '' })
const shape = reactive({ groupBy: '@logStream', bin: '5m', sortField: '@timestamp', sortDir: 'desc', limit: 100 })
const conditionPreview = computed(() => buildCondition(builder.field, builder.op, builder.value))

watch(() => props.group.cache, cached => { if (!cached && source.value === 'cache') source.value = 'live' })

function opKey(op) {
  return { '=': 'eq', '!=': 'ne', '>': 'gt', '>=': 'ge', '<': 'lt', '<=': 'le' }[op] || op
}

function formatUsd(value) {
  if (value == null || !Number.isFinite(value)) return '—'
  return value < 0.01 ? `< $0.01` : `$${value.toFixed(2)}`
}

function lineCol(pos) {
  const before = query.value.slice(0, pos ?? 0)
  const lines = before.split('\n')
  return { line: lines.length, col: lines[lines.length - 1].length + 1 }
}

function errorText(err) {
  if (!err) return ''
  const key = `awsLogs.qerr_${err.code}`
  const translated = t(key, err.params || {})
  const text = translated === key ? err.message : translated
  if (err.params?.pos == null) return text
  const { line, col } = lineCol(err.params.pos)
  return `${text} (${t('awsLogs.q.position', { line, col })})`
}

function applySuggestion(err) {
  const { pos, suggestion } = err.params
  const word = query.value.slice(pos).match(/^[\w@.]+/)?.[0]
  if (!word) return
  query.value = query.value.slice(0, pos) + suggestion + query.value.slice(pos + word.length)
}

function useTemplate(tpl) {
  query.value = tpl.query
  result.value = null
}

function addStage(...stages) {
  query.value = stages.reduce((q, stage) => appendStage(q, stage), query.value)
  nextTick(() => editor.value?.focus())
}

function addFilter() {
  addStage(`filter ${conditionPreview.value}`)
  builder.value = ''
}

async function copyQuery() {
  try {
    await navigator.clipboard.writeText(query.value)
    toast(t('awsLogs.q.copied'), 'success')
  } catch { /* clipboard unavailable */ }
}

// ── Autocomplete ──
function refreshSuggestions() {
  const el = editor.value
  if (!el) return
  const cursor = el.selectionStart
  const next = suggest(query.value, cursor, { fields: fields.value })
  const word = query.value.slice(next.from, cursor)
  // Do not offer what is already typed in full.
  next.items = next.items.filter(item => item.insert.trim() !== word)
  suggestions.value = next
  active.value = 0
}

function closeSuggestions() { suggestions.value = { from: 0, to: 0, items: [] } }
function closeSuggestionsSoon() { blurTimer = setTimeout(closeSuggestions, 150) }

function accept(item) {
  const { from, to } = suggestions.value
  query.value = query.value.slice(0, from) + item.insert + query.value.slice(to)
  const caret = from + item.insert.length
  closeSuggestions()
  nextTick(() => {
    editor.value?.focus()
    editor.value?.setSelectionRange(caret, caret)
    if (item.insert.endsWith(' ') || item.insert.endsWith('(')) refreshSuggestions()
  })
}

function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); run(); return }
  if (event.ctrlKey && event.key === ' ') { event.preventDefault(); refreshSuggestions(); return }
  const items = suggestions.value.items
  if (!items.length) return
  if (event.key === 'ArrowDown') { event.preventDefault(); active.value = (active.value + 1) % items.length }
  else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = (active.value - 1 + items.length) % items.length }
  else if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) { event.preventDefault(); accept(items[active.value]) }
  else if (event.key === 'Escape') closeSuggestions()
}

// ── Execution ──
function headers(json = false) {
  return { 'X-Profile-Id': props.profileId, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}

function fail(err) {
  error.value = err.details?.queryError ? errorText(err.details.queryError) : err.message
  if (err.details?.access) emit('request-access', { text: err.message, access: err.details.access })
}

async function run() {
  if (running.value) return
  error.value = null
  confirm.value = null
  closeSuggestions()
  if (source.value === 'insights') {
    try {
      confirm.value = await apiFetch(`/api/cloud/aws/cloudwatch/log-groups/insights/estimate?group=${encodeURIComponent(props.group.name)}&minutes=${minutes.value}`, { headers: headers() })
    } catch (err) { fail(err) }
    return
  }
  if (!validation.value.ok) return
  running.value = true
  try {
    result.value = await apiFetch(`${logApi.base}/log-groups/query`, {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ group: props.group.name, query: query.value, minutes: minutes.value, source: source.value }),
    })
    if (result.value.storedInCache) emit('ingested', result.value.storedInCache)
  } catch (err) { fail(err) } finally { running.value = false }
}

async function startInsights() {
  confirm.value = null
  running.value = true
  result.value = null
  try {
    const { queryId, region } = await apiFetch('/api/cloud/aws/cloudwatch/log-groups/insights', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ group: props.group.name, query: query.value, minutes: minutes.value }),
    })
    await poll(queryId, region, 0)
  } catch (err) { fail(err); running.value = false }
}

async function poll(queryId, region, attempt) {
  try {
    // Naming the group lets a finished query feed the group's cache and chart (if it is cached).
    const data = await apiFetch(`/api/cloud/aws/cloudwatch/logs-query/${encodeURIComponent(queryId)}?region=${encodeURIComponent(region)}&group=${encodeURIComponent(props.group.name)}`, { headers: headers() })
    result.value = { ...data, source: 'insights' }
    if (data.storedInCache) emit('ingested', data.storedInCache)
    if (['Scheduled', 'Running'].includes(data.status) && attempt < 120) {
      pollTimer = setTimeout(() => poll(queryId, region, attempt + 1), 1000)
      return
    }
    running.value = false
  } catch (err) { fail(err); running.value = false }
}

onBeforeUnmount(() => { clearTimeout(pollTimer); clearTimeout(blurTimer) })
</script>

<style scoped>
.lq { display: flex; flex-direction: column; gap: 8px; }
.lq-toolbar, .lq-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.lq-source-hint { font-size: 11px; color: var(--text-dim); }
.lq-editor { position: relative; }
.lq-textarea { width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px; line-height: 1.5; padding: 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-row); color: var(--text); resize: vertical; }
.lq-suggest { position: absolute; left: 8px; top: 100%; z-index: 20; margin: 2px 0 0; padding: 4px 0; list-style: none; min-width: 280px; max-width: 520px; max-height: 260px; overflow: auto; background: var(--bg-modal, var(--bg-row)); border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 6px 18px rgba(0, 0, 0, .3); font-size: 12px; }
.lq-suggest li { display: flex; gap: 8px; align-items: baseline; padding: 3px 8px; cursor: pointer; }
.lq-suggest li.active, .lq-suggest li:hover { background: var(--bg-sel); }
.lq-kind { font-size: 9px; text-transform: uppercase; letter-spacing: .4px; color: var(--text-dim); min-width: 62px; }
.lq-kind.command { color: var(--accent); }
.lq-kind.field { color: var(--green); }
.lq-kind.aggregate, .lq-kind.function { color: var(--yellow); }
.lq-label { font-family: monospace; }
.lq-detail { margin-left: auto; color: var(--text-dim); font-family: monospace; font-size: 11px; }
.lq-status { font-size: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lq-status.ok { color: var(--green); }
.lq-status.err { color: var(--red); }
.lq-help { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; }
.lq-help h5 { margin: 0 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-dim); }
.lq-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.lq-value { min-width: 180px; flex: 1 1 180px; max-width: 360px; }
.lq-num { width: 80px; }
.lq-sep { margin-left: 12px; }
.lq-preview { font-size: 11px; color: var(--text-dim); overflow-wrap: anywhere; }
.lq-help summary { cursor: pointer; font-size: 12px; color: var(--text-dim); }
.lq-ref-line { margin: 6px 0 0; font-size: 12px; display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; }
.lq-ref-line code, .lq-help td code { font-size: 11px; padding: 0 4px; border-radius: 3px; background: var(--bg-hover); }
.lq-confirm { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lq-meta { font-size: 11px; }
.lq-chart { display: flex; flex-direction: column; gap: 4px; }
.lq-chart select { align-self: flex-start; }
.lq-table-wrap { max-height: 480px; overflow: auto; }
.lq-table td { font-size: 12px; vertical-align: top; }
.lq-msg { font-family: monospace; font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 320px; }
.lq-ts { white-space: nowrap; font-family: monospace; font-size: 11px; }
</style>
