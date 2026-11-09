<template>
  <section class="entrypoints" data-test="entrypoints">
    <div class="entrypoints-head">
      <h3>{{ t('entrypoints.title') }}</h3>
      <button type="button" class="btn sm" :disabled="loading" @click="load">{{ t(data ? 'action.refresh' : 'entrypoints.load') }}</button>
    </div>
    <p>{{ t('entrypoints.note') }}</p>
    <p v-if="loading" role="status">{{ t('common.loading') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="data">
      <p v-for="source in data.unavailable" :key="source.resource" role="status">{{ t('entrypoints.unavailable', { resource: source.resource }) }}</p>
      <p v-if="!data.entries.length && !data.unavailable.length">{{ t('entrypoints.empty') }}</p>
      <div v-if="data.entries.length" class="entrypoints-scroll">
        <table>
          <thead><tr><th>{{ t('entrypoints.resource') }}</th><th>{{ t('entrypoints.addresses') }}</th><th>{{ t('entrypoints.routes') }}</th></tr></thead>
          <tbody>
            <tr v-for="entry in data.entries" :key="`${entry.kind}/${entry.namespace}/${entry.name}`">
              <td>
                <button type="button" class="entrypoints-link" @click="emit('navigate', { resource: entry.resource, filter: entry.name, namespace: entry.namespace })">{{ entry.name }}</button>
                <div>{{ entry.namespace }} · {{ entry.type }}</div>
                <div v-if="entry.kind === 'Ingress'">{{ t('entrypoints.class', { name: entry.className || '—' }) }} · {{ t(entry.tlsConfigured ? 'entrypoints.tlsConfigured' : 'entrypoints.noTls') }}</div>
              </td>
              <td>{{ entry.addresses.length ? entry.addresses.join(', ') : t(entry.type === 'NodePort' ? 'entrypoints.nodeAddress' : 'entrypoints.pending') }}</td>
              <td>
                <div v-for="(route, i) in entry.routes || []" :key="i">{{ route.host }}{{ route.path }} → {{ route.backend }} <span v-if="route.pathType">({{ route.pathType }})</span> · {{ route.tls ? 'TLS' : '—' }}</div>
                <div v-for="(port, i) in entry.ports || []" :key="i">{{ port.port }}/{{ port.protocol }} → {{ port.targetPort }}<span v-if="port.nodePort"> · NodePort {{ port.nodePort }}</span></div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { api } from '../composables/useApi'
import { useI18n } from '../composables/useI18n'
import { useKubeStore } from '../stores/useKubeStore'
const emit = defineEmits(['navigate'])
const { t } = useI18n()
const store = useKubeStore()
const data = ref(null)
const loading = ref(false)
const error = ref(null)
let generation = 0
async function load() {
  const id = ++generation
  const context = store.currentContext
  loading.value = true
  error.value = null
  try {
    const result = await api('GET', `/api/entrypoints?namespace=${encodeURIComponent(store.namespace || 'all')}`)
    if (id !== generation) return
    if (context && result.context !== context) throw new Error(t('entrypoints.contextChanged'))
    data.value = result
  } catch (e) {
    if (id === generation) error.value = e.message
  } finally {
    if (id === generation) loading.value = false
  }
}
watch(() => [store.currentContext, store.namespace], () => {
  generation++
  data.value = null
  error.value = null
  loading.value = false
})
onUnmounted(() => { generation++ })
</script>

<style scoped>
.entrypoints { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); padding: 12px 14px; font-size: 12px; }
.entrypoints-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h3 { margin: 0; font-size: 12px; }
p { color: var(--text-dim); }
.entrypoints-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--text-dim); }
.entrypoints-link { color: var(--accent); border: 0; background: none; padding: 0; font: inherit; cursor: pointer; }
.entrypoints-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
