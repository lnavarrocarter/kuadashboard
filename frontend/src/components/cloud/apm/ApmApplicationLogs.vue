<template>
  <section class="application-logs">
    <header class="logs-toolbar">
      <div>
        <h3>Application logs</h3>
        <small>{{ sourceLabel }} · últimos {{ hours }} h</small>
      </div>
      <div class="logs-toolbar-actions">
        <select v-model="hours" class="ctrl-input" aria-label="Log range">
          <option :value="1">1 h</option>
          <option :value="3">3 h</option>
          <option :value="24">24 h</option>
          <option :value="72">72 h</option>
        </select>
        <button class="btn sm" :disabled="loading || !selectedResource" @click="loadLogs">
          <i data-lucide="refresh-cw"></i> Refresh
        </button>
      </div>
    </header>

    <div v-if="loggableResources.length" class="logs-resource-tabs" role="tablist" aria-label="Application log resources">
      <button
        v-for="resource in loggableResources"
        :key="resource.id"
        :class="['logs-resource-tab', { active: selectedResource?.id === resource.id }]"
        role="tab"
        :aria-selected="selectedResource?.id === resource.id"
        @click="selectResource(resource)"
      >
        <span>{{ resource.name }}</span>
        <small>{{ resourceLabel(resource) }}</small>
      </button>
    </div>

    <div v-if="!loggableResources.length" class="apm-empty compact">
      <i data-lucide="scroll-text"></i>
      <strong>No log source configured</strong>
      <span>Metrics are available in the Metrics tab. Add a supported workload to view provider logs here.</span>
    </div>

    <template v-else-if="selectedResource">
      <div class="logs-resource-header">
        <div><strong>{{ selectedResource.name }}</strong><small>{{ resourceLabel(selectedResource) }}</small></div>
        <span class="logs-source-badge">{{ sourceLabel }}</span>
        <button v-if="isKubernetes(selectedResource)" class="btn sm" @click="$emit('open-kubernetes-logs', selectedResource)">
          <i data-lucide="external-link"></i> Open Kubernetes logs
        </button>
        <button v-if="isVercel(selectedResource) && latestDeployment" class="btn sm" @click="vercelLogsOpen = true">
          <i data-lucide="external-link"></i> Open deployment logs
        </button>
      </div>

      <div v-if="loading" class="apm-empty compact">Loading provider logs…</div>
      <div v-else-if="error" class="alert-error">{{ error }}</div>
      <div v-else-if="!entries.length" class="apm-empty compact">
        <i data-lucide="scroll-text"></i>
        <strong>No logs in this range</strong>
        <span v-if="message">{{ message }}</span>
      </div>
      <div v-else class="log-table-wrap">
        <table class="cloud-table">
          <thead><tr><th>Time</th><th>Severity</th><th>Message</th></tr></thead>
          <tbody>
            <tr v-for="(entry, index) in entries" :key="`${entry.timestamp || entry.created || ''}-${index}`">
              <td class="mono-xs">{{ formatTimestamp(entry.timestamp || entry.created) }}</td>
              <td><span :class="['log-severity', String(entry.severity || 'DEFAULT').toLowerCase()]">{{ entry.severity || 'DEFAULT' }}</span></td>
              <td class="log-message">{{ entry.message || entry.text || entry.payload?.text || JSON.stringify(entry.payload || entry) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <VercelDeploymentLogs
      v-if="vercelLogsOpen && latestDeployment"
      :deployment="latestDeployment"
      :profile-id="profileId"
      @close="vercelLogsOpen = false"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../../composables/useApi'
import VercelDeploymentLogs from '../VercelDeploymentLogs.vue'

const props = defineProps({
  provider: { type: String, default: 'aws' },
  profileId: { type: String, default: '' },
  application: { type: Object, default: null },
  resources: { type: Array, default: () => [] },
})
defineEmits(['open-kubernetes-logs'])

const { apiFetch } = useApi()
const hours = ref(3)
const selectedResource = ref(null)
const entries = ref([])
const loading = ref(false)
const error = ref('')
const message = ref('')
const vercelLogsOpen = ref(false)
const latestDeployment = ref(null)

const sourceLabel = computed(() => {
  if (props.provider === 'aws') return 'CloudWatch Logs'
  if (props.provider === 'gcp') return 'Cloud Logging'
  if (props.provider === 'kubernetes') return 'Kubernetes logs'
  if (props.provider === 'vercel') return 'Vercel deployment logs'
  return 'Provider logs'
})

const loggableResources = computed(() => props.resources.filter(resource => {
  if (isKubernetes(resource) || isVercel(resource)) return true
  if (props.provider === 'aws') return ['lambda', 'ecs', 'eventbridge'].includes(resource.type)
  if (props.provider === 'gcp') return ['gcp-cloud-run', 'gcp-function', 'kubernetes'].includes(resource.type)
  return false
}))

function isKubernetes(resource) { return resource?.provider === 'kubernetes' || resource?.type === 'kubernetes' }
function isVercel(resource) { return resource?.provider === 'vercel' || resource?.type === 'vercel-project' }
function resourceLabel(resource) {
  if (isKubernetes(resource)) return [resource.kind || 'Workload', resource.namespace].filter(Boolean).join(' · ')
  if (isVercel(resource)) return 'Project deployment'
  if (resource.type === 'gcp-cloud-run') return 'Cloud Run'
  if (resource.type === 'gcp-function') return 'Cloud Function'
  if (resource.type === 'eventbridge') return 'EventBridge'
  return String(resource.type || '').toUpperCase()
}
function resourceRegion(resource) {
  return resource.metadata?.region || resource.metadata?.location || String(resource.key || '').split('/')[0] || props.application?.region || 'us-central1'
}
function resourceValue(resource, key, fallback = '') {
  return resource.metadata?.[key] || resource[key] || fallback
}

function selectResource(resource) {
  selectedResource.value = resource
  loadLogs()
}

async function loadLogs() {
  if (!selectedResource.value || isKubernetes(selectedResource.value)) {
    entries.value = []
    message.value = isKubernetes(selectedResource.value) ? 'Use the Kubernetes log viewer to stream pod and workload logs.' : ''
    return
  }
  loading.value = true
  error.value = ''
  message.value = ''
  entries.value = []
  latestDeployment.value = null
  try {
    const resource = selectedResource.value
    const limit = 300
    let data
    if (props.provider === 'aws') {
      const minutes = hours.value * 60
      if (resource.type === 'lambda') {
        data = await apiFetch(`/api/cloud/aws/logs/lambda/${encodeURIComponent(resource.name)}?minutes=${minutes}&limit=${limit}`, { headers: { 'X-Profile-Id': props.profileId } })
      } else if (resource.type === 'ecs') {
        const cluster = resourceValue(resource, 'cluster', resource.service || 'default')
        data = await apiFetch(`/api/cloud/aws/logs/ecs/${encodeURIComponent(cluster)}/${encodeURIComponent(resource.name)}?minutes=${minutes}&limit=${limit}`, { headers: { 'X-Profile-Id': props.profileId } })
      } else {
        const bus = resourceValue(resource, 'bus', 'default')
        data = await apiFetch(`/api/cloud/aws/logs/eventbridge?bus=${encodeURIComponent(bus)}&rule=${encodeURIComponent(resource.name)}&minutes=${minutes}`, { headers: { 'X-Profile-Id': props.profileId } })
      }
      entries.value = data?.events || []
      message.value = data?.message || (data?.logGroupName ? data.logGroupName : '')
    } else if (props.provider === 'gcp') {
      const location = resourceRegion(resource)
      if (resource.type === 'gcp-cloud-run') {
        data = await apiFetch(`/api/cloud/gcp/cloudrun/${encodeURIComponent(location)}/${encodeURIComponent(resource.name)}/logs?hours=${hours.value}&limit=${limit}`, { headers: { 'X-Profile-Id': props.profileId } })
      } else {
        data = await apiFetch(`/api/cloud/gcp/functions/${encodeURIComponent(location)}/${encodeURIComponent(resource.name)}/logs?hours=${hours.value}&limit=${limit}`, { headers: { 'X-Profile-Id': props.profileId } })
      }
      entries.value = data?.entries || []
    } else if (isVercel(resource)) {
      const projects = await apiFetch('/api/cloud/vercel/projects', { headers: { 'X-Profile-Id': props.profileId } })
      const project = projects.find(item => item.id === resource.key || item.id === resource.name || item.name === resource.name)
      if (!project) { message.value = 'No se encontró el proyecto en Vercel.'; return }
      const deployments = await apiFetch(`/api/cloud/vercel/projects/${encodeURIComponent(project.id)}/deployments?limit=1`, { headers: { 'X-Profile-Id': props.profileId } })
      latestDeployment.value = deployments?.[0] || null
      message.value = latestDeployment.value ? 'Open the latest deployment to stream its logs.' : 'No deployments found for this project.'
    }
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function formatTimestamp(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

watch(() => props.resources.map(resource => resource.id).join('|'), () => {
  const current = selectedResource.value && loggableResources.value.find(resource => resource.id === selectedResource.value.id)
  selectedResource.value = current || loggableResources.value[0] || null
  loadLogs()
})
watch(() => props.profileId, loadLogs)
watch(hours, loadLogs)
onMounted(() => {
  selectedResource.value = loggableResources.value[0] || null
  loadLogs()
})
</script>

<style scoped>
.application-logs { display: flex; flex-direction: column; gap: 10px; }
.logs-toolbar, .logs-resource-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.logs-toolbar h3 { margin: 0 0 3px; font-size: 13px; }
.logs-toolbar small, .logs-resource-header small { display: block; color: var(--text-dim); font-size: 9px; }
.logs-toolbar-actions { display: flex; align-items: center; gap: 7px; }
.logs-toolbar-actions select { width: 78px; }
.logs-resource-tabs { display: flex; gap: 5px; overflow-x: auto; padding-bottom: 2px; }
.logs-resource-tab { min-width: 145px; display: flex; flex-direction: column; gap: 3px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--text); text-align: left; cursor: pointer; }
.logs-resource-tab.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.logs-resource-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.logs-resource-tab small { color: var(--text-dim); font-size: 9px; }
.logs-resource-header { justify-content: flex-start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.logs-resource-header > div { min-width: 0; margin-right: auto; }
.logs-source-badge { padding: 3px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--accent); font-size: 9px; }
.log-table-wrap { overflow: auto; max-height: 430px; border: 1px solid var(--border); border-radius: 7px; }
.log-message { min-width: 360px; white-space: pre-wrap; word-break: break-word; }
.log-severity { font-size: 9px; }
.log-severity.error, .log-severity.critical { color: #f85149; }
.log-severity.warning, .log-severity.warn { color: #d29922; }
@media (max-width: 650px) { .logs-toolbar, .logs-resource-header { align-items: flex-start; flex-direction: column; }.logs-toolbar-actions { width: 100%; }.logs-toolbar-actions select { flex: 1; } }
</style>
