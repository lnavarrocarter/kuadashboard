/**
 * stores/useEnvStore.js
 * Pinia store for managing cloud credential profiles (Env Manager).
 *
 * This store is the single source of truth for credential profiles in the UI.
 * It never caches raw key values — only masked/metadata representations.
 *
 * Desktop-ready: the `api` calls go through useApi() which can be swapped
 * for an Electron IPC adapter without touching this store.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useApi } from '../composables/useApi'

export const useEnvStore = defineStore('envManager', () => {
  const { apiFetch } = useApi()

  // ─── State ──────────────────────────────────────────────────────────────────
  const profiles  = ref([])   // [{ id, name, provider, createdAt, updatedAt, keyNames[] }]
  const loading   = ref(false)
  const error     = ref(null)

  // ─── Getters ────────────────────────────────────────────────────────────────
  const gcpProfiles     = computed(() => profiles.value.filter(p => p.provider === 'gcp'))
  const awsProfiles     = computed(() => profiles.value.filter(p => p.provider === 'aws'))
  const genericProfiles = computed(() => profiles.value.filter(p => p.provider === 'generic'))

  function findById(id) {
    return profiles.value.find(p => p.id === id) || null
  }

  // ─── Actions ─────────────────────────────────────────────────────────────────

  async function fetchProfiles() {
    loading.value = true
    error.value   = null
    try {
      profiles.value = await apiFetch('/api/cloud/envs/profiles')
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  /** Fetch a single profile with masked keys */
  async function fetchProfile(id) {
    try {
      return await apiFetch(`/api/cloud/envs/profiles/${id}`)
    } catch (e) {
      error.value = e.message
      return null
    }
  }

  async function createProfile({ name, provider, keys = {} }) {
    loading.value = true
    error.value   = null
    try {
      const created = await apiFetch('/api/cloud/envs/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, provider, keys }),
      })
      profiles.value.push(created)
      return created
    } catch (e) {
      error.value = e.message
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateProfile(id, { name, keys = {} }) {
    loading.value = true
    error.value   = null
    try {
      const updated = await apiFetch(`/api/cloud/envs/profiles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, keys }),
      })
      const idx = profiles.value.findIndex(p => p.id === id)
      if (idx !== -1) profiles.value[idx] = updated
      return updated
    } catch (e) {
      error.value = e.message
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteProfile(id) {
    loading.value = true
    error.value   = null
    try {
      await apiFetch(`/api/cloud/envs/profiles/${id}`, { method: 'DELETE' })
      profiles.value = profiles.value.filter(p => p.id !== id)
      return true
    } catch (e) {
      error.value = e.message
      return false
    } finally {
      loading.value = false
    }
  }

  /** Download a profile as a .env file (triggers browser download) */
  async function exportProfile(id) {
    try {
      const resp = await fetch(`/api/cloud/envs/profiles/${id}/export`, { method: 'POST' })
      if (!resp.ok) throw new Error(await resp.text())
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `kuadashboard-${id}.env`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      error.value = e.message
    }
  }

  return {
    profiles, loading, error,
    gcpProfiles, awsProfiles, genericProfiles,
    findById,
    fetchProfiles, fetchProfile,
    createProfile, updateProfile, deleteProfile, exportProfile,
  }
})
