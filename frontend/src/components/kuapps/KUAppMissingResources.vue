<template>
  <section v-if="loading || error || items.length" class="kmr" data-test="missing-resources">
    <header class="kmr-heading">
      <span><strong>{{ t('kuapps.missing.title') }}</strong><small>{{ t('kuapps.missing.hint') }}</small></span>
      <b v-if="items.length" class="kmr-count">{{ items.length }}</b>
    </header>
    <p v-if="loading && !items.length" class="kmr-note">{{ t('common.loading') }}</p>
    <p v-if="error" class="kmr-warn" role="alert">{{ error }}</p>
    <article v-for="item in items" :key="item.resourceId" class="kmr-item" :data-test="`missing-${item.name}`">
      <header class="kmr-item-head">
        <span class="kmr-name">
          <strong>{{ item.name }}</strong>
          <small>{{ [item.kind, item.namespace].filter(Boolean).join(' · ') }} · {{ t('kuapps.missing.since', { when: when(item.goneSince) }) }}</small>
        </span>
        <span class="kmr-actions">
          <button class="btn sm" :disabled="busy || !item.registryId" :data-test="`missing-detach-${item.name}`" @click="detach(item)">{{ t('kuapps.missing.detach') }}</button>
          <button class="btn sm" :disabled="busy" :data-test="`missing-ignore-${item.name}`" @click="ignore(item)">{{ t('kuapps.missing.ignore') }}</button>
        </span>
      </header>

      <div v-if="item.cause" class="kmr-block kmr-cause" :data-test="`missing-cause-${item.name}`">
        <i data-lucide="git-commit-horizontal"></i>
        <span>
          <a v-if="item.cause.event.url" :href="item.cause.event.url" target="_blank" rel="noopener noreferrer">{{ causeTitle(item.cause) }}</a>
          <strong v-else>{{ causeTitle(item.cause) }}</strong>
          <small>{{ causeDetail(item.cause.event) }}</small>
        </span>
      </div>

      <p v-if="item.error" class="kmr-warn">{{ t('kuapps.missing.clusterUnreadable', { error: item.error }) }}</p>
      <p v-else-if="item.reason === 'unsupported'" class="kmr-note">{{ t('kuapps.missing.noSuccessorKind') }}</p>
      <p v-else-if="!item.successors.length" class="kmr-note">{{ t('kuapps.missing.noSuccessor') }}</p>
      <ul v-else class="kmr-successors">
        <li v-for="successor in item.successors" :key="successor.name">
          <span class="kmr-successor">
            <span class="kmr-successor-name">
              <strong>{{ successor.name }}</strong>
              <span :class="['kmr-chip', successor.confidence]">{{ t(`kuapps.missing.confidence.${successor.confidence}`) }}</span>
            </span>
            <small>{{ successor.evidence.map(evidence => t(`kuapps.missing.evidence.${evidence.type}`, { label: evidence.label, value: evidence.value, stem: evidence.stem })).join(' · ') }}</small>
          </span>
          <button class="btn sm primary" :disabled="busy" :data-test="`missing-replace-${item.name}-${successor.name}`" @click="replace(item, successor)">{{ t('kuapps.missing.replace') }}</button>
        </li>
      </ul>
    </article>
  </section>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
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

const causeTitle = cause => t(cause.confidence === 'probable' ? 'kuapps.missing.cause' : 'kuapps.missing.causePossible', {
  number: cause.event.number, name: cause.event.name, repository: cause.event.repository,
})
const causeDetail = event => t('kuapps.missing.causeDetail', {
  commit: [event.sha ? event.sha.slice(0, 7) : '', event.commit?.message].filter(Boolean).join(' '),
  author: event.actor ? ` · @${event.actor}` : '',
  when: when(event.at),
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    items.value = (await api('GET', `${base()}/observer`)).resources || []
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
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
.kmr { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--yellow); border-radius: 7px; background: var(--bg-panel); }
.kmr-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.kmr-heading > span { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.kmr-heading strong { font-size: 13px; }
.kmr-heading small, .kmr-note, .kmr-name small, .kmr-successor small, .kmr-cause small { color: var(--text-dim); font-size: 12px; line-height: 1.5; }
.kmr-count { flex: none; min-width: 20px; padding: 1px 7px; border: 1px solid var(--yellow); border-radius: 10px; color: var(--yellow); font-size: 12px; text-align: center; }
.kmr-note, .kmr-warn { margin: 0; }
.kmr-warn { color: var(--yellow); font-size: 12px; }
.kmr-item { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.kmr-item-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.kmr-name { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.kmr-name strong { font-size: 13px; overflow-wrap: anywhere; }
.kmr-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.kmr-block { display: flex; align-items: flex-start; gap: 8px; padding: 7px 10px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 0 5px 5px 0; }
.kmr-cause > svg { width: 14px; flex: none; margin-top: 2px; color: var(--accent); }
.kmr-cause > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
.kmr-cause a { color: var(--text); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.kmr-cause a:hover { color: var(--accent); text-decoration: underline; }
.kmr-cause small { overflow-wrap: anywhere; }
.kmr-successors { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.kmr-successors li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 8px; border-top: 1px solid var(--border); }
.kmr-successor { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.kmr-successor-name { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.kmr-successor small { overflow-wrap: anywhere; }
.kmr-chip { padding: 1px 7px; border: 1px solid currentColor; border-radius: 10px; font-size: 12px; white-space: nowrap; }
.kmr-chip.high { color: var(--green); }
.kmr-chip.medium { color: var(--yellow); }
</style>
