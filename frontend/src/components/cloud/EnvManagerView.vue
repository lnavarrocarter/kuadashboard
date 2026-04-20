<template>
  <div class="cloud-view">
    <div class="cloud-view-header">
      <div>
        <h2 class="cloud-view-title">Credential Profiles</h2>
        <p class="text-dim" style="font-size:12px;margin-top:2px">
          Keys are stored encrypted (AES-256-GCM). Raw values are never sent to the browser.
        </p>
      </div>
      <button class="btn primary" @click="openCreate">+ New Profile</button>
    </div>

    <!-- Error banner -->
    <div v-if="envStore.error" class="alert-error">{{ envStore.error }}</div>

    <!-- Loading -->
    <div v-if="envStore.loading" class="loading-row">Loading profiles…</div>

    <!-- Empty state -->
    <div v-else-if="!envStore.profiles.length" class="empty-state">
      No credential profiles yet.<br />Create one to connect to GCP or AWS.
    </div>

    <!-- Profile cards -->
    <div v-else class="profile-grid">
      <div v-for="profile in envStore.profiles" :key="profile.id" class="profile-card">
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
        <div class="profile-keys">
          <span v-for="k in profile.keyNames" :key="k" class="key-chip">{{ k }}</span>
        </div>
      </div>
    </div>

    <!-- Profile create/edit modal -->
    <ProfileModal
      :show="showModal"
      :profile="editingProfile"
      @close="showModal = false"
      @save="handleSave"
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
import { ref, onMounted } from 'vue'
import { useEnvStore }  from '../../stores/useEnvStore'
import ProfileModal     from '../modals/ProfileModal.vue'

const envStore = useEnvStore()

const showModal      = ref(false)
const editingProfile = ref(null)
const deleteTarget   = ref(null)

onMounted(() => envStore.fetchProfiles())

function openCreate() { editingProfile.value = null; showModal.value = true }
function openEdit(p)  { editingProfile.value = p;    showModal.value = true }

async function handleSave({ name, provider, keys }) {
  if (editingProfile.value) {
    await envStore.updateProfile(editingProfile.value.id, { name, keys })
  } else {
    await envStore.createProfile({ name, provider, keys })
  }
  showModal.value = false
}

function confirmDelete(p) { deleteTarget.value = p }
async function doDelete() {
  await envStore.deleteProfile(deleteTarget.value.id)
  deleteTarget.value = null
}

const providerLabel = p => ({ gcp: 'GCP', aws: 'AWS', generic: 'Generic' }[p] || p)

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
