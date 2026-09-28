<template>
  <BaseModal :show="show" wide @close="emit('close')">
    <template #title><i data-lucide="layout-dashboard"></i> {{ name }}</template>

    <div class="cwd">
      <div v-if="loading" class="cwd-empty">{{ t('common.loading') }}</div>
      <div v-else-if="error" class="cwd-error"><i data-lucide="alert-triangle"></i>{{ error }}</div>

      <template v-else-if="detail">
        <div class="cwd-top">
          <div class="cwd-stats">
            <span class="cwd-stat"><strong>{{ detail.summary.widgets.length }}</strong> {{ t('awsDashboards.widgets') }}</span>
            <span class="cwd-stat"><strong>{{ detail.summary.metricCount }}</strong> {{ t('awsDashboards.metrics') }}</span>
            <span v-for="(count, type) in detail.summary.counts" :key="type" class="cwd-chip">{{ typeLabel(type) }} · {{ count }}</span>
            <span v-for="region in detail.summary.regions" :key="region" class="cwd-chip region">{{ region }}</span>
          </div>
          <a class="btn sm primary cwd-open" :href="detail.consoleUrl" target="_blank" rel="noopener noreferrer">
            <i data-lucide="external-link"></i> {{ t('awsDashboards.openConsole') }}
          </a>
        </div>

        <p v-if="!detail.summary.valid" class="cwd-note">{{ t('awsDashboards.invalidBody') }}</p>
        <table v-else-if="detail.summary.widgets.length" class="cwd-table">
          <thead>
            <tr>
              <th>{{ t('awsDashboards.colType') }}</th>
              <th>{{ t('awsDashboards.colTitle') }}</th>
              <th>{{ t('awsDashboards.colShows') }}</th>
              <th>{{ t('awsDashboards.colView') }}</th>
              <th>{{ t('awsDashboards.colRegion') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(w, i) in detail.summary.widgets" :key="i">
              <td><span :class="['cwd-type', w.type]">{{ typeLabel(w.type) }}</span></td>
              <td>{{ w.title || '—' }}</td>
              <td class="cwd-shows">{{ shows(w) }}</td>
              <td class="cwd-dim">{{ w.view || '—' }}</td>
              <td class="cwd-dim">{{ w.region || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="cwd-note">{{ t('awsDashboards.noWidgets') }}</p>

        <div class="cwd-json">
          <div class="cwd-json-head">
            <button class="aoi-link cwd-link" @click="showJson = !showJson">{{ t(showJson ? 'awsDashboards.hideJson' : 'awsDashboards.showJson') }}</button>
            <button v-if="showJson" class="btn sm" @click="copyJson"><i data-lucide="copy"></i> {{ t('awsOverview.copy') }}</button>
          </div>
          <pre v-if="showJson" class="cwd-pre">{{ jsonText }}</pre>
        </div>
      </template>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">{{ t('action.close') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from '../BaseModal.vue'
import { useAwsStore } from '../../stores/useAwsStore'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'

const props = defineProps({
  show: Boolean,
  name: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const awsStore = useAwsStore()
const { t } = useI18n()
const { toast } = useToast()

const detail = ref(null)
const loading = ref(false)
const error = ref(null)
const showJson = ref(false)
let requestId = 0

const jsonText = computed(() => (detail.value?.body ? JSON.stringify(detail.value.body, null, 2) : detail.value?.rawBody || ''))

const TYPE_KEYS = { metric: 'awsDashboards.typeMetric', log: 'awsDashboards.typeLog', alarm: 'awsDashboards.typeAlarm', text: 'awsDashboards.typeText', explorer: 'awsDashboards.typeExplorer', custom: 'awsDashboards.typeCustom' }
function typeLabel(type) {
  return TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : type
}

function shows(widget) {
  if (widget.type === 'metric') {
    const namespaces = widget.namespaces?.join(', ') || ''
    return t('awsDashboards.showsMetrics', { n: widget.metrics || 0, namespaces }) + (widget.expressions ? ` · ${t('awsDashboards.expressions', { n: widget.expressions })}` : '')
  }
  if (widget.type === 'log') return widget.logGroups?.length ? widget.logGroups.join(', ') : t('awsDashboards.logsInsightsQuery')
  if (widget.type === 'alarm') return t('awsDashboards.showsAlarms', { n: widget.alarms || 0 })
  if (widget.type === 'explorer') return t('awsDashboards.showsMetrics', { n: widget.metrics || 0, namespaces: '' })
  return '—'
}

async function load() {
  const id = ++requestId
  loading.value = true
  error.value = null
  detail.value = null
  showJson.value = false
  try {
    const data = await awsStore.fetchCwDashboard(props.name)
    if (id === requestId) detail.value = data
  } catch (e) {
    if (id === requestId) error.value = e.message
  } finally {
    if (id === requestId) loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText.value)
    toast(t('awsOverview.copied'), 'success')
  } catch {
    toast(t('awsOverview.copyFailed'), 'error')
  }
}

watch(() => [props.show, props.name], ([open, name]) => { if (open && name) load() }, { immediate: true })

defineExpose({ load })
</script>

<style scoped>
.cwd { display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.cwd-empty, .cwd-note { color: var(--text-dim); font-size: 12px; margin: 0; }
.cwd-error { display: flex; align-items: center; gap: 6px; color: var(--red); font-size: 12px; }
.cwd-error svg { width: 14px; height: 14px; }
.cwd-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cwd-stats { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; }
.cwd-stat strong { font-size: 16px; font-variant-numeric: tabular-nums; }
.cwd-chip { padding: 1px 8px; border-radius: 10px; font-size: 11px; border: 1px solid var(--border); color: var(--text-dim); }
.cwd-chip.region { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.cwd-open { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.cwd-open svg { width: 13px; height: 13px; }
.cwd-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cwd-table th { text-align: left; font-weight: 600; color: var(--text-dim); padding: 4px 8px; border-bottom: 1px solid var(--border); }
.cwd-table td { padding: 5px 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); vertical-align: top; }
.cwd-shows { word-break: break-word; }
.cwd-dim { color: var(--text-dim); white-space: nowrap; }
.cwd-type { display: inline-block; padding: 0 7px; border-radius: 9px; font-size: 11px; font-weight: 600; border: 1px solid var(--border); white-space: nowrap; }
.cwd-type.metric { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.cwd-type.log { color: var(--teal); border-color: color-mix(in srgb, var(--teal) 50%, var(--border)); }
.cwd-type.alarm { color: var(--yellow); border-color: color-mix(in srgb, var(--yellow) 50%, var(--border)); }
.cwd-json { display: flex; flex-direction: column; gap: 6px; }
.cwd-json-head { display: flex; align-items: center; gap: 10px; }
.cwd-json-head .btn { display: inline-flex; align-items: center; gap: 5px; }
.cwd-json-head .btn svg { width: 12px; height: 12px; }
.cwd-link { border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; padding: 0; }
.cwd-pre { margin: 0; max-height: 320px; overflow: auto; padding: 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-row); font-size: 11px; line-height: 1.5; font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; }
</style>
