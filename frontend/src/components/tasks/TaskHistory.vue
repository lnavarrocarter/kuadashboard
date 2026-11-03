<template>
  <!-- Finished runs of the background tasks (#351): GET /api/system/tasks/history. -->
  <div class="task-history" data-test="task-history">
    <section class="history-summary" :aria-label="t('tasks.history.summary')">
      <div><span>{{ t('tasks.history.runs24h') }}</span><strong>{{ data?.summary24h.runs ?? '—' }}</strong></div>
      <div><span>{{ t('tasks.history.failed') }}</span><strong :class="{ bad: data?.summary24h.failed }">{{ data?.summary24h.failed ?? '—' }}</strong></div>
      <div><span>{{ t('tasks.history.cancelled') }}</span><strong>{{ data?.summary24h.cancelled ?? '—' }}</strong></div>
    </section>

    <label class="history-search">
      <i data-lucide="search"></i>
      <span class="visually-hidden">{{ t('tasks.history.searchLabel') }}</span>
      <input v-model="query" type="search" :placeholder="t('tasks.history.search')" data-test="history-search">
    </label>
    <div class="history-filters" role="group" :aria-label="t('tasks.history.filterLabel')">
      <button
        v-for="option in FILTERS" :key="option" class="history-filter" :class="{ active: outcome === option }"
        :aria-pressed="outcome === option ? 'true' : 'false'" :data-test="`history-filter-${option}`" @click="outcome = option">
        {{ t(`tasks.history.filter.${option}`) }}
      </button>
    </div>

    <p v-if="error" class="history-error" role="alert">{{ error }}</p>
    <p v-else-if="!data" class="history-note">{{ t('tasks.loading') }}</p>
    <p v-else-if="!days.length" class="history-note" data-test="history-empty">{{ t(query || outcome !== 'all' ? 'tasks.history.noMatch' : 'tasks.history.empty') }}</p>

    <section v-for="day in days" :key="day.key" class="history-day">
      <h3>{{ day.label }}<span>{{ day.summary }}</span></h3>
      <ol>
        <li v-for="run in day.runs" :key="run.id" :class="{ open: openId === run.id }" :data-test="`history-run-${run.id}`">
          <button class="history-row" :aria-expanded="openId === run.id ? 'true' : 'false'" @click="openId = openId === run.id ? null : run.id">
            <span class="history-time">{{ timeOf(run.finishedAt) }}</span>
            <span class="history-name">
              <strong>{{ nameOf(run) }}</strong>
              <small>{{ metaOf(run) }}</small>
              <small v-if="run.cost" class="history-cost">{{ formatCost(run.cost) }}</small>
            </span>
            <span class="history-end">
              <span class="history-duration">{{ run.durationMs == null ? '—' : duration(run.durationMs) }}</span>
              <span :class="['history-chip', `outcome-${run.outcome}`]">{{ t(`tasks.history.outcome.${run.outcome}`) }}</span>
            </span>
          </button>
          <div v-if="openId === run.id" class="history-detail" data-test="history-detail">
            <dl>
              <dt>{{ t('tasks.history.started') }}</dt><dd>{{ run.startedAt ? stamp(run.startedAt) : '—' }}</dd>
              <dt>{{ t('tasks.history.finished') }}</dt><dd>{{ stamp(run.finishedAt) }}</dd>
              <template v-if="run.errorCode"><dt>{{ t('tasks.errorCode') }}</dt><dd><code>{{ run.errorCode }}</code></dd></template>
              <dt>{{ t('tasks.history.cost') }}</dt><dd data-test="history-cost">{{ run.cost ? formatCost(run.cost) : t('tasks.history.noPricedCalls') }}</dd>
            </dl>
            <div class="history-actions">
              <button
                v-if="retryable.includes(run.taskId)" class="btn sm primary" :disabled="busy === `${run.taskId}:run`"
                data-test="history-retry" @click="emit('retry', run.taskId)">
                <i data-lucide="rotate-ccw"></i> {{ t('tasks.history.retry') }}
              </button>
              <button class="btn sm" data-test="history-copy" @click="copy(run)">
                <i data-lucide="copy"></i> {{ t(copiedId === run.id ? 'tasks.coordinator.copied' : 'tasks.coordinator.copy') }}
              </button>
            </div>
          </div>
        </li>
      </ol>
    </section>

    <p v-if="data" class="history-note">{{ t('tasks.history.retention', { days: data.retentionDays, runs: data.maxRuns }) }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'

const FILTERS = ['all', 'failed', 'cancelled', 'completed']
const DAY_MS = 24 * 60 * 60 * 1000

const props = defineProps({
  // (run) → the task's display name, the same one the task list uses.
  taskName: { type: Function, required: true },
  providerLabel: { type: Function, required: true },
  // Changes on every poll of the task list, so the history follows it.
  refreshKey: { type: [String, Number], default: '' },
  // duration(ms) → text, shared with the task list.
  formatDuration: { type: Function, required: true },
  // cost by provider → text (#353).
  formatCost: { type: Function, required: true },
  // Task ids that can run again now, and the action in progress ("<taskId>:run").
  retryable: { type: Array, default: () => [] },
  busy: { type: String, default: '' },
})
const emit = defineEmits(['retry'])
const { t } = useI18n()
const { apiFetch } = useApi()
const data = ref(null)
const error = ref('')
const query = ref('')
const outcome = ref('all')
const openId = ref(null)
const copiedId = ref(null)
let searchTimer = null
let disposed = false

const locale = () => (settings.lang === 'es' ? 'es' : 'en-US')
const nameOf = run => props.taskName({ id: run.taskId, name: run.name, type: run.type })
const duration = ms => props.formatDuration(ms)
const timeOf = value => new Intl.DateTimeFormat(locale(), { timeStyle: 'short' }).format(new Date(value))
const stamp = value => new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value))

function metaOf(run) {
  return [t(`tasks.history.type.${['scheduler', 'scan', 'collection'].includes(run.type) ? run.type : 'other'}`), run.provider ? props.providerLabel(run.provider) : null, run.errorCode]
    .filter(Boolean).join(' · ')
}

function dayKey(value) {
  const date = new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const days = computed(() => {
  const runs = data.value?.runs || []
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - DAY_MS)
  const groups = new Map()
  for (const run of runs) {
    const key = dayKey(run.finishedAt)
    if (!groups.has(key)) {
      const label = key === today ? t('tasks.history.today') : key === yesterday ? t('tasks.history.yesterday')
        : new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(run.finishedAt))
      groups.set(key, { key, label, runs: [] })
    }
    groups.get(key).runs.push(run)
  }
  return [...groups.values()].map(group => {
    const failed = group.runs.filter(run => run.outcome === 'failed').length
    return {
      ...group,
      summary: failed ? t('tasks.history.daySummaryFailed', { n: group.runs.length, failed }) : t('tasks.history.daySummary', { n: group.runs.length }),
    }
  })
})

async function load() {
  const params = new URLSearchParams()
  if (outcome.value !== 'all') params.set('outcome', outcome.value)
  if (query.value.trim()) params.set('q', query.value.trim())
  const suffix = params.toString() ? `?${params}` : ''
  try {
    const next = await apiFetch(`/api/system/tasks/history${suffix}`)
    if (disposed) return
    if (!next || !Array.isArray(next.runs) || !next.summary24h) throw new Error(t('tasks.invalidResponse'))
    data.value = next
    error.value = ''
  } catch (cause) {
    if (disposed) return
    const message = String(cause?.message || '')
    error.value = message.includes('<') ? t('tasks.invalidResponse') : message.slice(0, 180) || t('tasks.loadError')
  }
}

// Task ids and names, times, outcome and error code only: safe to attach to an issue.
async function copy(run) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(run, null, 2))
    copiedId.value = run.id
  } catch {
    error.value = t('tasks.coordinator.copyFailed')
  }
}

watch(outcome, load)
watch(query, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(load, 250)
})
watch(() => props.refreshKey, load)
watch([data, openId, copiedId], () => nextTick(() => createIcons({ icons })))
onMounted(load)
onUnmounted(() => { disposed = true; clearTimeout(searchTimer) })
</script>

<style scoped>
.task-history { display: flex; flex-direction: column; gap: 10px; padding-top: 14px; }
.history-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.history-summary > div { padding: 9px 11px; background: var(--bg-row); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 2px; }
.history-summary span { color: var(--text-dim); font-size: 11px; }
.history-summary strong { font-size: 18px; font-weight: 650; font-variant-numeric: tabular-nums; }
.history-summary strong.bad { color: var(--red); }
.history-search { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim); background: var(--bg); }
.history-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--text); font: inherit; }
.history-search :deep(svg) { width: 15px; height: 15px; flex-shrink: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.history-filters { display: flex; flex-wrap: wrap; gap: 6px; }
.history-filter { min-height: 30px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-dim); font: inherit; font-size: 12px; cursor: pointer; }
.history-filter.active { color: var(--text); border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.history-day h3 { display: flex; justify-content: space-between; margin: 8px 0 6px; color: var(--text-dim); font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
.history-day h3 span { font-weight: 500; letter-spacing: 0; text-transform: none; }
.history-day ol { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.history-day li { border-bottom: 1px solid var(--border); }
.history-day li:last-child { border-bottom: 0; }
.history-day li.open { background: var(--bg-row); }
.history-row { width: 100%; min-height: 48px; display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 12px; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.history-time { color: var(--text-dim); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.history-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.history-name strong { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-name small { color: var(--text-dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-end { display: flex; align-items: center; gap: 8px; }
.history-duration { font-size: 11px; font-variant-numeric: tabular-nums; }
.history-chip { padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 10px; white-space: nowrap; }
.outcome-completed { color: var(--green); }
.outcome-failed { color: var(--red); border-color: color-mix(in srgb, var(--red) 45%, var(--border)); }
.outcome-cancelled { color: var(--yellow); }
.history-detail { padding: 0 12px 12px 66px; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.history-cost { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.history-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.history-detail dl { margin: 0; display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 4px 10px; font-size: 11px; }
.history-detail dt { color: var(--text-dim); }
.history-detail dd { margin: 0; }
.history-detail code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.history-note { margin: 0; color: var(--text-dim); font-size: 11px; }
.history-error { margin: 0; padding: 8px 10px; color: var(--red); border-left: 3px solid var(--red); }
@media (max-width: 600px) { .history-detail { padding-left: 12px; } }
</style>
