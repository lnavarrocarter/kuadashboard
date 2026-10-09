<template>
  <div v-if="loading || error || items.length" class="kuapps-review-group kmr" data-test="missing-resources">
    <div class="kuapps-review-group-heading"><strong>{{ t('kuapps.missing.title') }}</strong><span>{{ items.length }}</span></div>
    <p class="kmr-hint">{{ t('kuapps.missing.hint') }}</p>
    <p v-if="loading && !items.length" class="kmr-hint">{{ t('common.loading') }}</p>
    <p v-if="error" class="kmr-warn" role="alert">{{ error }}</p>
    <article v-for="item in items" :key="item.resourceId" class="kmr-item" :data-test="`missing-${item.name}`">
      <header>
        <span><strong>{{ item.name }}</strong><small>{{ [item.kind, item.namespace].filter(Boolean).join(' · ') }} · {{ t('kuapps.missing.since', { when: when(item.goneSince) }) }}</small></span>
        <span class="kmr-actions">
          <button class="btn sm" :disabled="busy || !item.registryId" :data-test="`missing-detach-${item.name}`" @click="detach(item)">{{ t('kuapps.missing.detach') }}</button>
          <button class="btn sm" :disabled="busy" :data-test="`missing-ignore-${item.name}`" @click="ignore(item)">{{ t('kuapps.missing.ignore') }}</button>
        </span>
      </header>
      <p v-if="item.error" class="kmr-warn">{{ t('kuapps.missing.clusterUnreadable', { error: item.error }) }}</p>
      <p v-else-if="item.reason === 'unsupported'" class="kmr-hint">{{ t('kuapps.missing.noSuccessorKind') }}</p>
      <p v-else-if="!item.successors.length" class="kmr-hint">{{ t('kuapps.missing.noSuccessor') }}</p>
      <ul v-else class="kmr-successors">
        <li v-for="successor in item.successors" :key="successor.name">
          <span>
            <strong>{{ successor.name }}</strong>
            <span :class="['kmr-chip', successor.confidence]">{{ t(`kuapps.missing.confidence.${successor.confidence}`) }}</span>
            <small>{{ successor.evidence.map(evidence => t(`kuapps.missing.evidence.${evidence.type}`, { label: evidence.label, value: evidence.value, stem: evidence.stem })).join(' · ') }}</small>
          </span>
          <button class="btn sm primary" :disabled="busy" :data-test="`missing-replace-${item.name}-${successor.name}`" @click="replace(item, successor)">{{ t('kuapps.missing.replace') }}</button>
        </li>
      </ul>
    </article>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { settings } from '../../composables/useSettings'

// KUApps → Review: resources that no longer exist (#236), with the successor KUA found in the
// cluster. Nothing is replaced without the user, and nothing changes in the cluster.
const props = defineProps({
  applicationId: { type: String, required: true },
  revision: { type: Number, default: null },
})
const emit = defineEmits(['changed'])
const { t } = useI18n()
const { toast } = useToast()
const items = ref([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const base = () => `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}`
const when = iso => (iso ? new Date(iso).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = (await api('GET', `${base()}/observer`)).resources || []
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function run(action, message) {
  busy.value = true
  try {
    await action()
    toast(message, 'success')
    emit('changed')
    await load()
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    busy.value = false
  }
}

const replace = (item, successor) => run(
  () => api('POST', `${base()}/observer/replace`, { resourceId: item.resourceId, successor: successor.name, ...(props.revision != null ? { expectedRevision: props.revision } : {}) }),
  t('kuapps.missing.replaced', { from: item.name, to: successor.name }),
)
const ignore = item => run(() => api('POST', `${base()}/observer/ignore`, { resourceId: item.resourceId }), t('kuapps.missing.ignored', { name: item.name }))
// Detaching uses the same route as Resources: the resource leaves the application, nothing is deleted.
const detach = item => run(() => api('DELETE', `${base()}/registry/resources/${encodeURIComponent(item.registryId)}`), t('kuapps.missing.detached', { name: item.name }))

watch(() => props.applicationId, load, { immediate: true })
defineExpose({ reload: load })
</script>

<style scoped>
.kmr-hint { margin: 0 0 6px; font-size: 12px; color: var(--text-dim); }
.kmr-warn { margin: 0 0 6px; font-size: 12px; color: var(--warning, #d97706); }
.kmr-item { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 6px; }
.kmr-item header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
.kmr-item header > span:first-child { display: flex; flex-direction: column; min-width: 0; }
.kmr-item small { color: var(--text-dim); font-size: 12px; overflow-wrap: anywhere; }
.kmr-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.kmr-successors { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.kmr-successors li { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.kmr-successors li > span { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; min-width: 0; }
.kmr-chip { font-size: 12px; padding: 1px 6px; border-radius: 999px; border: 1px solid currentColor; }
.kmr-chip.high { color: var(--success, #16a34a); }
.kmr-chip.medium { color: var(--warning, #d97706); }
</style>
