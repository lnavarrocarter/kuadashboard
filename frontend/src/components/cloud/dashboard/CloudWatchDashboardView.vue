<template>
  <div class="cwv">
    <div class="cwv-toolbar">
      <button class="btn sm" :title="t('awsDashboards.back')" @click="emit('back')"><i data-lucide="arrow-left"></i></button>
      <h2 class="cwv-title">{{ name }}</h2>
      <div class="cwv-range" role="group" :aria-label="t('overview.timeRange')">
        <button
          v-for="preset in presets" :key="preset" :class="{ active: rangeSeconds === preset }"
          :aria-pressed="rangeSeconds === preset" @click="setRange(preset)"
        >{{ rangeLabel(preset) }}</button>
      </div>
      <label class="cwv-auto" :title="t('awsDashboards.autoRefreshHint')">
        <input v-model="autoRefresh" type="checkbox" /> {{ t('awsDashboards.autoRefresh') }}
      </label>
      <button class="btn sm" :title="t('action.refresh')" @click="refresh"><i data-lucide="refresh-cw"></i></button>
      <a v-if="detail" class="btn sm" :href="detail.consoleUrl" target="_blank" rel="noopener noreferrer">
        <i data-lucide="external-link"></i> {{ t('awsDashboards.openConsole') }}
      </a>
    </div>

    <div v-if="loading" class="cwv-state">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="cwv-state error">{{ error }}</div>
    <div v-else-if="detail && !widgets.length" class="cwv-state">{{ t('awsDashboards.noWidgets') }}</div>

    <div v-else-if="detail" class="cwv-grid">
      <section
        v-for="w in widgets" :key="w.index"
        :class="['cwv-widget', `type-${w.type}`]"
        :style="gridStyle(w)"
      >
        <header v-if="w.title" class="cwv-widget-head">
          <span class="cwv-widget-title" :title="w.title">{{ w.title }}</span>
        </header>
        <div class="cwv-widget-body">
          <MetricWidget
            v-if="w.type === 'metric'"
            :dashboard="name" :index="w.index" :widget="w.raw" :range="range" :refresh-key="metricRefreshKey"
            @request-access="openAccess"
          />
          <LogWidget
            v-else-if="w.type === 'log'"
            :dashboard="name" :index="w.index" :widget="w.raw" :range="logRange" :refresh-key="refreshKey"
            @request-access="openAccess"
          />
          <TextWidget v-else-if="w.type === 'text'" :markdown="w.raw.properties?.markdown || ''" />
          <AlarmWidget v-else-if="w.type === 'alarm'" :dashboard="name" :index="w.index" :refresh-key="metricRefreshKey" @request-access="openAccess" />
          <div v-else class="cwv-unsupported">
            <span>{{ t('awsDashboards.unsupported', { type: w.type }) }}</span>
            <a :href="detail.consoleUrl" target="_blank" rel="noopener noreferrer">{{ t('awsDashboards.openConsole') }}</a>
          </div>
        </div>
      </section>
    </div>

    <p v-if="detail" class="cwv-note">{{ t('awsDashboards.renderNote') }}</p>

    <AwsAccessRequestModal
      :show="!!accessFailure"
      :access="accessFailure?.access || null"
      :message="accessFailure?.message || ''"
      :identity="awsStore.overview?.identity || null"
      @close="accessFailure = null"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { createIcons, icons } from 'lucide'
import MetricWidget from './MetricWidget.vue'
import LogWidget from './LogWidget.vue'
import TextWidget from './TextWidget.vue'
import AlarmWidget from './AlarmWidget.vue'
import AwsAccessRequestModal from '../AwsAccessRequestModal.vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'
import { RANGE_PRESETS, rangeLabel } from './dashboardFormat'

const props = defineProps({ name: { type: String, required: true } })
const emit = defineEmits(['back'])

const AUTO_REFRESH_MS = 60 * 1000

const awsStore = useAwsStore()
const { t } = useI18n()
const detail = ref(null)
const loading = ref(false)
const error = ref(null)
const rangeSeconds = ref(3 * 3600)
const range = ref({ start: 0, end: 0 })
// Log widgets follow their own range: auto-refresh moves `range` for metrics
// only, so Logs Insights (billed per GB) never re-runs on its own.
const logRange = ref({ start: 0, end: 0 })
const refreshKey = ref(0)          // every widget, including log queries
const metricRefreshKey = ref(0)    // metrics and alarms only (auto-refresh)
const autoRefresh = ref(false)
const accessFailure = ref(null)
let timer = null

const presets = computed(() => {
  const list = [...RANGE_PRESETS]
  const own = detail.value?.defaultRangeSeconds
  if (own && !list.includes(own)) list.push(own)
  return list.sort((a, b) => a - b)
})

// Widgets in reading order, with their raw definition for the renderers.
// Untitled widgets use the summary's title (e.g. the metric name), like the console.
const widgets = computed(() => {
  const raw = detail.value?.body?.widgets || []
  const summaryTitles = new Map((detail.value?.summary?.widgets || []).map(w => [w.index, w.title]))
  return raw.map((widget, index) => ({
    index,
    type: widget.type || 'unknown',
    title: widget.properties?.title || (widget.type === 'text' ? null : summaryTitles.get(index)) || null,
    x: widget.x ?? 0, y: widget.y ?? 0, width: widget.width ?? 6, height: widget.height ?? 6,
    raw: widget,
  })).sort((a, b) => a.y - b.y || a.x - b.x)
})

function gridStyle(w) {
  return { gridColumn: `${w.x + 1} / span ${Math.min(24, w.width)}`, gridRow: `${w.y + 1} / span ${w.height}` }
}

function computeRange() {
  const end = Date.now()
  range.value = { start: end - rangeSeconds.value * 1000, end }
}

function setRange(seconds) {
  rangeSeconds.value = seconds
  computeRange()
  logRange.value = { ...range.value }
}

function refresh() {
  computeRange()
  logRange.value = { ...range.value }
  refreshKey.value += 1
  metricRefreshKey.value += 1
}

function openAccess(failure) {
  accessFailure.value = failure
}

async function load() {
  loading.value = true
  error.value = null
  try {
    detail.value = await awsStore.fetchCwDashboard(props.name)
    rangeSeconds.value = detail.value.defaultRangeSeconds || 3 * 3600
    computeRange()
    logRange.value = { ...range.value }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

// Auto-refresh only re-reads metrics and alarms; log queries (billed per GB) run on demand.
watch(autoRefresh, on => {
  clearInterval(timer)
  if (on) {
    timer = setInterval(() => {
      if (document.hidden) return
      computeRange()
      metricRefreshKey.value += 1
    }, AUTO_REFRESH_MS)
  }
})

watch(() => props.name, load)
onMounted(load)
onUnmounted(() => clearInterval(timer))

defineExpose({ refresh })
</script>

<style scoped>
.cwv { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.cwv-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cwv-toolbar .btn { display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
.cwv-toolbar .btn svg { width: 13px; height: 13px; }
.cwv-title { margin: 0 8px 0 2px; font-size: 14px; font-weight: 600; flex: 1; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cwv-range { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.cwv-range button { border: none; background: transparent; color: var(--text-dim); font: inherit; font-size: 11px; font-weight: 600; padding: 4px 9px; cursor: pointer; }
.cwv-range button + button { border-left: 1px solid var(--border); }
.cwv-range button:hover { color: var(--text); background: var(--bg-hover); }
.cwv-range button.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.cwv-auto { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-dim); cursor: pointer; }
.cwv-state { padding: 30px; text-align: center; font-size: 12px; color: var(--text-dim); }
.cwv-state.error { color: var(--red); }
/* CloudWatch lays dashboards out on a 24-column grid with ~30px rows. */
.cwv-grid { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); grid-auto-rows: 30px; gap: 8px; }
.cwv-widget { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); padding: 8px 10px; overflow: hidden; }
.cwv-widget.type-text { background: transparent; }
.cwv-widget-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.cwv-widget-title { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cwv-widget-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cwv-unsupported { margin: auto; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; color: var(--text-dim); }
.cwv-unsupported a { color: var(--accent); }
.cwv-note { margin: 0; font-size: 11px; color: var(--text-dim); }

@media (max-width: 900px) {
  .cwv-grid { grid-template-columns: minmax(0, 1fr); grid-auto-rows: auto; }
  .cwv-widget { grid-column: 1 !important; grid-row: auto !important; min-height: 220px; }
}
</style>
