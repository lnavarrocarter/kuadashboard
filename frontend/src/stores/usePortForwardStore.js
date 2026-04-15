import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../composables/useApi'

const PF_STORE_KEY = 'kuadashboard_pf_saved'

export const usePortForwardStore = defineStore('portforward', () => {
  const list = ref([])

  async function load() {
    try { list.value = await api('GET', '/api/portforwards') } catch (_) { list.value = [] }
  }

  async function start(namespace, name, localPort, remotePort) {
    const r = await api('POST', `/api/${namespace}/services/${name}/portforward`,
      { localPort, remotePort })
    await load()
    persist()
    return r
  }

  async function stop(localPort) {
    await api('DELETE', '/api/portforward/' + localPort)
    await load()
    persist()
  }

  function persist() {
    localStorage.setItem(PF_STORE_KEY, JSON.stringify(list.value))
  }

  async function autoRestore() {
    const saved = JSON.parse(localStorage.getItem(PF_STORE_KEY) || '[]')
    for (const pf of saved) {
      try {
        await api('POST', `/api/${pf.namespace}/services/${pf.name}/portforward`,
          { localPort: pf.localPort, remotePort: pf.remotePort })
      } catch (_) {}
    }
    await load()
  }

  return { list, load, start, stop, persist, autoRestore }
})
