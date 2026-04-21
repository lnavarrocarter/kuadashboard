<template>
  <div class="helm-view">
    <!-- ── Toolbar ───────────────────────────────────────────────────────── -->
    <div class="toolbar">
      <div class="helm-tabs">
        <button
          :class="['helm-tab', { active: tab === 'releases' }]"
          @click="switchTab('releases')"
        >Releases</button>
        <button
          :class="['helm-tab', { active: tab === 'repos' }]"
          @click="switchTab('repos')"
        >Repositories</button>
        <button
          :class="['helm-tab', { active: tab === 'search' }]"
          @click="switchTab('search')"
        >Search Charts</button>
      </div>
      <div class="toolbar-right">
        <!-- Releases actions -->
        <template v-if="tab === 'releases'">
          <input v-model="filter" class="search-input" placeholder="Filter..." />
          <button class="btn btn-icon" title="Refresh" @click="loadReleases">
            <i data-lucide="refresh-cw"></i>
          </button>
        </template>
        <!-- Repos actions -->
        <template v-else-if="tab === 'repos'">
          <button class="btn sm" @click="openAddRepo" title="Add repository">
            <i data-lucide="plus"></i> Add Repo
          </button>
          <button class="btn sm" @click="updateRepos" :disabled="updatingRepos" title="Update all repos">
            <i data-lucide="refresh-cw"></i> {{ updatingRepos ? 'Updating…' : 'Update All' }}
          </button>
          <button class="btn btn-icon" title="Refresh" @click="loadRepos">
            <i data-lucide="refresh-cw"></i>
          </button>
        </template>
        <!-- Search actions -->
        <template v-else-if="tab === 'search'">
          <input
            v-model="searchQuery"
            class="search-input"
            placeholder="Search charts…"
            @keydown.enter="searchCharts"
            style="width: 220px"
          />
          <button class="btn sm primary" @click="searchCharts">
            <i data-lucide="search"></i> Search
          </button>
        </template>
      </div>
    </div>

    <!-- ── Releases tab ──────────────────────────────────────────────────── -->
    <div v-if="tab === 'releases'" class="table-wrap">
      <div v-if="loadingReleases" class="loading-state">Loading releases…</div>
      <div v-else-if="releasesError" class="error-state">
        <i data-lucide="alert-triangle"></i>
        <span>{{ releasesError }}</span>
        <button class="btn sm" @click="loadReleases">Retry</button>
      </div>
      <div v-else-if="!filteredReleases.length" class="empty-state">
        No releases found in this namespace / context
      </div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th>Name</th>
            <th>Namespace</th>
            <th>Chart</th>
            <th>Version</th>
            <th>App Version</th>
            <th>Status</th>
            <th>Updated</th>
            <th>Actions</th>
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
                title="Uninstall release"
                @click="confirmUninstall(r)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Repos tab ─────────────────────────────────────────────────────── -->
    <div v-else-if="tab === 'repos'" class="table-wrap">
      <div v-if="loadingRepos" class="loading-state">Loading repositories…</div>
      <div v-else-if="reposError" class="error-state">
        <i data-lucide="alert-triangle"></i>
        <span>{{ reposError }}</span>
        <button class="btn sm" @click="loadRepos">Retry</button>
      </div>
      <div v-else-if="!repos.length" class="empty-state">
        No repositories configured — add one with the button above
      </div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th>Name</th>
            <th>URL</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in repos" :key="r.name">
            <td><strong>{{ r.name }}</strong></td>
            <td class="text-dim" style="font-size:12px; word-break:break-all">{{ r.url }}</td>
            <td class="col-actions">
              <button
                class="action-btn icon-trash"
                title="Remove repository"
                @click="removeRepo(r.name)"
              ></button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Search tab ────────────────────────────────────────────────────── -->
    <div v-else-if="tab === 'search'" class="table-wrap">
      <div v-if="searching" class="loading-state">Searching charts…</div>
      <div v-else-if="searchError" class="error-state">
        <i data-lucide="alert-triangle"></i>
        <span>{{ searchError }}</span>
      </div>
      <div v-else-if="searchResults === null" class="empty-state">
        Enter a chart name and press Search
      </div>
      <div v-else-if="!searchResults.length" class="empty-state">
        No charts found for "{{ searchQuery }}"
      </div>
      <table v-else class="rtable">
        <thead>
          <tr>
            <th>Chart</th>
            <th>Version</th>
            <th>App Version</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in searchResults" :key="c.name">
            <td><strong>{{ c.name }}</strong></td>
            <td>{{ c.version }}</td>
            <td>{{ c.app_version || '—' }}</td>
            <td class="text-dim" style="max-width:400px; white-space:normal">{{ c.description }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ── Add Repo modal ────────────────────────────────────────────────── -->
    <div v-if="addRepoModal" class="modal-overlay" @click.self="addRepoModal = false">
      <div class="modal-box" style="width: 420px">
        <div class="modal-header">
          <span>Add Helm Repository</span>
          <button class="btn-close" @click="addRepoModal = false">✕</button>
        </div>
        <div class="modal-body" style="display:flex; flex-direction:column; gap:12px">
          <label class="form-label">
            Name
            <input v-model="newRepo.name" class="form-input" placeholder="e.g. bitnami" />
          </label>
          <label class="form-label">
            URL
            <input v-model="newRepo.url" class="form-input" placeholder="https://charts.bitnami.com/bitnami" />
          </label>
          <label class="form-label">
            Username <span class="text-dim">(optional)</span>
            <input v-model="newRepo.username" class="form-input" placeholder="user" />
          </label>
          <label class="form-label">
            Password <span class="text-dim">(optional)</span>
            <input v-model="newRepo.password" class="form-input" type="password" placeholder="••••••" />
          </label>
          <div v-if="addRepoError" class="error-inline">{{ addRepoError }}</div>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="addRepoModal = false">Cancel</button>
          <button class="btn primary" :disabled="addingRepo" @click="addRepo">
            {{ addingRepo ? 'Adding…' : 'Add Repository' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── Uninstall confirm modal ───────────────────────────────────────── -->
    <div v-if="uninstallTarget" class="modal-overlay" @click.self="uninstallTarget = null">
      <div class="modal-box" style="width: 380px">
        <div class="modal-header">
          <span>Uninstall Release</span>
          <button class="btn-close" @click="uninstallTarget = null">✕</button>
        </div>
        <div class="modal-body">
          <p>
            Are you sure you want to uninstall
            <strong>{{ uninstallTarget?.name }}</strong>
            from namespace <strong>{{ uninstallTarget?.namespace }}</strong>?
          </p>
          <p class="text-dim" style="margin-top:8px; font-size:12px">
            This will remove all Kubernetes resources created by the release.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="uninstallTarget = null">Cancel</button>
          <button class="btn danger" :disabled="uninstalling" @click="doUninstall">
            {{ uninstalling ? 'Uninstalling…' : 'Uninstall' }}
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

const props = defineProps({
  initialTab: { type: String, default: 'releases' },
})

const store = useKubeStore()

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

// ── Computed ───────────────────────────────────────────────────────────────
const filteredReleases = computed(() => {
  const q = filter.value.toLowerCase()
  if (!q) return releases.value
  return releases.value.filter(r =>
    JSON.stringify(r).toLowerCase().includes(q)
  )
})

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
    alert(`Uninstall failed: ${err.message}`)
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
    addRepoError.value = 'Name and URL are required'
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
  if (!confirm(`Remove repository "${name}"?`)) return
  try {
    const res = await fetch(`/api/helm/repos/${encodeURIComponent(name)}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    await loadRepos()
  } catch (err) {
    alert(`Error removing repo: ${err.message}`)
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
    alert(`Update failed: ${err.message}`)
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

// ── Lifecycle ──────────────────────────────────────────────────────────────
function switchTab(t) {
  tab.value = t
  if (t === 'releases') loadReleases()
  if (t === 'repos')    loadRepos()
  nextTick(() => createIcons({ icons }))
}

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
</style>
