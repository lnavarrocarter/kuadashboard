<template>
  <div class="helm-view">
    <!-- ── Toolbar ───────────────────────────────────────────────────────── -->
    <div class="toolbar">
      <div class="helm-tabs">
        <button
          :class="['helm-tab', { active: tab === 'releases' }]"
          @click="switchTab('releases')"
        >{{ t('helm.releases') }}</button>
        <button
          :class="['helm-tab', { active: tab === 'repos' }]"
          @click="switchTab('repos')"
        >{{ t('helm.repos') }}</button>
        <button
          :class="['helm-tab', { active: tab === 'search' }]"
          @click="switchTab('search')"
        >{{ t('helmv.searchCharts') }}</button>
      </div>
      <div class="toolbar-right">
        <!-- Releases actions -->
        <template v-if="tab === 'releases'">
          <input v-model="filter" class="search-input" :placeholder="t('helmv.filter')" />
          <button class="btn btn-icon" :title="t('action.refresh')" @click="loadReleases">
            <i data-lucide="refresh-cw"></i>
          </button>
        </template>
        <!-- Repos actions -->
        <template v-else-if="tab === 'repos'">
          <button class="btn sm" @click="openAddRepo" :title="t('helm.addRepo')">
            <i data-lucide="plus"></i> {{ t('helmv.addRepoShort') }}
          </button>
          <button class="btn sm" @click="updateRepos" :disabled="updatingRepos" :title="t('helmv.updateAllHint')">
            <i data-lucide="refresh-cw"></i> {{ updatingRepos ? t('helmv.updating') : t('helmv.updateAll') }}
          </button>
          <button class="btn btn-icon" :title="t('action.refresh')" @click="loadRepos">
            <i data-lucide="refresh-cw"></i>
          </button>
        </template>
        <!-- Search actions -->
        <template v-else-if="tab === 'search'">
          <input
            v-model="searchQuery"
            class="search-input"
            :placeholder="t('helmv.searchPlaceholder')"
            @keydown.enter="searchCharts"
            style="width: 220px"
          />
          <button class="btn sm primary" @click="searchCharts">
            <i data-lucide="search"></i> {{ t('helmv.search') }}
          </button>
        </template>
      </div>
    </div>

    <!-- ── Releases tab ──────────────────────────────────────────────────── -->
    <div v-if="tab === 'releases'" class="table-wrap">
      <div v-if="loadingReleases" class="loading-state">{{ t('helmv.loadingReleases') }}</div>
      <div v-else-if="releasesError" class="error-state">
        <i data-lucide="alert-triangle"></i>
        <span>{{ releasesError }}</span>
        <button class="btn sm" @click="loadReleases">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!filteredReleases.length" class="empty-state">
        {{ t('helmv.noReleases') }}
      </div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th>{{ t('helmv.col.name') }}</th>
            <th>Namespace</th>
            <th>Chart</th>
            <th>{{ t('helmv.col.version') }}</th>
            <th>{{ t('helmv.col.appVersion') }}</th>
            <th>{{ t('helmv.col.status') }}</th>
            <th>{{ t('helmv.col.updated') }}</th>
            <th>{{ t('helmv.col.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredReleases" :key="`${r.namespace}/${r.name}`">
            <td><strong>{{ r.name }}</strong></td>
            <td>{{ r.namespace }}</td>
            <td>{{ r.chart }}</td>
            <td>{{ r.revision }}</td>
            <td>{{ r.app_version || '—' }}</td>
            <td>
              <span :class="['status-badge', statusClass(r.status)]">{{ r.status }}</span>
            </td>
            <td class="text-dim">{{ formatDate(r.updated) }}</td>
            <td class="col-actions">
              <button
                class="action-btn icon-trash"
                :title="t('helmv.uninstallRelease')"
                @click="confirmUninstall(r)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Repos tab ─────────────────────────────────────────────────────── -->
    <div v-else-if="tab === 'repos'" class="table-wrap">
      <div v-if="loadingRepos" class="loading-state">{{ t('helmv.loadingRepos') }}</div>
      <div v-else-if="reposError" class="error-state">
        <i data-lucide="alert-triangle"></i>
        <span>{{ reposError }}</span>
        <button class="btn sm" @click="loadRepos">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!repos.length" class="empty-state">
        {{ t('helmv.noRepos') }}
      </div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th>{{ t('helmv.col.name') }}</th>
            <th>URL</th>
            <th>{{ t('helmv.col.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in repos" :key="r.name">
            <td><strong>{{ r.name }}</strong></td>
            <td class="text-dim" style="font-size:12px; word-break:break-all">{{ r.url }}</td>
            <td class="col-actions">
              <button
                class="action-btn icon-trash"
                :title="t('helmv.removeRepo')"
                @click="removeRepo(r.name)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Search tab ────────────────────────────────────────────────────── -->
    <div v-else-if="tab === 'search'" class="table-wrap">
      <div v-if="searching" class="loading-state">{{ t('helmv.searching') }}</div>
      <div v-else-if="searchError" class="error-state">
        <i data-lucide="alert-triangle"></i>
        <span>{{ searchError }}</span>
      </div>
      <div v-else-if="searchResults === null" class="empty-state">
        {{ t('helmv.searchHint') }}
      </div>
      <div v-else-if="!searchResults.length" class="empty-state">
        {{ t('helmv.noCharts', { query: searchQuery }) }}
      </div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th>Chart</th>
            <th>{{ t('helmv.col.version') }}</th>
            <th>{{ t('helmv.col.appVersion') }}</th>
            <th>{{ t('helmv.col.description') }}</th>
            <th>{{ t('helmv.col.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in searchResults" :key="c.name">
            <td><strong>{{ c.name }}</strong></td>
            <td>{{ c.version }}</td>
            <td>{{ c.app_version || '—' }}</td>
            <td class="text-dim" style="max-width:400px; white-space:normal">{{ c.description }}</td>
            <td class="col-actions">
              <button class="btn sm primary" :title="t('helmv.installChart')" @click="openInstall(c)">
                <i data-lucide="package-plus"></i> {{ t('helmv.install') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Add Repo modal ────────────────────────────────────────────────── -->
    <div v-if="addRepoModal" class="modal-overlay" @click.self="addRepoModal = false">
      <div class="modal-box" style="width: 420px">
        <div class="modal-header">
          <span>{{ t('helmv.addRepoTitle') }}</span>
          <button class="btn-close" @click="addRepoModal = false">✕</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:12px">
          <label class="form-label">
            {{ t('helmv.col.name') }}
            <input v-model="newRepo.name" class="form-input" :placeholder="t('helmv.repoNamePlaceholder')" />
          </label>
          <label class="form-label">
            URL
            <input v-model="newRepo.url" class="form-input" placeholder="https://charts.bitnami.com/bitnami" />
          </label>
          <label class="form-label">
            {{ t('helmv.username') }} <span class="text-dim">{{ t('helmv.optional') }}</span>
            <input v-model="newRepo.username" class="form-input" placeholder="user" />
          </label>
          <label class="form-label">
            {{ t('helmv.password') }} <span class="text-dim">{{ t('helmv.optional') }}</span>
            <input v-model="newRepo.password" class="form-input" type="password" placeholder="••••••" />
          </label>
          <div v-if="addRepoError" class="error-inline">{{ addRepoError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="addRepoModal = false">{{ t('action.cancel') }}</button>
          <button class="btn primary" :disabled="addingRepo" @click="addRepo">
            {{ addingRepo ? t('helmv.adding') : t('helmv.addRepository') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Uninstall confirm modal ───────────────────────────────────────── -->
    <div v-if="uninstallTarget" class="modal-overlay" @click.self="uninstallTarget = null">
      <div class="modal-box" style="width: 380px">
        <div class="modal-header">
          <span>{{ t('helmv.uninstallTitle') }}</span>
          <button class="btn-close" @click="uninstallTarget = null">✕</button>
        </div>
        <div class="modal-body">
          <p>
            {{ t('helmv.uninstallPre') }}
            <strong>{{ uninstallTarget?.name }}</strong>
            {{ t('helmv.uninstallFrom') }} <strong>{{ uninstallTarget?.namespace }}</strong>?
          </p>
          <p class="text-dim" style="margin-top:8px; font-size:12px">
            {{ t('helmv.uninstallWarning') }}
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="uninstallTarget = null">{{ t('action.cancel') }}</button>
          <button class="btn danger" :disabled="uninstalling" @click="doUninstall">
            {{ uninstalling ? t('helmv.uninstalling') : t('helm.uninstall') }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Install chart modal ──────────────────────────────────────────── -->
    <div v-if="installModal" class="modal-overlay" @click.self="closeInstall">
      <div class="modal-box helm-install-modal">
        <div class="modal-header">
          <span>{{ t('helmv.installTitle') }}</span>
          <button class="btn-close" @click="closeInstall">✕</button>
        </div>
        <div class="modal-body install-body">
          <div class="install-chart-summary">
            <strong>{{ installForm.chart }}</strong>
            <span class="text-dim">{{ installTarget?.description || '' }}</span>
          </div>
          <div class="install-grid">
            <label class="form-label">
              {{ t('helmv.releaseName') }}
              <input v-model.trim="installForm.releaseName" class="form-input" placeholder="my-release" />
            </label>
            <label class="form-label">
              Namespace
              <input v-model.trim="installForm.namespace" class="form-input" placeholder="default" />
            </label>
            <label class="form-label">
              {{ t('helmv.col.version') }}
              <input v-model.trim="installForm.version" class="form-input" placeholder="latest" />
            </label>
            <label class="form-label install-check">
              <input v-model="installForm.createNamespace" type="checkbox" />
              {{ t('helmv.createNamespace') }}
            </label>
            <label class="form-label install-check">
              <input v-model="installForm.wait" type="checkbox" />
              {{ t('helmv.wait') }}
            </label>
          </div>
          <div v-if="isMetricsServerInstall" class="install-preset-box">
            <label class="form-label install-check">
              <input v-model="metricsServerPreset" type="checkbox" @change="applyMetricsServerPreset" />
              {{ t('helmv.metricsPreset') }}
            </label>
            <p>
              {{ t('helmv.metricsPresetHint') }}
            </p>
          </div>
          <div v-if="installing || installStatus" class="install-status-box">
            <div class="install-status-head">
              <i :data-lucide="installing ? 'loader-2' : 'check-circle-2'"></i>
              <strong>{{ installStatus || t('helmv.preparing') }}</strong>
            </div>
            <pre v-if="installOutput">{{ installOutput }}</pre>
          </div>
          <label class="form-label">
            {{ t('helmv.valuesYaml') }} <span class="text-dim">{{ t('helmv.optional') }}</span>
            <textarea v-model="installForm.values" class="form-input install-values" spellcheck="false" placeholder="replicaCount: 2"></textarea>
          </label>
          <div v-if="installError" class="error-inline">{{ installError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="closeInstall">{{ t('action.cancel') }}</button>
          <button class="btn primary" :disabled="installing" @click="installChart">
            <i data-lucide="package-plus"></i> {{ installing ? t('helmv.installing') : t('helmv.install') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'
import { useKubeStore } from '../stores/useKubeStore'
import { useToast } from '../composables/useToast'
import { useI18n } from '../composables/useI18n'

const props = defineProps({
  initialTab: { type: String, default: 'releases' },
})

const store = useKubeStore()
const { toast } = useToast()
const { t } = useI18n()

// ── State ──────────────────────────────────────────────────────────────────
const tab = ref(props.initialTab)

// Releases
const releases       = ref([])
const loadingReleases = ref(false)
const releasesError  = ref(null)
const filter         = ref('')

// Repos
const repos         = ref([])
const loadingRepos  = ref(false)
const reposError    = ref(null)
const updatingRepos = ref(false)

// Add Repo modal
const addRepoModal = ref(false)
const addingRepo   = ref(false)
const addRepoError = ref(null)
const newRepo      = ref({ name: '', url: '', username: '', password: '' })

// Uninstall
const uninstallTarget = ref(null)
const uninstalling    = ref(false)

// Search
const searchQuery   = ref('')
const searchResults = ref(null)
const searching     = ref(false)
const searchError   = ref(null)

// Install
const installModal = ref(false)
const installTarget = ref(null)
const installing = ref(false)
const installError = ref(null)
const installStatus = ref('')
const installOutput = ref('')
const installForm = ref({ chart: '', releaseName: '', namespace: 'default', version: '', values: '', createNamespace: true, wait: false })
const metricsServerPreset = ref(false)

const METRICS_SERVER_VALUES = `args:
  - --kubelet-insecure-tls
  - --kubelet-preferred-address-types=InternalIP,ExternalIP,Hostname
apiService:
  insecureSkipTLSVerify: true
`

// ── Computed ───────────────────────────────────────────────────────────────
const filteredReleases = computed(() => {
  const q = filter.value.toLowerCase()
  if (!q) return releases.value
  return releases.value.filter(r =>
    JSON.stringify(r).toLowerCase().includes(q)
  )
})

const isMetricsServerInstall = computed(() => isMetricsServerChart(installForm.value.chart))

// ── Helpers ────────────────────────────────────────────────────────────────
function currentContext() {
  return store.currentContext || ''
}

function currentNamespace() {
  return store.namespace || 'all'
}

function statusClass(status) {
  if (!status) return ''
  const s = status.toLowerCase()
  if (s === 'deployed') return 'status-running'
  if (s === 'failed')   return 'status-failed'
  if (s === 'pending-install' || s === 'pending-upgrade') return 'status-pending'
  return ''
}

function formatDate(raw) {
  if (!raw) return '—'
  try {
    return new Date(raw).toLocaleString()
  } catch {
    return raw
  }
}

async function refreshIcons() {
  await nextTick()
  createIcons({ icons })
}

// ── Releases ───────────────────────────────────────────────────────────────
async function loadReleases() {
  loadingReleases.value = true
  releasesError.value   = null
  try {
    const ctx = currentContext()
    const ns  = currentNamespace()
    const params = new URLSearchParams()
    if (ctx) params.set('context', ctx)
    if (ns)  params.set('namespace', ns)
    const res = await fetch(`/api/helm/releases?${params}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    releases.value = await res.json()
  } catch (err) {
    releasesError.value = err.message
  } finally {
    loadingReleases.value = false
    await refreshIcons()
  }
}

function confirmUninstall(release) {
  uninstallTarget.value = release
}

async function doUninstall() {
  if (!uninstallTarget.value) return
  uninstalling.value = true
  try {
    const { name, namespace } = uninstallTarget.value
    const ctx = currentContext()
    const params = ctx ? `?context=${encodeURIComponent(ctx)}` : ''
    const res = await fetch(
      `/api/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${params}`,
      { method: 'DELETE' }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    uninstallTarget.value = null
    await loadReleases()
  } catch (err) {
    alert(t('helmv.uninstallFailed', { error: err.message }))
  } finally {
    uninstalling.value = false
  }
}

// ── Repos ──────────────────────────────────────────────────────────────────
async function loadRepos() {
  loadingRepos.value = true
  reposError.value   = null
  try {
    const res = await fetch('/api/helm/repos')
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    repos.value = await res.json()
  } catch (err) {
    reposError.value = err.message
  } finally {
    loadingRepos.value = false
    await refreshIcons()
  }
}

function openAddRepo() {
  newRepo.value    = { name: '', url: '', username: '', password: '' }
  addRepoError.value = null
  addRepoModal.value = true
}

async function addRepo() {
  addRepoError.value = null
  if (!newRepo.value.name || !newRepo.value.url) {
    addRepoError.value = t('helmv.nameUrlRequired')
    return
  }
  addingRepo.value = true
  try {
    const res = await fetch('/api/helm/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newRepo.value),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    addRepoModal.value = false
    await loadRepos()
  } catch (err) {
    addRepoError.value = err.message
  } finally {
    addingRepo.value = false
  }
}

async function removeRepo(name) {
  if (!confirm(t('helmv.confirmRemoveRepo', { name }))) return
  try {
    const res = await fetch(`/api/helm/repos/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    await loadRepos()
  } catch (err) {
    alert(t('helmv.removeRepoFailed', { error: err.message }))
  }
}

async function updateRepos() {
  updatingRepos.value = true
  try {
    const res = await fetch('/api/helm/repos/update', { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
  } catch (err) {
    alert(t('helmv.updateFailed', { error: err.message }))
  } finally {
    updatingRepos.value = false
  }
}

// ── Search ─────────────────────────────────────────────────────────────────
async function searchCharts() {
  if (!searchQuery.value.trim()) return
  searching.value    = true
  searchError.value  = null
  searchResults.value = null
  try {
    const params = new URLSearchParams({ query: searchQuery.value.trim() })
    const res = await fetch(`/api/helm/search?${params}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    searchResults.value = await res.json()
  } catch (err) {
    searchError.value = err.message
  } finally {
    searching.value = false
    await refreshIcons()
  }
}

function chartToReleaseName(chartName = '') {
  return String(chartName).split('/').pop()?.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '') || ''
}

function isMetricsServerChart(chartName = '') {
  const name = String(chartName).toLowerCase()
  return name === 'metrics-server/metrics-server' || name.endsWith('/metrics-server')
}

function applyMetricsServerPreset() {
  if (!isMetricsServerInstall.value) return
  const currentValues = installForm.value.values.trim()
  if (metricsServerPreset.value) {
    if (!currentValues) installForm.value.values = METRICS_SERVER_VALUES
    return
  }
  if (currentValues === METRICS_SERVER_VALUES.trim()) installForm.value.values = ''
}

function openInstall(chart) {
  installTarget.value = chart
  installError.value = null
  installForm.value = {
    chart: chart.name,
    releaseName: chartToReleaseName(chart.name),
    namespace: currentNamespace() === 'all' ? 'default' : currentNamespace(),
    version: chart.version || '',
    values: isMetricsServerChart(chart.name) ? METRICS_SERVER_VALUES : '',
    createNamespace: true,
    wait: false,
  }
  metricsServerPreset.value = isMetricsServerChart(chart.name)
  installStatus.value = ''
  installOutput.value = ''
  installModal.value = true
  refreshIcons()
}

function closeInstall() {
  if (installing.value) return
  installModal.value = false
  installTarget.value = null
  installError.value = null
  installStatus.value = ''
  installOutput.value = ''
  metricsServerPreset.value = false
}

async function installChart() {
  installError.value = null
  if (!installForm.value.releaseName || !installForm.value.namespace) {
    installError.value = t('helmv.releaseNsRequired')
    return
  }
  installing.value = true
  installStatus.value = t('helmv.sending')
  installOutput.value = ''
  try {
    const preset = metricsServerPreset.value ? 'metrics-server' : ''
    const values = preset && installForm.value.values.trim() === METRICS_SERVER_VALUES.trim()
      ? ''
      : installForm.value.values
    const body = { ...installForm.value, values, context: currentContext(), preset }
    installStatus.value = installForm.value.wait ? t('helmv.installingWaiting') : t('helmv.installingRelease')
    const res = await fetch('/api/helm/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    installOutput.value = data.output || data.status?.info?.notes || ''
    installStatus.value = data.status?.info?.status ? t('helmv.releaseStatus', { status: data.status.info.status }) : t('helmv.releaseInstalled')
    filter.value = installForm.value.releaseName
    toast(t('helmv.installedToast', { name: installForm.value.releaseName }), 'success')
    installStatus.value = t('helmv.refreshingReleases')
    tab.value = 'releases'
    await loadReleases()
    installModal.value = false
    installTarget.value = null
  } catch (err) {
    installError.value = err.message
    installStatus.value = t('helmv.installFailed')
  } finally {
    installing.value = false
    await refreshIcons()
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
function switchTab(t) {
  tab.value = t
  if (t === 'releases') loadReleases()
  if (t === 'repos')    loadRepos()
  nextTick(() => createIcons({ icons }))
}

function reloadActiveTab() {
  if (tab.value === 'releases') return loadReleases()
  if (tab.value === 'repos') return loadRepos()
  if (tab.value === 'search' && searchQuery.value.trim()) return searchCharts()
  return Promise.resolve()
}

defineExpose({ reloadActiveTab })

onMounted(() => {
  if (tab.value === 'repos') {
    loadRepos()
  } else {
    loadReleases()
  }
  createIcons({ icons })
})
</script>

<style scoped>
.helm-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.helm-tabs {
  display: flex;
  gap: 4px;
}

.helm-tab {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-dim);
  padding: 4px 14px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: color .15s, background .15s;
}
.helm-tab:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.helm-tab.active {
  background: var(--bg-sel);
  color: #fff;
  border-color: var(--accent);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.table-wrap {
  flex: 1;
  overflow: auto;
}

.loading-state,
.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--text-dim);
}

.error-state {
  padding: 40px;
  text-align: center;
  color: var(--red);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.status-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  background: var(--bg-hover);
  color: var(--text-dim);
}
.status-badge.status-running { background: #1a3a1a; color: var(--green); }
.status-badge.status-failed  { background: #3a1a1a; color: var(--red); }
.status-badge.status-pending { background: #3a2a10; color: var(--yellow); }

/* ── Modal ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-box {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  max-height: 80vh;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.modal-body {
  padding: 16px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.form-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}

.form-input {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px 8px;
  color: var(--text);
  font-size: 13px;
}
.form-input:focus {
  outline: none;
  border-color: var(--accent);
}

.error-inline {
  color: var(--red);
  font-size: 12px;
  padding: 6px 8px;
  background: rgba(244, 67, 54, .1);
  border-radius: 4px;
}

/* Action icon buttons — matches existing .action-btn pattern */
.action-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.action-btn:hover { background: var(--bg-hover); }
.action-btn.icon-trash::before { content: '🗑'; font-size: 13px; }

.btn.danger {
  background: var(--red);
  color: #fff;
  border: none;
}
.btn.danger:hover { background: #c62828; }
.btn.danger:disabled { opacity: .5; cursor: not-allowed; }
.helm-install-modal { width: min(720px, 92vw); }
.install-body { display: flex; flex-direction: column; gap: 12px; }
.install-chart-summary { display: flex; flex-direction: column; gap: 3px; }
.install-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.install-check { flex-direction: row; align-items: center; align-self: end; min-height: 32px; }
.install-check input { accent-color: var(--accent); }
.install-preset-box { border: 1px solid rgba(14, 157, 232, .35); border-radius: 6px; background: rgba(14, 157, 232, .08); padding: 10px; }
.install-preset-box p { margin-top: 4px; color: var(--text-dim); font-size: 12px; line-height: 1.45; }
.install-values { min-height: 150px; resize: vertical; font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; line-height: 1.45; }
.install-status-box { border: 1px solid var(--border); border-radius: 6px; background: var(--bg); padding: 10px; }
.install-status-head { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.install-status-head svg { width: 14px; height: 14px; }
.install-status-head [data-lucide="loader-2"] { animation: spin 1s linear infinite; }
.install-status-box pre { margin: 8px 0 0; max-height: 140px; overflow: auto; white-space: pre-wrap; color: var(--text-dim); font-size: 11px; line-height: 1.45; }
.col-actions .btn svg { width: 12px; height: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) {
  .install-grid { grid-template-columns: 1fr; }
}
</style>
