import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUpdateStore = defineStore('update', () => {
  const updateAvailable  = ref(false)
  const updateDownloaded = ref(false)
  const updateError      = ref(null)
  const newVersion       = ref('')

  // Registered once from App.vue — survives across modal open/close cycles
  function initListeners() {
    if (!window.kuaElectron?.on) return

    window.kuaElectron.on('update:available', info => {
      newVersion.value      = info.version
      updateAvailable.value = true
      updateError.value     = null
    })

    window.kuaElectron.on('update:downloaded', info => {
      newVersion.value       = info.version
      updateDownloaded.value = true
      updateError.value      = null
    })

    window.kuaElectron.on('update:error', msg => {
      updateError.value = msg
      installing.value = false
    })
  }

  const installing = ref(false)

  function installUpdate() {
    installing.value = true
    updateError.value = null
    window.kuaElectron?.installUpdate?.()
  }

  function checkForUpdates() {
    window.kuaElectron?.checkForUpdates?.()
  }

  return { updateAvailable, updateDownloaded, updateError, newVersion, installing, initListeners, installUpdate, checkForUpdates }
})
