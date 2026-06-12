<template>
  <div class="cloud-view">
    <div class="cloud-view-header">
      <div>
        <h2 class="cloud-view-title">{{ t('env.title') }}</h2>
        <p class="text-dim" style="font-size:12px;margin-top:2px">
          {{ t('env.subtitle') }}
        </p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn" @click="showImport = true">{{ t('env.importEnv') }}</button>
        <button class="btn primary" @click="openCreate">{{ t('env.newProfile') }}</button>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="envStore.error" class="alert-error">{{ envStore.error }}</div>

    <!-- Loading -->
    <div v-if="envStore.loading" class="loading-row">{{ t('env.loadingProfiles') }}</div>

    <!-- Empty state -->
    <div v-else-if="!envStore.profiles.length" class="empty-state">
      {{ t('env.empty') }}<br />{{ t('env.emptyHint') }}
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
                <button class="btn sm" title="Edit" @click="openEdit(profile)">{{ t('env.editBtn') }}</button>
                <button class="btn sm" title="Export .env" @click="envStore.exportProfile(profile.id)">{{ t('env.exportBtn') }}</button>
                <button class="btn sm danger" title="Delete" @click="confirmDelete(profile)">{{ t('env.deleteBtn') }}</button>
              </div>
            </div>
            <div class="profile-name">{{ profile.name }}</div>
            <!-- SSO session expiry badge -->
            <div v-if="ssoExpiry(profile)" class="sso-expiry-badge" :class="ssoExpiry(profile).cls">
              {{ ssoExpiry(profile).label }}
            </div>
            <div class="profile-meta text-dim">
              <span>{{ t('env.keys', { n: profile.keyNames?.length || 0 }) }}</span>
              <span>{{ t('env.updated', { time: relativeTime(profile.updatedAt) }) }}</span>
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
            <span>{{ t('env.deleteTitle') }}</span>
            <button class="btn-close" @click="deleteTarget = null">✕</button>
          </div>
          <div class="modal-body">
            {{ t('env.deleteConfirm', { name: deleteTarget.name }) }}
          </div>
          <div class="modal-footer">
            <button class="btn" @click="deleteTarget = null">{{ t('env.cancelBtn') }}</button>
            <button class="btn danger" @click="doDelete">{{ t('action.delete') }}</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useEnvStore }    from '../../stores/useEnvStore'
import ProfileModal       from '../modals/ProfileModal.vue'
import ImportEnvModal     from '../modals/ImportEnvModal.vue'
import { useI18n }        from '../../composables/useI18n.js'

const { t } = useI18n()

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

const providerLabel = p => ({ gcp: 'GCP', aws: 'AWS', vercel: 'Vercel', generic: 'Generic' }[p] || p)

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

// ── SSO session expiry badge ───────────────────────────────────────────────────
const now = ref(Date.now())
let nowTick = null
onMounted(() => { nowTick = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => clearInterval(nowTick))

function ssoExpiry(profile) {
  const expiresAt = profile.meta?.__sso?.expiresAt
  if (!expiresAt) return null
  const ms = expiresAt - now.value
  if (ms <= 0) return { label: 'SSO · sesión expirada', cls: 'expired' }
  const mins = Math.round(ms / 60000)
  const rel  = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
  return { label: `SSO · expira en ${rel}`, cls: mins < 15 ? 'warning' : 'ok' }
}

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

.sso-expiry-badge {
  display: inline-block;
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  border-radius: 10px;
  padding: 2px 9px;
  margin: 4px 0 2px;
}
.sso-expiry-badge.ok {
  background: color-mix(in srgb, var(--green, #3fbf6f) 15%, transparent);
  color: var(--green, #3fbf6f);
}
.sso-expiry-badge.warning {
  background: color-mix(in srgb, var(--yellow, #e0b341) 15%, transparent);
  color: var(--yellow, #e0b341);
}
.sso-expiry-badge.expired {
  background: color-mix(in srgb, var(--red, #e05c5c) 15%, transparent);
  color: var(--red, #e05c5c);
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
