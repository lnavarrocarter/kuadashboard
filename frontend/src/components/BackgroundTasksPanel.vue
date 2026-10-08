<template>
  <Transition name="tasks-drawer" appear>
  <div v-if="show" class="background-tasks-backdrop" data-test="background-tasks" @click.self="emit('close')">
    <aside class="background-tasks-drawer" role="dialog" aria-modal="false" :aria-label="t('tasks.title')">
      <header class="tasks-header">
        <div class="tasks-title-row">
          <div>
            <h2>{{ t('tasks.title') }}</h2>
            <p>{{ t('tasks.processNote') }}</p>
            <p class="tasks-cost-note">{{ t('tasks.costNote') }}</p>
          </div>
          <div class="tasks-header-actions">
            <button class="btn btn-icon" :disabled="loading" :title="t('tasks.refresh')" :aria-label="t('tasks.refresh')" data-test="tasks-refresh" @click="load()">
              <i data-lucide="refresh-cw"></i>
            </button>
            <button class="btn btn-icon" :title="t('tasks.close')" :aria-label="t('tasks.close')" data-test="tasks-close" @click="emit('close')">
              <i data-lucide="x"></i>
            </button>
          </div>
        </div>
      </header>

      <div v-if="snapshot?.process" class="tasks-process" data-test="process-metrics">
        <div class="tasks-process-heading"><i data-lucide="activity"></i><strong>{{ t('tasks.processTitle') }}</strong></div>
        <div class="tasks-metric-grid">
          <div><span>{{ t('tasks.uptime') }}</span><strong>{{ formatDuration(snapshot.process.uptimeSeconds * 1000) }}</strong></div>
          <div><span>{{ t('tasks.cpu') }}</span><strong>{{ cpuTime }}</strong></div>
          <div><span>{{ t('tasks.memory') }} · RSS</span><strong>{{ formatMemory(snapshot.process.memoryBytes?.rss) }}</strong></div>
          <div><span>{{ t('tasks.memory') }} · Heap</span><strong>{{ formatMemory(snapshot.process.memoryBytes?.heapUsed) }}</strong></div>
        </div>
      </div>

      <main class="tasks-content" aria-live="polite">
        <div v-if="loading && !snapshot" class="tasks-state" data-test="tasks-loading">
          <i data-lucide="loader-circle" class="tasks-spinner"></i>{{ t('tasks.loading') }}
        </div>
        <div v-else-if="!snapshot" class="tasks-state tasks-error" role="alert" data-test="tasks-error">
          <i data-lucide="circle-alert"></i>
          <span>{{ error || t('tasks.loadError') }}</span>
          <button class="btn sm" data-test="tasks-retry" @click="load()">{{ t('tasks.retry') }}</button>
        </div>
        <template v-else>
          <div v-if="error" class="tasks-inline-error" role="alert" data-test="tasks-refresh-error">{{ error }}</div>
          <div v-if="!snapshot.tasks.length" class="tasks-state" data-test="tasks-empty">{{ t('tasks.empty') }}</div>
          <template v-for="section in sections" :key="section.key">
            <section v-if="section.items.length" class="tasks-section" :data-test="`tasks-section-${section.key}`">
              <h3>{{ t(section.title) }}<span>{{ section.items.length }}</span></h3>
              <TransitionGroup name="task-list" tag="div" class="task-list">
              <article v-for="task in section.items" :key="task.id" class="task-row" :data-test="`task-${task.id}`">
                <div class="task-main">
                  <div class="task-heading">
                    <div class="task-identity">
                      <strong>{{ taskName(task) }}</strong>
                      <span :class="['task-state-chip', `state-${task.state}`]">{{ t(`tasks.state.${task.state}`) }}</span>
                      <span class="task-provider">{{ providerLabel(taskProvider(task)) }}</span>
                    </div>
                    <div class="task-actions">
                      <button
                        v-for="action in task.availableActions || []" :key="action"
                        class="btn btn-icon sm" :class="{ danger: action === 'cancel' }"
                        :disabled="busyAction === `${task.id}:${action}`"
                        :title="t(`tasks.action.${action}`)" :aria-label="t(`tasks.action.${action}`)"
                        :data-test="`task-action-${task.id}-${action}`" @click="control(task, action)">
                        <i :data-lucide="ACTION_ICONS[action]"></i>
                      </button>
                    </div>
                  </div>
                  <p v-if="taskDescription(task)" class="task-description">{{ t(taskDescription(task)) }}</p>
                  <p v-if="task.detail" class="task-detail">{{ t('tasks.context', { detail: task.detail }) }}</p>
                  <div class="task-meta">
                    <span>{{ t(ACTIVE_STATES.includes(task.state) ? 'tasks.startedAt' : 'tasks.lastRun') }}: {{ formatTime(ACTIVE_STATES.includes(task.state) ? task.startedAt : (task.lastFinishedAt || task.lastRunAt)) }}</span>
                    <span v-if="task.startedAt && (ACTIVE_STATES.includes(task.state) || task.lastFinishedAt)">{{ t(ACTIVE_STATES.includes(task.state) ? 'tasks.elapsed' : 'tasks.duration') }}: {{ taskDuration(task) }}</span>
                  </div>
                  <div class="task-cost" :data-test="`task-cost-${task.id}`">
                    <span>{{ taskCost(task).label }}</span>
                    <small v-if="taskCost(task).potential">{{ taskCost(task).potential }}</small>
                  </div>
                  <div v-if="task.progress !== null && task.progress !== undefined && ACTIVE_STATES.includes(task.state)" class="task-progress">
                    <div role="progressbar" :aria-label="t('tasks.progress')" :aria-valuenow="Math.round(task.progress * 100)" aria-valuemin="0" aria-valuemax="100">
                      <span :style="{ width: `${Math.round(task.progress * 100)}%` }"></span>
                    </div>
                    <small>{{ Math.round(task.progress * 100) }}%</small>
                  </div>
                  <div v-if="task.errorCode" class="task-error-code"><i data-lucide="circle-alert"></i><span>{{ t('tasks.errorCode') }}: <code>{{ task.errorCode }}</code></span></div>
                </div>
              </article>
              </TransitionGroup>
            </section>
          </template>
        </template>
      </main>
    </aside>
  </div>
  </Transition>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'
import { settings } from '../composables/useSettings'

const props = defineProps({
  show: { type: Boolean, default: false },
  pollMs: { type: Number, default: 10000 },
})
const emit = defineEmits(['close'])
const { t } = useI18n()
const { apiFetch } = useApi()
const snapshot = ref(null)
const usage = ref(null)
const loading = ref(false)
const error = ref('')
const busyAction = ref('')
const clock = ref(Date.now())
const ACTIVE_STATES = ['running', 'pause_requested', 'cancellation_requested']
const ACTION_ICONS = { pause: 'pause', resume: 'play', cancel: 'x' }
const NAME_KEYS = {
  'apm.collection': 'tasks.task.apm',
  'logs.refresh': 'tasks.task.logsRefresh',
  'apps.sync': 'tasks.task.appsSync',
  'team.sync': 'tasks.task.teamSync',
  'advisor.scan': 'tasks.task.advisor',
}
const DESCRIPTION_KEYS = {
  'apm.collection': 'tasks.description.apm',
  'logs.refresh': 'tasks.description.logsRefresh',
  'apps.sync': 'tasks.description.appsSync',
  'team.sync': 'tasks.description.teamSync',
  'advisor.scan': 'tasks.description.advisor',
}
const PROVIDER_LABELS = {
  aws: 'AWS', gcp: 'Google Cloud', kubernetes: 'Kubernetes', vercel: 'Vercel',
  mixed: 'AWS + Kubernetes', kua: 'KUA', local: 'Local',
}
const LEGACY_TASK_PROVIDERS = {
  'apm.collection': 'mixed',
  'logs.refresh': 'mixed',
  'apps.sync': 'kua',
  'team.sync': 'kua',
  'advisor.scan': 'mixed',
}
const COST_FEATURES = {
  'apm.collection': 'observability',
  'logs.refresh': 'log-refresh',
}
const sections = computed(() => {
  const tasks = snapshot.value?.tasks || []
  return [
    { key: 'active', title: 'tasks.active', items: tasks.filter(task => ACTIVE_STATES.includes(task.state)) },
    { key: 'scheduled', title: 'tasks.scheduled', items: tasks.filter(task => ['scheduled', 'paused', 'idle'].includes(task.state)) },
    { key: 'recent', title: 'tasks.recent', items: tasks.filter(task => ['completed', 'error', 'cancelled'].includes(task.state)).sort((a, b) => Date.parse(b.lastFinishedAt || b.lastRunAt || 0) - Date.parse(a.lastFinishedAt || a.lastRunAt || 0)).slice(0, 8) },
  ]
})
const cpuTime = computed(() => formatDuration(((snapshot.value?.process?.cpuMicros?.user || 0) + (snapshot.value?.process?.cpuMicros?.system || 0)) / 1000))
let timer = null
let request = null
let disposed = false
let mounted = false
let listenersAttached = false
let clockTimer = null
let usageLoadedAt = 0
let usageRequest = null

function taskName(task) {
  if (task.type === 'collection') return t('tasks.task.applicationCollection', { name: task.name })
  if (task.type === 'scan') return t('tasks.task.scan', { id: task.id.split('.').at(-1) })
  const key = NAME_KEYS[task.id]
  return key ? t(key) : task.name
}

function taskDescription(task) {
  if (task.type === 'collection') return 'tasks.description.applicationCollection'
  return DESCRIPTION_KEYS[task.id] || ''
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || t('tasks.providerUnknown')
}

function taskProvider(task) {
  return task.provider || LEGACY_TASK_PROVIDERS[task.id] || null
}

function formatUsd(value) {
  const amount = Number(value) || 0
  return new Intl.NumberFormat(settings.lang === 'es' ? 'es' : 'en-US', {
    style: 'currency', currency: 'USD', maximumSignificantDigits: 4,
  }).format(amount)
}

function taskCost(task) {
  const feature = task.type === 'scan' ? 'log-scans' : task.type === 'collection' ? 'observability' : COST_FEATURES[task.id]
  if (!feature || !['aws', 'mixed'].includes(taskProvider(task))) return { label: t('tasks.costNotTracked'), potential: '' }
  if (!usage.value) return { label: t('tasks.costLoading'), potential: '' }
  if (usage.value.enabled === false) return { label: t('tasks.costDisabled'), potential: '' }
  if (usage.value.unavailable) return { label: t('tasks.costUnavailable'), potential: '' }
  const row = usage.value.byFeature?.find(item => item.feature === feature)
  if (!row) return { label: t('tasks.costNoRecorded'), potential: '' }
  return {
    label: t('tasks.costEstimate', { usd: formatUsd(row.usd) }),
    potential: Number(row.potentialUsd) > 0 ? t('tasks.costPotential', { usd: formatUsd(row.potentialUsd) }) : '',
  }
}

function formatDuration(milliseconds) {
  const seconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours) return t('tasks.hoursMinutes', { hours, minutes })
  return t('tasks.minutesSeconds', { minutes, seconds: seconds % 60 })
}

function formatMemory(bytes) {
  const megabytes = Math.max(0, Number(bytes) || 0) / (1024 * 1024)
  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`
}

function formatTime(value) {
  if (!value) return t('tasks.never')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('tasks.never')
  return new Intl.DateTimeFormat(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function taskDuration(task) {
  const started = Date.parse(task.startedAt)
  const finished = ACTIVE_STATES.includes(task.state) ? clock.value : Date.parse(task.lastFinishedAt)
  return Number.isFinite(started) && Number.isFinite(finished) ? formatDuration(finished - started) : t('tasks.never')
}

function safeErrorMessage(value) {
  const message = String(value || '')
  return message.includes('<') ? t('tasks.invalidResponse') : message.slice(0, 180) || t('tasks.loadError')
}

async function load() {
  if (request) return request
  loading.value = !snapshot.value
  request = (async () => {
    try {
      const data = await apiFetch('/api/system/tasks')
      if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) throw new Error(t('tasks.invalidResponse'))
      if (disposed) return
      snapshot.value = data
      error.value = ''
    } catch (cause) {
      if (!disposed) error.value = safeErrorMessage(cause?.message)
    } finally {
      if (!disposed) loading.value = false
    }
  })()
  await request
  request = null
  if (!disposed && (!usage.value || Date.now() - usageLoadedAt >= 60000)) loadUsage()
}

async function loadUsage() {
  if (usageRequest) return usageRequest
  usageRequest = (async () => {
    try {
      const data = await apiFetch('/api/system/usage?days=30')
      if (!disposed) usage.value = data?.enabled === false
        ? data
        : data && typeof data === 'object' && Array.isArray(data.byFeature) ? data : { unavailable: true }
    } catch {
      if (!disposed) usage.value = { unavailable: true }
    } finally {
      usageLoadedAt = Date.now()
      usageRequest = null
    }
  })()
  return usageRequest
}

async function control(task, action) {
  const key = `${task.id}:${action}`
  busyAction.value = key
  error.value = ''
  try {
    await apiFetch(`/api/system/tasks/${encodeURIComponent(task.id)}/${encodeURIComponent(action)}`, { method: 'POST' })
    await load()
  } catch (cause) {
    if (!disposed) error.value = safeErrorMessage(cause?.message)
  } finally {
    if (!disposed) busyAction.value = ''
  }
}

function refreshOnRestore() {
  if (document.visibilityState !== 'hidden') load()
}

function drawIcons() { nextTick(() => createIcons({ icons })) }
watch(snapshot, drawIcons, { deep: true })
watch(() => props.show, visible => {
  if (!mounted) return
  if (visible) start()
  else stop()
})

function start() {
  if (!props.show || listenersAttached) return
  disposed = false
  load()
  timer = window.setInterval(() => {
    if (document.visibilityState !== 'hidden') load()
  }, Math.max(5000, props.pollMs))
  clockTimer = window.setInterval(() => { clock.value = Date.now() }, 1000)
  document.addEventListener('visibilitychange', refreshOnRestore)
  window.addEventListener('focus', refreshOnRestore)
  listenersAttached = true
}

function stop() {
  disposed = true
  window.clearInterval(timer)
  window.clearInterval(clockTimer)
  timer = null
  clockTimer = null
  document.removeEventListener('visibilitychange', refreshOnRestore)
  window.removeEventListener('focus', refreshOnRestore)
  listenersAttached = false
}

onMounted(() => {
  mounted = true
  if (props.show) start()
  drawIcons()
})

onUnmounted(() => {
  mounted = false
  stop()
})
</script>

<style scoped>
.background-tasks-backdrop { position: fixed; inset: 0; z-index: 1200; display: flex; justify-content: flex-end; background: rgba(0, 0, 0, .42); }
.background-tasks-drawer { width: min(520px, 100vw); height: 100%; display: flex; flex-direction: column; overflow: hidden; color: var(--text); background: var(--bg-panel); border-left: 1px solid var(--border); box-shadow: -12px 0 32px rgba(0, 0, 0, .28); }
.tasks-drawer-enter-active, .tasks-drawer-leave-active { transition: opacity .18s ease; }
.tasks-drawer-enter-from, .tasks-drawer-leave-to { opacity: 0; }
.tasks-drawer-enter-active .background-tasks-drawer, .tasks-drawer-leave-active .background-tasks-drawer { transition: transform .22s cubic-bezier(.2, .75, .25, 1); }
.tasks-drawer-enter-from .background-tasks-drawer, .tasks-drawer-leave-to .background-tasks-drawer { transform: translateX(24px); }
.tasks-header { padding: 18px 20px 14px; border-bottom: 1px solid var(--border); }
.tasks-title-row, .task-heading, .task-identity, .tasks-header-actions, .tasks-process-heading { display: flex; align-items: center; }
.tasks-title-row { justify-content: space-between; gap: 16px; }
.tasks-title-row h2 { font-size: 16px; font-weight: 650; }
.tasks-title-row p { margin-top: 5px; color: var(--text-dim); font-size: 12px; line-height: 1.45; }
.tasks-title-row .tasks-cost-note { margin-top: 4px; font-size: 11px; }
.tasks-header-actions { gap: 4px; flex-shrink: 0; }
.tasks-process { padding: 14px 20px; background: var(--bg-row); border-bottom: 1px solid var(--border); }
.tasks-process-heading { gap: 8px; margin-bottom: 12px; color: var(--accent); }
.tasks-metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; }
.tasks-metric-grid > div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.tasks-metric-grid span { color: var(--text-dim); font-size: 11px; }
.tasks-metric-grid strong { font-variant-numeric: tabular-nums; font-size: 13px; }
.tasks-content { min-height: 0; overflow: auto; padding: 0 20px 20px; }
.tasks-state { min-height: 150px; display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--text-dim); text-align: center; }
.tasks-error { flex-direction: column; color: var(--red); }
.tasks-inline-error { margin-top: 12px; padding: 9px 10px; color: var(--red); background: color-mix(in srgb, var(--red) 9%, transparent); border-left: 3px solid var(--red); overflow-wrap: anywhere; }
.tasks-section { padding-top: 18px; }
.tasks-section h3 { display: flex; align-items: center; justify-content: space-between; padding-bottom: 8px; color: var(--text-dim); border-bottom: 1px solid var(--border); font-size: 11px; font-weight: 650; text-transform: uppercase; }
.tasks-section h3 span { color: var(--text); font-variant-numeric: tabular-nums; }
.task-list { position: relative; display: block; }
.task-row { padding: 12px 0; border-bottom: 1px solid var(--border); }
.task-list-enter-active, .task-list-leave-active, .task-list-move { transition: opacity .18s ease, transform .18s ease; }
.task-list-enter-from, .task-list-leave-to { opacity: 0; transform: translateY(6px); }
.task-list-leave-active { position: absolute; width: 100%; }
.task-heading { justify-content: space-between; gap: 12px; }
.task-identity { min-width: 0; flex-wrap: wrap; gap: 8px; }
.task-identity strong { overflow-wrap: anywhere; font-size: 13px; }
.task-description, .task-detail { margin-top: 5px; color: var(--text-dim); font-size: 11px; line-height: 1.4; overflow-wrap: anywhere; }
.task-detail { color: var(--text); }
.task-provider { padding: 2px 6px; color: var(--text-dim); border: 1px solid var(--border); font-size: 10px; white-space: nowrap; }
.task-state-chip { padding: 2px 6px; border: 1px solid var(--border); color: var(--text-dim); font-size: 10px; white-space: nowrap; }
.state-running, .state-pause_requested { display: inline-flex; align-items: center; gap: 5px; color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.state-running::before, .state-pause_requested::before { width: 5px; height: 5px; border-radius: 50%; background: currentColor; content: ''; animation: task-pulse 1.8s ease-out infinite; }
.state-scheduled { color: var(--teal); }
.state-paused, .state-cancellation_requested { color: var(--yellow); }
.state-error { color: var(--red); border-color: color-mix(in srgb, var(--red) 45%, var(--border)); }
.state-completed { color: var(--green); }
.task-actions { display: flex; flex-shrink: 0; gap: 2px; }
.task-actions :deep(.btn-icon) { width: 30px; height: 30px; }
.task-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 6px; color: var(--text-dim); font-size: 11px; }
.task-cost { display: flex; flex-wrap: wrap; gap: 3px 10px; margin-top: 6px; color: var(--text-dim); font-size: 10px; font-variant-numeric: tabular-nums; }
.task-cost small { color: var(--yellow); font-size: inherit; }
.task-progress { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.task-progress > div { height: 5px; flex: 1; overflow: hidden; background: var(--border); }
.task-progress span { display: block; height: 100%; background: var(--accent); transition: width .2s ease; }
.task-progress small { color: var(--text-dim); font-variant-numeric: tabular-nums; }
.task-error-code { display: flex; align-items: center; gap: 6px; margin-top: 7px; color: var(--red); font-size: 11px; overflow-wrap: anywhere; }
.task-error-code code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tasks-spinner { animation: tasks-spin 1s linear infinite; }
@keyframes tasks-spin { to { transform: rotate(360deg); } }
@keyframes task-pulse { 50% { opacity: .35; transform: scale(.8); } }
@media (prefers-reduced-motion: reduce) {
  .tasks-drawer-enter-active, .tasks-drawer-leave-active,
  .tasks-drawer-enter-active .background-tasks-drawer, .tasks-drawer-leave-active .background-tasks-drawer,
  .task-list-enter-active, .task-list-leave-active, .task-list-move,
  .task-progress span, .tasks-spinner, .state-running::before, .state-pause_requested::before { animation: none; transition: none; }
}
@media (max-width: 600px) {
  .background-tasks-drawer { width: 100vw; }
  .tasks-header { padding: 14px 14px 12px; }
  .tasks-process { padding: 12px 14px; }
  .tasks-content { padding: 0 14px 16px; }
  .task-heading { align-items: flex-start; }
}
</style>