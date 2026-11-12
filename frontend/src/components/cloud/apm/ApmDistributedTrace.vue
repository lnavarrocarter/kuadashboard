<template>
  <section class="distributed-trace" data-test="distributed-trace">
    <header>
      <div>
        <strong>{{ t('apm.distributedTraceTitle') }}</strong>
        <small>{{ t('apm.distributedTraceHint') }}</small>
      </div>
      <span v-if="trace" :class="['coverage', `coverage-${trace.coverage}`]">{{ coverageLabel }}</span>
    </header>

    <form class="trace-search" @submit.prevent="loadTrace">
      <input v-model.trim="traceId" class="ctrl-input" :placeholder="t('apm.traceIdPlaceholder')" :aria-label="t('apm.traceIdLabel')" maxlength="32" autocomplete="off" spellcheck="false" />
      <button class="btn sm" type="submit" :disabled="loading || !validTraceId">{{ loading ? t('apm.loadingTrace') : t('apm.openTrace') }}</button>
    </form>

    <p v-if="error" class="trace-message error" role="alert">{{ error }}</p>
    <p v-else-if="!projectId" class="trace-message">{{ t('apm.traceArchitectureRequired') }}</p>

    <div v-if="trace" class="trace-result">
      <p class="coverage-note">{{ t('apm.traceCoverageNote') }}</p>
      <ol class="span-list">
        <li v-for="span in trace.spans" :key="span.spanId" class="span-item">
          <span class="span-dot" aria-hidden="true"></span>
          <div class="span-content">
            <div class="span-heading">
              <strong>{{ span.serviceName }}</strong>
              <span class="span-operation">{{ span.operation }}</span>
              <time>{{ formatTime(span.startTime) }}</time>
            </div>
            <small>{{ spanStatus(span) }}</small>
          </div>
          <div v-for="segment in segmentsFrom(span.spanId)" :key="`${segment.fromSpanId}:${segment.toSpanId}`" class="trace-segment">
            <template v-if="segment.inventoryNodes?.length">
              <p class="inventory-label">{{ t('apm.traceInventoryHops') }}</p>
              <div v-for="node in segment.inventoryNodes" :key="node.id" class="inventory-hop">
                <i data-lucide="network"></i>
                <span><strong>{{ node.name }}</strong><small>{{ node.provider }} · {{ node.resourceType }} · {{ t('apm.traceNotObserved') }}</small></span>
              </div>
            </template>
            <p v-else-if="segment.status !== 'observed'" class="trace-gap">{{ gapLabel(segment.reason) }}</p>
          </div>
        </li>
      </ol>

      <ul v-if="trace.gaps.length" class="trace-gaps">
        <li v-for="(gap, index) in trace.gaps" :key="`${gap.reason}:${gap.spanId || gap.toSpanId}:${index}`">{{ gapLabel(gap.reason) }}</li>
      </ul>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({
  application: { type: Object, default: null },
  profileId: { type: String, default: '' },
})
const { apiFetch } = useApi()
const { t } = useI18n()
const traceId = ref('')
const trace = ref(null)
const loading = ref(false)
const error = ref('')
const projectId = computed(() => props.application?.architectureProjectIds?.[0] || props.application?.architectureProjectId || '')
const validTraceId = computed(() => /^[a-f\d]{32}$/i.test(traceId.value))
const coverageLabel = computed(() => t(trace.value?.coverage === 'observed' ? 'apm.traceObservedCoverage' : 'apm.tracePartialCoverage'))

async function loadTrace() {
  if (!validTraceId.value || !projectId.value || !props.profileId) return
  loading.value = true
  error.value = ''
  trace.value = null
  try {
    const query = new URLSearchParams({ projectId: projectId.value })
    trace.value = await apiFetch(`/api/observability/otlp/traces/${traceId.value.toLowerCase()}/architecture?${query}`, {
      headers: { 'X-Profile-Id': props.profileId },
    })
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
  }
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString()
}

function spanStatus(span) {
  if (span.architecture.status === 'ambiguous') return t('apm.traceMappingAmbiguous')
  if (span.architecture.status !== 'matched') return t('apm.traceMappingMissing')
  return `${span.architecture.node.name} · ${span.architecture.method}`
}

function segmentsFrom(spanId) {
  return trace.value?.segments.filter(segment => segment.fromSpanId === spanId) || []
}

function gapLabel(reason) {
  const key = `apm.traceGap.${reason}`
  const translated = t(key)
  return translated === key ? t('apm.traceGap.unknown') : translated
}
</script>

<style scoped>
.distributed-trace { display: flex; flex-direction: column; gap: 12px; padding: 12px; color: var(--text); }
.distributed-trace > header, .span-heading { display: flex; align-items: center; gap: 9px; }
.distributed-trace > header > div { display: flex; flex-direction: column; gap: 3px; }
.distributed-trace small, .distributed-trace time { color: var(--text-dim); font-size: 11px; }
.distributed-trace > header .coverage { margin-left: auto; border-radius: 10px; padding: 3px 8px; font-size: 10px; background: var(--surface-2); }
.coverage-partial { color: var(--warning); }
.coverage-observed { color: var(--success); }
.trace-search { display: flex; gap: 8px; max-width: 600px; }
.trace-search input { flex: 1; min-width: 0; font-family: monospace; }
.trace-message, .coverage-note, .trace-gap { margin: 0; color: var(--text-dim); font-size: 12px; }
.trace-message.error, .trace-gaps { color: var(--warning); }
.trace-result { display: flex; flex-direction: column; gap: 10px; }
.span-list { list-style: none; margin: 0; padding: 0 0 0 8px; border-left: 1px solid var(--border); }
.span-item { position: relative; padding: 3px 0 12px 15px; }
.span-dot { position: absolute; left: -5px; top: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.span-content { display: flex; flex-direction: column; gap: 4px; }
.span-heading { flex-wrap: wrap; }
.span-operation { font-family: monospace; font-size: 11px; }
.span-heading time { margin-left: auto; }
.trace-segment { display: flex; flex-direction: column; gap: 6px; margin: -7px 0 8px 24px; }
.inventory-label { margin: 0; color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.inventory-hop { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px dashed var(--border); border-radius: 6px; }
.inventory-hop > span { display: flex; flex-direction: column; gap: 3px; }
.trace-gaps { margin: 0; padding-left: 20px; font-size: 11px; }
</style>
