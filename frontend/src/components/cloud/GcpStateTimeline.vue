<template>
  <div class="gi-root">
    <div class="gst-toolbar">
      <span class="gi-dim">
        {{ t('gst.intro') }}
        <template v-if="polling">{{ t('gst.polling') }} <strong :class="polling.enabled ? 'gst-on' : ''">{{ polling.enabled ? t('gst.every', { n: polling.intervalMinutes }) : t('gst.off') }}</strong></template>
      </span>
      <div class="gst-actions">
        <button class="btn sm" :disabled="loading" data-test="timeline-refresh" @click="load(true)">↺</button>
        <button class="btn sm" data-test="timeline-configure" @click="$emit('configure')">{{ t('gst.configure') }}</button>
      </div>
    </div>

    <div v-if="error" class="alert-error" style="margin:0">{{ error }}</div>
    <div v-else-if="loading && !events.length" class="gi-empty">{{ t('gst.loading') }}</div>
    <div v-else-if="!events.length" class="gi-empty" data-test="timeline-empty">
      {{ t('gst.empty') }}
    </div>

    <ol v-else class="gst-list" data-test="timeline">
      <li v-for="e in events" :key="e.id" :class="['gst-item', e.kind]">
        <span :class="['gst-dot', tone(e)]"></span>
        <div class="gst-body">
          <div class="gst-line">
            <template v-if="e.kind === 'state'">
              <span v-if="e.previousState" class="gi-badge">{{ e.previousState }}</span>
              <span v-if="e.previousState" class="gi-dim">→</span>
              <span :class="['gi-badge', tone(e)]">{{ e.state }}</span>
            </template>
            <template v-else>
              <strong>{{ actionLabel(e.action) }}</strong>
              <span class="gi-dim">{{ actionDetail(e) }}</span>
            </template>
            <span class="gst-source">{{ SOURCES.includes(e.source) ? t(`gst.source.${e.source}`) : e.source }}</span>
          </div>
          <div class="gi-dim gst-time" :title="new Date(e.observedAt).toLocaleString()">{{ new Date(e.observedAt).toLocaleString() }} · {{ relative(e.observedAt) }}</div>
        </div>
      </li>
    </ol>

    <button v-if="hasMore" class="btn sm" :disabled="loading" data-test="timeline-more" @click="load(false)">{{ t('gst.more') }}</button>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useGcpStore } from '../../stores/useGcpStore'
import { useI18n } from '../../composables/useI18n'
import './gcpInfo.css'

const props = defineProps({
  resourceType: { type: String, required: true },   // gcp-vm | gcp-cloud-run | gcp-sql
  resourceKey:  { type: String, required: true },
  active:       { type: Boolean, default: true },     // load only when the tab is visible
  reloadToken:  { type: Number, default: 0 },         // bump to force a reload (e.g. after an action)
})
defineEmits(['configure'])

const { t } = useI18n()
const gcpStore = useGcpStore()
const PAGE = 50
const SOURCES = ['observed', 'poll', 'user']
const ACTIONS = ['start', 'stop', 'create', 'delete', 'labels', 'ssh']

const events = ref([])
const loading = ref(false)
const error = ref('')
const hasMore = ref(false)
const polling = ref(null)
let loadedKey = ''

async function load(reset) {
  loading.value = true
  error.value = ''
  try {
    const before = reset ? null : events.value.at(-1)?.id
    const page = await gcpStore.fetchHistory(props.resourceType, props.resourceKey, { limit: PAGE, before })
    events.value = reset ? page : [...events.value, ...page]
    hasMore.value = page.length === PAGE
    loadedKey = `${props.resourceType}|${props.resourceKey}`
    if (reset) polling.value = await gcpStore.fetchPollSettings().catch(() => null)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(() => [props.active, props.resourceType, props.resourceKey, props.reloadToken], ([active], old) => {
  if (!active) return
  const key = `${props.resourceType}|${props.resourceKey}`
  const tokenChanged = old && old[3] !== props.reloadToken
  if (key !== loadedKey || tokenChanged || !events.value.length) load(true)
}, { immediate: true })

function tone(e) {
  const s = String(e.state || '').toUpperCase()
  if (e.kind === 'action') return e.action === 'delete' ? 'err' : 'ok'
  if (['RUNNING', 'READY', 'RUNNABLE'].includes(s)) return 'ok'
  if (['MISSING', 'FAILED', 'SUSPENDED'].includes(s)) return 'err'
  if (['TERMINATED', 'STOPPED'].includes(s)) return ''
  return 'warn'
}
// Cloud Run "start"/"stop" were minimum-instance changes: the history says so.
function actionLabel(a) {
  if (props.resourceType === 'gcp-cloud-run' && (a === 'start' || a === 'stop')) return t(`gst.action.run_${a}`)
  return ACTIONS.includes(a) ? t(`gst.action.${a}`) : a
}
function actionDetail(e) {
  const d = e.details || {}
  if (e.action === 'labels') {
    const parts = [
      ...Object.entries(d.added || {}).map(([k, v]) => `+${k}=${v}`),
      ...Object.entries(d.changed || {}).map(([k, c]) => `${k}: ${c.from}→${c.to}`),
      ...(d.removed || []).map(k => `-${k}`),
    ]
    return parts.join(', ')
  }
  if (e.action === 'ssh') return `${d.user || ''}${d.keyRenewed ? t('gst.keyRenewed') : ''}`
  if (d.minInstances != null) return t('gst.minInstances', { n: d.minInstances })
  if (d.estimatedMonthlyUsd != null) return t('gst.perMonth', { usd: Number(d.estimatedMonthlyUsd).toFixed(2) })
  return ''
}
function relative(iso) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return t('gst.justNow')
  if (s < 3600) return t('gst.minutesAgo', { n: Math.round(s / 60) })
  if (s < 86400) return t('gst.hoursAgo', { n: Math.round(s / 3600) })
  return t('gst.daysAgo', { n: Math.round(s / 86400) })
}
</script>

<style scoped>
.gst-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.gst-actions { display: flex; gap: 6px; }
.gst-on { color: var(--green); }
.gst-list { list-style: none; margin: 0; padding: 0 0 0 6px; border-left: 2px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
.gst-item { position: relative; padding-left: 14px; }
.gst-dot { position: absolute; left: -7px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--text-dim); border: 2px solid var(--bg); }
.gst-dot.ok { background: var(--green); }
.gst-dot.warn { background: var(--yellow); }
.gst-dot.err { background: var(--red); }
.gst-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.gst-source { margin-left: auto; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim); border: 1px solid var(--border); border-radius: 8px; padding: 0 6px; }
.gst-time { font-size: 11px; margin-top: 2px; }
</style>
