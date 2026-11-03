<template>
  <!-- The runs of a KUApps task coordinator (#330), redesigned in #351. -->
  <div class="coordinator-detail" data-test="coordinator-detail">
    <p v-if="error" class="runs-error" role="alert">{{ error }}</p>
    <template v-else-if="detail">
      <section class="saved" :aria-label="t('tasks.coordinator.executed')">
        <div class="saved-head">
          <span>{{ t('tasks.coordinator.ranOfAsked') }}</span>
          <strong>{{ detail.metrics.executed }} <small>{{ t('tasks.coordinator.ofAsked', { n: detail.metrics.requested }) }}</small></strong>
        </div>
        <div class="saved-bar" aria-hidden="true">
          <span v-for="part in savedParts" :key="part.key" :class="`saved-${part.key}`" :style="{ width: `${part.share}%` }"></span>
        </div>
        <div class="saved-legend">
          <span v-for="part in savedParts" :key="part.key"><i :class="`saved-${part.key}`"></i>{{ t(`tasks.coordinator.legend.${part.key}`, { n: part.count }) }}</span>
        </div>
      </section>

      <div class="coordinator-metrics" data-test="coordinator-metrics">
        <div v-for="metric in metrics" :key="metric.key">
          <span>{{ t(`tasks.coordinator.${metric.key}`) }}</span>
          <strong :class="{ good: metric.good }">{{ metric.value }}</strong>
        </div>
      </div>
      <p class="runs-note">{{ t('tasks.coordinator.window', { minutes: detail.windowMinutes }) }}</p>

      <section v-if="detail.metrics.byKey.length" class="timings">
        <h4>{{ t('tasks.coordinator.timings') }}</h4>
        <div v-for="row in timings" :key="row.key" class="timing-row">
          <code>{{ row.key }}</code>
          <div class="timing-bar" aria-hidden="true">
            <span class="p95" :style="{ width: row.p95w }"></span>
            <span class="p50" :style="{ width: row.p50w }"></span>
          </div>
          <span class="timing-label">{{ t('tasks.coordinator.percentiles', { runs: row.runs, p50: row.p50Ms, p95: row.p95Ms }) }}</span>
        </div>
        <p class="runs-note">{{ t('tasks.coordinator.timingsNote') }}</p>
      </section>

      <div class="runs-head">
        <h4>{{ t('tasks.coordinator.runs') }}</h4>
        <button class="btn sm" data-test="coordinator-copy" @click="copy">
          <i data-lucide="copy"></i> {{ t(copied ? 'tasks.coordinator.copied' : 'tasks.coordinator.copy') }}
        </button>
      </div>
      <ol class="coordinator-runs" data-test="coordinator-runs">
        <li v-for="run in detail.runs" :key="run.runId" :class="{ flagged: run.flags.length }" :data-test="`coordinator-run-${run.outcome}`">
          <span class="run-time">{{ clock(run.queuedAt) }}</span>
          <div class="run-main">
            <div class="run-head">
              <code>{{ run.key }}</code>
              <span class="chip">{{ t(`tasks.coordinator.kind.${run.kind}`) }}</span>
              <span v-if="run.trigger === 'invalidation'" class="chip">{{ t('tasks.coordinator.byInvalidation') }}</span>
            </div>
            <span class="run-work">{{ t('tasks.coordinator.work', { requests: run.requests, reconciles: run.reconciles, aws: run.awsCalls }) }}<template v-if="run.stores?.length"> · {{ t('tasks.coordinator.writes', { stores: run.stores.join(', ') }) }}</template><template v-if="run.invalidates.length"> · {{ t('tasks.coordinator.reloads', { parts: run.invalidates.join(', ') }) }}</template></span>
            <span v-for="mark in run.flags" :key="mark" class="run-flag">{{ t(`tasks.coordinator.flag.${mark}`) }}</span>
          </div>
          <div class="run-end">
            <span :class="['chip', `outcome-${run.outcome}`]">{{ t(`tasks.coordinator.outcome.${run.outcome}`) }}</span>
            <span class="run-duration">{{ run.durationMs == null ? '—' : `${run.durationMs} ms` }}</span>
          </div>
        </li>
      </ol>
      <p v-if="!detail.runs.length" class="runs-note">{{ t('tasks.coordinator.noRuns') }}</p>
    </template>
    <p v-else class="runs-note">{{ t('tasks.loading') }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'

const PREFIX = 'kuapps.coordinator.'
const props = defineProps({
  taskId: { type: String, required: true },
  // Changes on every poll of the task list, so the runs follow it.
  refreshKey: { type: [String, Number], default: '' },
})
const { t } = useI18n()
const { apiFetch } = useApi()
const detail = ref(null)
const error = ref('')
const copied = ref(false)

const savedParts = computed(() => {
  const metrics = detail.value?.metrics
  if (!metrics) return []
  const executed = Math.max(0, metrics.executed - metrics.cancelled)
  const parts = [
    { key: 'executed', count: executed },
    { key: 'shared', count: metrics.deduplicated },
    { key: 'cancelled', count: metrics.cancelled },
  ]
  const total = Math.max(1, parts.reduce((sum, part) => sum + part.count, 0))
  return parts.map(part => ({ ...part, share: Math.round(part.count / total * 100) }))
})

const metrics = computed(() => {
  const m = detail.value?.metrics || {}
  return [
    { key: 'coalescedWrites', value: m.coalescedWrites },
    { key: 'maxQueue', value: m.maxQueueDepth },
    { key: 'reconcilesPerWrite', value: m.reconcilesPerWrite ?? '—', good: m.reconcilesPerWrite != null && m.reconcilesPerWrite <= 1 },
    { key: 'awsCalls', value: m.awsCalls },
    { key: 'untracked', value: m.untracked ?? '—', good: m.untracked === 0 },
    { key: 'failed', value: m.failed ?? 0 },
  ]
})

const timings = computed(() => {
  const rows = detail.value?.metrics.byKey || []
  const max = Math.max(1, ...rows.map(row => row.p95Ms || 0))
  return rows.map(row => ({ ...row, p50w: `${Math.round((row.p50Ms || 0) / max * 100)}%`, p95w: `${Math.round((row.p95Ms || 0) / max * 100)}%` }))
})

function clock(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(settings.lang === 'es' ? 'es' : 'en-US', { timeStyle: 'short' }).format(date)
}

async function load() {
  try {
    const data = await apiFetch(`/api/system/tasks/kuapps/coordinators/${encodeURIComponent(props.taskId.slice(PREFIX.length))}`)
    if (!data || !Array.isArray(data.runs) || !data.metrics) throw new Error(t('tasks.invalidResponse'))
    detail.value = data
    error.value = ''
  } catch (cause) {
    const message = String(cause?.message || '')
    error.value = message.includes('<') ? t('tasks.invalidResponse') : message.slice(0, 180) || t('tasks.loadError')
  }
}

// Ids, task keys, timings and counters only: safe to attach to an issue.
async function copy() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(detail.value, null, 2))
    copied.value = true
  } catch {
    error.value = t('tasks.coordinator.copyFailed')
  }
}

watch(() => props.refreshKey, load)
watch([detail, copied], () => nextTick(() => createIcons({ icons })))
onMounted(load)
</script>

<style scoped>
.coordinator-detail { width: 100%; display: flex; flex-direction: column; gap: 12px; margin-top: 4px; }
.saved { padding: 12px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 8px; }
.saved-head { display: flex; justify-content: space-between; align-items: baseline; color: var(--text-dim); font-size: 12px; }
.saved-head strong { color: var(--text); font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
.saved-head small { color: var(--text-dim); font-size: 13px; font-weight: 500; }
.saved-bar { display: flex; gap: 2px; height: 8px; border-radius: 4px; overflow: hidden; background: var(--border); }
.saved-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--text); }
.saved-legend span { display: inline-flex; align-items: center; gap: 6px; }
.saved-legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.saved-executed { background: var(--accent); }
.saved-shared { background: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.saved-cancelled { background: color-mix(in srgb, var(--yellow) 55%, var(--border)); }
.coordinator-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.coordinator-metrics > div { padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.coordinator-metrics span { color: var(--text-dim); font-size: 10px; line-height: 1.3; }
.coordinator-metrics strong { font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; }
.coordinator-metrics strong.good { color: var(--green); }
.timings { display: flex; flex-direction: column; gap: 6px; }
h4 { margin: 0; color: var(--text-dim); font-size: 10px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
.timing-row { display: grid; grid-template-columns: minmax(0, 150px) minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 11px; }
.timing-row code, .run-head code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.timing-bar { position: relative; height: 7px; background: var(--border); border-radius: 4px; }
.timing-bar span { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
.timing-bar .p95 { background: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.timing-bar .p50 { background: var(--accent); }
.timing-label { color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
.runs-head { display: flex; justify-content: space-between; align-items: center; }
.coordinator-runs { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
.coordinator-runs li { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 11px; }
.coordinator-runs li:last-child { border-bottom: 0; }
.coordinator-runs li.flagged { background: color-mix(in srgb, var(--yellow) 7%, transparent); }
.run-time { color: var(--text-dim); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.run-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.run-head { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.run-work { color: var(--text-dim); overflow-wrap: anywhere; }
.run-flag { color: var(--yellow); }
.run-end { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.run-duration { font-variant-numeric: tabular-nums; }
.chip { padding: 1px 6px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-dim); font-size: 10px; white-space: nowrap; }
.outcome-completed { color: var(--green); }
.outcome-failed { color: var(--red); }
.outcome-cancelled, .outcome-stale { color: var(--yellow); }
.outcome-running, .outcome-queued { color: var(--accent); }
.runs-note { margin: 0; color: var(--text-dim); font-size: 11px; }
.runs-error { margin: 0; padding: 8px 10px; color: var(--red); border-left: 3px solid var(--red); }
</style>
