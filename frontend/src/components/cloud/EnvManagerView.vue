<template>
  <div class="cloud-view">
    <div class="cloud-view-header">
      <div>
        <h2 class="cloud-view-title">Credential Profiles</h2>
        <p class="text-dim" style="font-size:12px;margin-top:2px">
          Keys are stored encrypted (AES-256-GCM). Raw values are never sent to the browser.
        </p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" @click="showImport = true">↑ Import .env</button>
        <button class="btn primary" @click="openCreate">+ New Profile</button>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="envStore.error" class="alert-error">{{ envStore.error }}</div>

    <!-- Loading -->
    <div v-if="envStore.loading" class="loading-row">Loading profiles…</div>

    <!-- Empty state -->
    <div v-else-if="!envStore.profiles.length" class="empty-state">
      No credential profiles yet.<br />Create one or import a .env file.
    </div>

    <!-- Category groups -->
    <template v-else>
      <div v-for="(group, cat) in profilesByCategory" :key="cat" class="category-group">
        <div v-if="cat" class="category-label">{{ cat }}</div>
        <div class="profile-grid">
          <div v-for="profile in group" :key="profile.id" class="profile-card">
            <div class="profile-card-header">
              <span class="provider-badge" :class="`provider-${profile.provider}`">{{ providerLabel(profile.provider) }}</span>
              <div class="profile-card-actions">
                <button class="btn sm" title="Edit" @click="openEdit(profile)">Edit</button>
                <button class="btn sm" title="Export .env" @click="envStore.exportProfile(profile.id)">Export</button>
                <button class="btn sm danger" title="Delete" @click="confirmDelete(profile)">Delete</button>
              </div>
            </div>
            <div class="profile-name">{{ profile.name }}</div>
            <div class="profile-meta text-dim">
              <span>{{ profile.keyNames?.length || 0 }} key(s)</span>
              <span>Updated {{ relativeTime(profile.updatedAt) }}</span>
            </div>
            <!-- Key chips with tags -->
            <div class="profile-keys">
              <span
                v-for="k in profile.keyNames"
                :key="k"
                class="key-chip"
              >
                {{ k }}
                <span
                  v-for="tag in (profile.meta?.[k]?.tags || [])"
                  :key="tag"
                  class="key-chip-tag"
                >{{ tag }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Profile create/edit modal -->
    <ProfileModal
      :show="showModal"
      :profile="editingProfile"
      @close="showModal = false"
      @save="handleSave"
    />

    <!-- Import .env modal -->
    <ImportEnvModal
      :show="showImport"
      @close="showImport = false"
      @imported="onImported"
    />

    <!-- Delete confirm -->
    <Teleport to="body">
      <div v-if="deleteTarget" class="modal-overlay" @mousedown.self="deleteTarget = null">
        <div class="modal-box" style="width:380px">
          <div class="modal-header">
            <span>Delete Profile</span>
            <button class="btn-close" @click="deleteTarget = null">✕</button>
          </div>
          <div class="modal-body">
            Delete profile <strong>{{ deleteTarget.name }}</strong>?
            All stored keys will be permanently removed.
          </div>
          <div class="modal-footer">
            <button class="btn" @click="deleteTarget = null">Cancel</button>
            <button class="btn danger" @click="doDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useEnvStore }    from '../../stores/useEnvStore'
import ProfileModal       from '../modals/ProfileModal.vue'
import ImportEnvModal     from '../modals/ImportEnvModal.vue'

const envStore = useEnvStore()

const showModal      = ref(false)
const showImport     = ref(false)
const editingProfile = ref(null)
const deleteTarget   = ref(null)

onMounted(() => envStore.fetchProfiles())

function openCreate() { editingProfile.value = null; showModal.value = true }
function openEdit(p)  { editingProfile.value = p;    showModal.value = true }

async function handleSave({ name, category, provider, keys, meta }) {
  if (editingProfile.value) {
    await envStore.updateProfile(editingProfile.value.id, { name, category, keys, meta })
  } else {
    await envStore.createProfile({ name, category, provider, keys, meta })
  }
  showModal.value = false
}

function onImported() {
  showImport.value = false
}

function confirmDelete(p) { deleteTarget.value = p }
async function doDelete() {
  await envStore.deleteProfile(deleteTarget.value.id)
  deleteTarget.value = null
}

const providerLabel = p => ({ gcp: 'GCP', aws: 'AWS', generic: 'Generic' }[p] || p)

/** Group profiles by category (empty string → no category, shown first) */
const profilesByCategory = computed(() => {
  const groups = {}
  for (const p of envStore.profiles) {
    const cat = p.category || ''
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(p)
  }
  // Sort: uncategorised ('') first, then alphabetical
  const sorted = {}
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === '') return -1
    if (b === '') return 1
    return a.localeCompare(b)
  })
  for (const k of keys) sorted[k] = groups[k]
  return sorted
})

function relativeTime(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m    = Math.floor(diff / 60000)
  if (m < 1)   return 'just now'
  if (m < 60)  return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)  return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
</script>

<style scoped>
.category-group  { margin-bottom: 18px; }
.category-label  {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--text-dim, #888);
  margin-bottom: 8px;
  padding-left: 2px;
}

.key-chip-tag {
  display: inline-block;
  background: var(--accent-dim, #2d3a5a);
  color: var(--accent, #7c9ef8);
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  margin-left: 4px;
  vertical-align: middle;
}
</style>
