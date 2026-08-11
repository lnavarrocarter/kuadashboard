<template>
  <section class="process-trace">
    <form class="trace-search" @submit.prevent="search">
      <div>
        <strong>{{ t('apm.processTraceTitle') }}</strong>
        <small>{{ t('apm.processTraceHint') }}</small>
      </div>
      <input v-model.trim="query" class="ctrl-input" :placeholder="t('apm.processTracePlaceholder')" :aria-label="t('apm.processTraceInput')" />
      <label class="trace-data-toggle">
        <input v-model="includeData" type="checkbox" />
        <span>{{ t('apm.traceIncludeData') }}</span>
      </label>
      <button class="btn primary" type="submit" :disabled="loading || query.length < 4">
        <i :data-lucide="loading ? 'loader-2' : 'route'"></i>
        {{ loading ? t('apm.tracingProcess') : t('apm.traceProcess') }}
      </button>
    </form>

    <div v-if="result" class="trace-results">
      <div class="trace-summary">
        <span>{{ t('apm.traceExecutions', { count: result.traces?.length || 0 }) }}</span>
        <span>{{ t('apm.traceAwsReads', { count: result.requests || 0 }) }}</span>
        <span v-if="result.searchedFlows != null">{{ t('apm.traceFlows', { count: result.searchedFlows }) }}</span>
      </div>
      <div v-if="!result.traces?.length" class="trace-empty">{{ t('apm.traceNotFound') }}</div>
      <section v-if="result.availableExecutions?.length" class="recent-executions">
        <strong>{{ t('apm.traceRecentExecutions') }}</strong>
        <button
          v-for="execution in result.availableExecutions"
          :key="execution.executionArn"
          type="button"
          :class="['execution-row', { active: result.traces?.[0]?.executionArn === execution.executionArn }]"
          @click="traceExecution(execution.executionArn)"
        >
          <span><b>{{ execution.name }}</b><small>{{ formatDate(execution.startDate) }}</small></span>
          <em :class="execution.status?.toLowerCase()">{{ execution.status }}</em>
        </button>
      </section>
      <article v-for="trace in result.traces" :key="trace.executionArn" class="trace-execution">
        <header>
          <div><strong>{{ trace.name }}</strong><small>{{ trace.executionArn }}</small></div>
          <span :class="['trace-status', trace.status?.toLowerCase()]">{{ trace.status }}</span>
        </header>
        <div class="trace-meta">
          <span>{{ formatDate(trace.startDate) }}</span>
          <span>{{ formatDuration(trace.durationMs) }}</span>
          <span v-if="trace.matchPaths?.length">{{ t('apm.traceMatches', { paths: trace.matchPaths.join(', ') }) }}</span>
        </div>
        <details>
          <summary>{{ t('apm.traceInputShape') }}</summary>
          <pre>{{ JSON.stringify(trace.inputShape, null, 2) }}</pre>
        </details>
        <details v-if="result.dataIncluded" open>
          <summary>{{ t('apm.traceExecutionData') }}</summary>
          <div class="data-grid">
            <section><strong>Request</strong><pre>{{ JSON.stringify(trace.request, null, 2) }}</pre></section>
            <section><strong>Response</strong><pre>{{ JSON.stringify(trace.response, null, 2) }}</pre></section>
          </div>
        </details>
        <ol class="trace-timeline">
          <li v-for="event in keyEvents(trace.timeline)" :key="event.id" :class="event.status">
            <span class="trace-dot"></span>
            <time>{{ formatTime(event.timestamp) }}</time>
            <div>
              <strong>{{ event.state || event.resource?.name || event.type }}</strong>
              <small>{{ [event.type, event.resource?.type].filter(Boolean).join(' · ') }}</small>
              <details v-if="result.dataIncluded && hasEventData(event)">
                <summary>{{ t('apm.traceEventData') }}</summary>
                <pre>{{ JSON.stringify(event.data, null, 2) }}</pre>
              </details>
            </div>
          </li>
        </ol>
      </article>
    </div>
  </section>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({ result: { type: Object, default: null }, loading: { type: Boolean, default: false } })
const emit = defineEmits(['trace'])
const { t } = useI18n()
const query = ref('')
const includeData = ref(false)

function search() { if (query.value.length >= 4) emit('trace', query.value, includeData.value) }
function traceExecution(executionArn) { query.value = executionArn; emit('trace', executionArn, includeData.value) }
function hasEventData(event) { return event.data && Object.keys(event.data).length > 0 }
function keyEvents(events = []) {
  return events.filter(event => event.state || event.resource || /^Execution(Start|Succeeded|Failed|Aborted|TimedOut)/.test(event.type))
}
function formatDate(value) { return value ? new Date(value).toLocaleString() : '-' }
function formatTime(value) { return value ? new Date(value).toLocaleTimeString() : '' }
function formatDuration(value) { return value == null ? t('apm.traceRunning') : `${(value / 1000).toFixed(2)} s` }
function renderIcons() { nextTick(() => createIcons({ icons })) }
watch(() => [props.loading, props.result], renderIcons, { deep: true })
watch(() => props.result?.dataIncluded, value => {
  if (typeof value === 'boolean') includeData.value = value
})
onMounted(renderIcons)
</script>

<style scoped>
.process-trace { display: flex; flex-direction: column; gap: 12px; }
.trace-search { display: grid; grid-template-columns: minmax(190px, 1fr) minmax(240px, 1.2fr) auto auto; align-items: center; gap: 10px; padding: 14px; border: 1px solid var(--border); background: var(--surface); }
.trace-search > div { display: flex; flex-direction: column; gap: 3px; }
.trace-search strong { font-size: 12px; }
.trace-search small, .trace-meta, .trace-summary { color: var(--text-dim); font-size: 9px; }
.trace-results { display: flex; flex-direction: column; gap: 10px; }
.trace-data-toggle { display: flex; align-items: center; gap: 6px; white-space: nowrap; color: var(--text-dim); font-size: 9px; }
.recent-executions { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 6px; padding: 10px; border: 1px solid var(--border); }
.recent-executions > strong { grid-column: 1 / -1; font-size: 10px; }
.execution-row { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); text-align: left; cursor: pointer; }
.execution-row.active { border-color: #58a6ff; }
.execution-row span { min-width: 0; display: flex; flex-direction: column; }
.execution-row b, .execution-row small { overflow: hidden; text-overflow: ellipsis; }
.execution-row b { font-size: 9px; }
.execution-row small, .execution-row em { color: var(--text-dim); font-size: 8px; font-style: normal; }
.execution-row em.succeeded { color: #3fb950; }
.execution-row em.failed, .execution-row em.timed_out, .execution-row em.aborted { color: #f85149; }
.trace-summary { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.trace-empty { padding: 28px; text-align: center; color: var(--text-dim); font-size: 11px; }
.trace-execution { padding: 14px; border: 1px solid var(--border); background: var(--bg-row); }
.trace-execution header { display: flex; justify-content: space-between; gap: 12px; }
.trace-execution header > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.trace-execution header small { overflow: hidden; text-overflow: ellipsis; color: var(--text-dim); font-size: 9px; }
.trace-status { font-size: 9px; color: #d29922; }
.trace-status.succeeded { color: #3fb950; }
.trace-status.failed, .trace-status.timed_out, .trace-status.aborted { color: #f85149; }
.trace-meta { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; }
details { margin: 8px 0; font-size: 10px; }
details summary { cursor: pointer; color: #58a6ff; }
details pre { max-height: 180px; overflow: auto; padding: 8px; background: var(--bg); border: 1px solid var(--border); font-size: 9px; }
.data-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.data-grid section { min-width: 0; }
.data-grid strong { font-size: 9px; }
.trace-timeline { list-style: none; margin: 12px 0 0; padding: 0 0 0 78px; display: flex; flex-direction: column; }
.trace-timeline li { position: relative; min-height: 46px; padding: 0 0 10px 20px; border-left: 1px solid var(--border); }
.trace-timeline time { position: absolute; right: calc(100% + 28px); width: 64px; text-align: right; color: var(--text-dim); font-size: 8px; }
.trace-dot { position: absolute; left: -5px; width: 9px; height: 9px; border: 2px solid #58a6ff; background: var(--bg-row); border-radius: 50%; }
.trace-timeline li.error .trace-dot { border-color: #f85149; }
.trace-timeline li.success .trace-dot { border-color: #3fb950; }
.trace-timeline div { display: flex; flex-direction: column; gap: 2px; }
.trace-timeline strong { font-size: 10px; }
.trace-timeline small { color: var(--text-dim); font-size: 8px; }
@media (max-width: 760px) { .trace-search, .data-grid { grid-template-columns: 1fr; } }
</style>