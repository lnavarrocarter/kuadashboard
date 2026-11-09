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
      <div class="entrypoints-aws">
        <span>{{ awsProfileId ? t('entrypoints.awsProfile', { name: awsProfileLabel || awsProfileId }) : t('entrypoints.chooseAwsProfile') }}</span>
        <button type="button" class="btn sm" data-test="match-aws" :disabled="!awsProfileId || matching || loading || !data.entries.length" @click="matchAws">{{ t(matching ? 'common.loading' : 'entrypoints.matchAws') }}</button>
      </div>
      <p class="entrypoints-note">{{ t('entrypoints.awsReadNote') }}</p>
      <p v-if="cloudError" role="alert">{{ cloudError }}</p>
      <p v-if="cloud?.partial" role="status">{{ t('entrypoints.awsPartial') }}</p>
      <p v-if="cloud && !Object.keys(cloud.matches).length" role="status">{{ t('entrypoints.awsNoMatches') }}</p>
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
              <td>
                {{ entry.addresses.length ? entry.addresses.join(', ') : t(entry.type === 'NodePort' ? 'entrypoints.nodeAddress' : 'entrypoints.pending') }}
                <div v-if="cloud?.matches[entryKey(entry)]">
                  <button type="button" class="entrypoints-link" data-test="aws-link" @click="emit('open-aws-resource', cloud.matches[entryKey(entry)])">{{ cloud.matches[entryKey(entry)].name }}</button>
                  <div>{{ cloud.matches[entryKey(entry)].accountId }} · {{ cloud.matches[entryKey(entry)].region }}</div>
                  <div>{{ t('entrypoints.exactDnsMatch') }}</div>
                </div>
                <div v-if="cloud?.ambiguous.includes(entryKey(entry))">{{ t('entrypoints.awsAmbiguous') }}</div>
              </td>
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
import { linkAwsEntrypoints, entryKey } from '../lib/kubeEntrypointLinks'
import { useKubeStore } from '../stores/useKubeStore'
const props = defineProps({ awsProfileId: { type: String, default: '' }, awsProfileLabel: { type: String, default: '' } })
const emit = defineEmits(['navigate', 'open-aws-resource'])
const { t } = useI18n()
const store = useKubeStore()
const data = ref(null)
const loading = ref(false)
const error = ref(null)
const cloud = ref(null)
const cloudError = ref(null)
const matching = ref(false)
let cloudGeneration = 0
function clearCloud() {
  cloudGeneration++
  cloud.value = null
  cloudError.value = null
  matching.value = false
}
async function matchAws() {
  if (!props.awsProfileId || !data.value) return
  const id = ++cloudGeneration
  const profileId = props.awsProfileId
  const entries = data.value.entries
  matching.value = true
  cloud.value = null
  cloudError.value = null
  try {
    const result = await api('GET', '/api/cloud/aws/elb', undefined, { headers: { 'X-Profile-Id': profileId } })
    if (id !== cloudGeneration) return
    cloud.value = { ...linkAwsEntrypoints(entries, result.loadBalancers || [], profileId), partial: !!result.truncated || !!result.unavailable?.length }
  } catch (e) {
    if (id === cloudGeneration) cloudError.value = e.message
  } finally {
    if (id === cloudGeneration) matching.value = false
  }
}
watch(() => props.awsProfileId, clearCloud)
let generation = 0
async function load() {
  clearCloud()
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
  clearCloud()
  data.value = null
  error.value = null
  loading.value = false
})
onUnmounted(() => { generation++; clearCloud() })
</script>

<style scoped>
.entrypoints { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); padding: 12px 14px; font-size: 12px; }
.entrypoints-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h3 { margin: 0; font-size: 12px; }
p { color: var(--text-dim); }
.entrypoints-aws { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.entrypoints-note { font-size: 11px; }
.entrypoints-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; overflow-wrap: anywhere; }
th { color: var(--text-dim); }
.entrypoints-link { color: var(--accent); border: 0; background: none; padding: 0; font: inherit; cursor: pointer; }
.entrypoints-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
