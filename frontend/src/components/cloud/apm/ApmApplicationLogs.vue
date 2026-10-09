<template>
  <section class="application-logs">
    <header class="logs-toolbar">
      <div>
        <h3>{{ t('apmLogs.title') }}</h3>
        <small>{{ sourceLabel }} · {{ t('apmLogs.lastHours', { n: hours }) }}</small>
      </div>
      <div class="logs-toolbar-actions">
        <select v-model="hours" class="ctrl-input" :aria-label="t('apmLogs.range')">
          <option :value="1">1 h</option>
          <option :value="3">3 h</option>
          <option :value="24">24 h</option>
          <option :value="72">72 h</option>
        </select>
        <button class="btn sm" :disabled="loading || !selectedResource" @click="loadLogs">
          <i data-lucide="refresh-cw"></i> {{ t('action.refresh') }}
        </button>
      </div>
    </header>

    <div v-if="loggableResources.length && !hideResourceTabs" class="logs-resource-tabs" role="tablist" :aria-label="t('apmLogs.resources')">
      <button
        v-for="resource in loggableResources"
        :key="resource.id"
        :class="['logs-resource-tab', { active: selectedResource?.id === resource.id }]"
        role="tab"
        :aria-selected="selectedResource?.id === resource.id"
        :tabindex="selectedResource?.id === resource.id ? 0 : -1"
        @click="selectResource(resource)"
        @keydown="moveTab"
      >
        <span>{{ resource.name }}</span>
        <small>{{ resourceLabel(resource) }}</small>
      </button>
    </div>

    <div v-if="!loggableResources.length" class="apm-empty compact">
      <i data-lucide="scroll-text"></i>
      <strong>{{ t('apmLogs.noSource') }}</strong>
      <span>{{ t('apmLogs.noSourceHint') }}</span>
    </div>

    <template v-else-if="selectedResource">
      <div class="logs-resource-header">
        <div><strong>{{ selectedResource.name }}</strong><small>{{ resourceLabel(selectedResource) }}</small></div>
        <span class="logs-source-badge">{{ sourceLabel }}</span>
        <button v-if="isKubernetes(selectedResource)" class="btn sm" @click="$emit('open-kubernetes-logs', selectedResource)">
          <i data-lucide="external-link"></i> {{ t('apmLogs.openKubernetes') }}
        </button>
        <button v-if="isVercel(selectedResource) && latestDeployment" class="btn sm" @click="vercelLogsOpen = true">
          <i data-lucide="external-link"></i> {{ t('apmLogs.openDeployment') }}
        </button>
      </div>

      <div v-if="cacheableSelected" class="logs-cache-tools">
        <span v-if="cachedGroup?.cache" class="text-dim">{{ t('apmLogs.cacheEnabled', { n: cachedGroup.cache.events || 0 }) }}</span>
        <button v-if="!cachedGroup?.cache" class="btn sm" :disabled="cacheLoading || cacheBusy" @click="prepareCache">
          <i data-lucide="database"></i> {{ t('apmLogs.cacheEnable') }}
        </button>
        <template v-else>
          <LogRefreshControl
            :endpoint="cacheEndpoint" :resource-id="selectedResource.id" :provider="cacheProvider"
            :profile-id="profileId" :minutes="cachedGroup.cache.refreshMinutes" :last-sync-at="cachedGroup.cache.lastSyncAt"
            :pages-per-sync="cacheRequestsPerSync" @updated="applyCacheDetails"
          />
          <button class="btn sm" :disabled="cacheBusy" @click="syncCache">
            <i data-lucide="refresh-cw"></i> {{ t('apmLogs.cacheSync') }}
          </button>
          <button class="btn sm" :disabled="cacheBusy" @click="disableCache">
            <i data-lucide="database-zap"></i> {{ t('apmLogs.cacheDisable') }}
          </button>
        </template>
        <small v-if="cacheError" class="alert-error">{{ t('apmLogs.cacheError', { error: cacheError }) }}</small>
      </div>

      <div v-if="loading" class="apm-empty compact">{{ t('apmLogs.loading') }}</div>
      <div v-else-if="error" class="alert-error">{{ error }}</div>
      <div v-else-if="!entries.length" class="apm-empty compact">
        <i data-lucide="scroll-text"></i>
        <strong>{{ t('apmLogs.empty') }}</strong>
        <span v-if="message">{{ message }}</span>
      </div>
      <div v-else class="log-table-wrap">
        <table class="cloud-table">
          <thead><tr><th>{{ t('apmLogs.time') }}</th><th>{{ t('apmLogs.severity') }}</th><th>{{ t('apmLogs.message') }}</th></tr></thead>
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

    <BaseModal :show="estimateOpen" @close="estimateOpen = false">
      <template #title>{{ t('apmLogs.cacheEstimateTitle') }}</template>
      <p>{{ t('apmLogs.cacheEstimate', { n: estimate?.estimatedRequestsPerSync || 0 }) }}</p>
      <p v-if="cacheProvider === 'gcp'">{{ t('apmLogs.cacheGcpQuota') }}</p>
      <p v-if="cacheProvider === 'vercel'">{{ t('apmLogs.cacheVercelQuota') }}</p>
      <p>{{ t('apmLogs.cacheProtection') }}</p>
      <template #footer>
        <button class="btn" :disabled="cacheBusy" @click="estimateOpen = false">{{ t('action.cancel') }}</button>
        <button class="btn primary" :disabled="cacheBusy" @click="enableCache">
          <i :data-lucide="cacheBusy ? 'loader-2' : 'database'"></i> {{ t('apmLogs.cacheConfirm') }}
        </button>
      </template>
    </BaseModal>
  </section>
</template>

<script setup>
import { moveTab } from '../../../lib/tablistKeys'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from '../../BaseModal.vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import VercelDeploymentLogs from '../VercelDeploymentLogs.vue'
import LogRefreshControl from '../logs/LogRefreshControl.vue'

const props = defineProps({
  provider: { type: String, default: 'aws' },
  profileId: { type: String, default: '' },
  application: { type: Object, default: null },
  resources: { type: Array, default: () => [] },
  // The Observability view picks the resource itself: no resource tabs here.
  hideResourceTabs: { type: Boolean, default: false },
})
const emit = defineEmits(['open-kubernetes-logs', 'cache-updated'])

const { apiFetch } = useApi()
const { t } = useI18n()
const hours = ref(3)
const selectedResource = ref(null)
const entries = ref([])
const loading = ref(false)
const error = ref('')
const message = ref('')
const vercelLogsOpen = ref(false)
const latestDeployment = ref(null)
const cachedGroup = ref(null)
const cacheLoading = ref(false)
const cacheBusy = ref(false)
const cacheError = ref('')
const estimate = ref(null)
const estimateOpen = ref(false)

const sourceLabel = computed(() => {
  const provider = resourceProvider(selectedResource.value)
  if (provider === 'aws') return 'CloudWatch Logs'
  if (provider === 'gcp') return 'Cloud Logging'
  if (provider === 'kubernetes') return t('apmLogs.source.kubernetes')
  if (provider === 'vercel') return t('apmLogs.source.vercel')
  return t('apmLogs.source.provider')
})

// Resources with logs, grouped by type and in name order, so the list reads the same every time.
const loggableResources = computed(() => props.resources
  .filter(resource => (resource.capabilities ? resource.capabilities.logs : isKubernetes(resource) || isVercel(resource) ||
    ['lambda', 'ecs', 'eventbridge', 'gcp-cloud-run', 'gcp-function'].includes(resource.type)))
  .slice()
  .sort((a, b) => String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true })))

// The profile and region that reach a resource: the ones its scope resolves to (resource.access,
// from /api/kua-apps/.../observability/resources), else the profile the view was given.
const requestFor = resource => ({ headers: { 'X-Profile-Id': resource.access?.profileId || props.profileId } })
const regionParam = resource => (resource.access?.region ? `&region=${encodeURIComponent(resource.access.region)}` : '')
const cacheProvider = computed(() => resourceProvider(selectedResource.value))
const cacheableSelected = computed(() => ['gcp-cloud-run', 'gcp-function', 'vercel-project'].includes(selectedResource.value?.type))
const cacheEndpoint = computed(() => `/api/observability/${encodeURIComponent(props.provider)}/applications/${encodeURIComponent(props.application?.id || '')}/log-cache`)
const cacheRequestsPerSync = computed(() => cacheProvider.value === 'gcp' ? 5 : 2)

function isKubernetes(resource) { return resource?.provider === 'kubernetes' || resource?.type === 'kubernetes' }
function isVercel(resource) { return resource?.provider === 'vercel' || resource?.type === 'vercel-project' }
function resourceProvider(resource) {
  if (resource?.type === 'gcp-cloud-run' || resource?.type === 'gcp-function') return 'gcp'
  if (resource?.type === 'vercel-project') return 'vercel'
  if (isKubernetes(resource)) return 'kubernetes'
  return resource?.provider || props.provider
}
function resourceLabel(resource) {
  if (isKubernetes(resource)) return [resource.kind || 'Workload', resource.namespace].filter(Boolean).join(' · ')
  if (isVercel(resource)) return t('apmLogs.projectDeployment')
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
  loadCacheStatus()
}

async function loadLogs() {
  if (!selectedResource.value || isKubernetes(selectedResource.value)) {
    entries.value = []
    message.value = isKubernetes(selectedResource.value) ? t('apmLogs.useKubernetesViewer') : ''
    return
  }
  loading.value = true
  error.value = ''
  message.value = ''
  entries.value = []
  latestDeployment.value = null
  try {
    const resource = selectedResource.value
    // No verified profile of this computer reaches the resource's scope: say so instead of failing.
    if (resource.access?.error) {
      message.value = t('apmLogs.noAccess')
      return
    }
    const limit = 300
    let data
    const provider = resourceProvider(resource)
    if (provider === 'aws') {
      const minutes = hours.value * 60
      if (resource.type === 'lambda') {
        data = await apiFetch(`/api/cloud/aws/logs/lambda/${encodeURIComponent(resource.name)}?minutes=${minutes}&limit=${limit}${regionParam(resource)}`, requestFor(resource))
      } else if (resource.type === 'ecs') {
        const cluster = resourceValue(resource, 'cluster', resource.service || 'default')
        data = await apiFetch(`/api/cloud/aws/logs/ecs/${encodeURIComponent(cluster)}/${encodeURIComponent(resource.name)}?minutes=${minutes}&limit=${limit}${regionParam(resource)}`, requestFor(resource))
      } else {
        const bus = resourceValue(resource, 'bus', 'default')
        data = await apiFetch(`/api/cloud/aws/logs/eventbridge?bus=${encodeURIComponent(bus)}&rule=${encodeURIComponent(resource.name)}&minutes=${minutes}${regionParam(resource)}`, requestFor(resource))
      }
      entries.value = data?.events || []
      message.value = data?.message || (data?.logGroupName ? data.logGroupName : '')
    } else if (provider === 'gcp') {
      const location = resourceRegion(resource)
      if (resource.type === 'gcp-cloud-run') {
        data = await apiFetch(`/api/cloud/gcp/cloudrun/${encodeURIComponent(location)}/${encodeURIComponent(resource.name)}/logs?hours=${hours.value}&limit=${limit}`, requestFor(resource))
      } else {
        data = await apiFetch(`/api/cloud/gcp/functions/${encodeURIComponent(location)}/${encodeURIComponent(resource.name)}/logs?hours=${hours.value}&limit=${limit}`, requestFor(resource))
      }
      entries.value = data?.entries || []
    } else if (provider === 'vercel') {
      const projects = await apiFetch('/api/cloud/vercel/projects', requestFor(resource))
      const project = projects.find(item => item.id === resource.key || item.id === resource.name || item.name === resource.name)
      if (!project) { message.value = t('apmLogs.vercelProjectMissing'); return }
      const deployments = await apiFetch(`/api/cloud/vercel/projects/${encodeURIComponent(project.id)}/deployments?limit=1`, requestFor(resource))
      latestDeployment.value = deployments?.[0] || null
      message.value = latestDeployment.value ? t('apmLogs.openLatest') : t('apmLogs.noDeployments')
    }
  } catch (requestError) {
    error.value = requestError.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function cacheRequestOptions(method = 'GET', body) {
  return {
    method,
    headers: { 'X-Profile-Id': props.profileId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function loadCacheStatus() {
  cachedGroup.value = null
  cacheError.value = ''
  if (!cacheableSelected.value || !selectedResource.value || !props.application?.id) return
  cacheLoading.value = true
  try {
    const query = new URLSearchParams({ resourceId: selectedResource.value.id })
    const data = await apiFetch(`${cacheEndpoint.value}?${query}`, cacheRequestOptions())
    cachedGroup.value = data?.groups?.[0] || null
  } catch (requestError) {
    cacheError.value = requestError.message
  } finally {
    cacheLoading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

async function prepareCache() {
  cacheBusy.value = true
  cacheError.value = ''
  try {
    const query = new URLSearchParams({ resourceId: selectedResource.value.id })
    estimate.value = await apiFetch(`${cacheEndpoint.value}/estimate?${query}`, cacheRequestOptions())
    estimateOpen.value = true
  } catch (requestError) {
    cacheError.value = requestError.message
  } finally {
    cacheBusy.value = false
  }
}

async function enableCache() {
  await syncCache({ closeEstimate: true })
}

async function syncCache({ closeEstimate = false } = {}) {
  cacheBusy.value = true
  cacheError.value = ''
  try {
    await apiFetch(cacheEndpoint.value, cacheRequestOptions('POST', {
      resourceId: selectedResource.value.id,
      historyHours: cacheProvider.value === 'vercel' ? 0 : Number(hours.value),
    }))
    if (closeEstimate) estimateOpen.value = false
    await loadCacheStatus()
    emit('cache-updated')
  } catch (requestError) {
    cacheError.value = requestError.message
  } finally {
    cacheBusy.value = false
  }
}

async function disableCache() {
  cacheBusy.value = true
  cacheError.value = ''
  try {
    const query = new URLSearchParams({ resourceId: selectedResource.value.id })
    await apiFetch(`${cacheEndpoint.value}?${query}`, cacheRequestOptions('DELETE'))
    cachedGroup.value = null
    emit('cache-updated')
  } catch (requestError) {
    cacheError.value = requestError.message
  } finally {
    cacheBusy.value = false
  }
}

function applyCacheDetails(cache) {
  if (cachedGroup.value && cache) cachedGroup.value = { ...cachedGroup.value, cache }
}

function formatTimestamp(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

watch(() => props.resources.map(resource => resource.id).join('|'), () => {
  const current = selectedResource.value && loggableResources.value.find(resource => resource.id === selectedResource.value.id)
  selectedResource.value = current || loggableResources.value[0] || null
  loadLogs()
  loadCacheStatus()
})
watch(() => props.profileId, loadLogs)
watch(hours, loadLogs)
onMounted(() => {
  selectedResource.value = loggableResources.value[0] || null
  loadLogs()
  loadCacheStatus()
})
</script>

<style scoped>
.application-logs { display: flex; flex-direction: column; gap: 10px; }
.logs-toolbar, .logs-resource-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.logs-cache-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.logs-cache-tools > small { flex-basis: 100%; }
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
