<template>
  <section class="kuapp-sync">
    <header>
      <div><h4>{{ t('kuapps.sync.joinTitle') }}</h4></div>
      <span v-if="status?.lastSuccessAt" class="kuapp-sync-chip ok" data-test="sync-last">{{ t('kuapps.sync.lastRun', { date: new Date(status.lastSuccessAt).toLocaleString(), ms: status.lastDurationMs ?? 0 }) }}</span>
      <span v-else-if="available" class="kuapp-sync-chip">{{ t('kuapps.sync.never') }}</span>
    </header>
    <p class="kuapp-sync-explain"><strong>{{ t('kuapps.sync.what') }}</strong> {{ t('kuapps.sync.joinExplain') }}</p>
    <p v-if="status?.lastError" class="kuapp-sync-error" role="alert">{{ t('kuapps.sync.lastError', { date: new Date(status.lastErrorAt).toLocaleString(), error: status.lastError }) }}</p>
    <p v-if="error" class="kuapp-sync-error" role="alert">{{ error }}</p>
    <footer v-if="available">
      <span class="kuapp-sync-pending">{{ pendingLabel }}</span>
      <button v-if="pending" class="btn sm" @click="$emit('open-tab', 'review')">{{ t('kuapps.sync.openReview') }}</button>
      <button class="btn sm" data-test="sync-run" :disabled="running" @click="reconcile">
        <i :data-lucide="running ? 'loader-2' : 'git-merge'"></i>{{ running ? t('apmv.reconciling') : t('kuapps.sync.runNow') }}
      </button>
    </footer>
    <p v-else class="kuapp-sync-pending">{{ t('kuapps.sync.unavailable') }}</p>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'

// The local join between Observability resources and Architecture nodes (the shared
// registry reconciliation), with what it does in plain words. No cloud call.
const props = defineProps({
  application: { type: Object, default: null },
  provider: { type: String, default: 'generic' },
})
const emit = defineEmits(['open-tab', 'reconciled'])
const { t } = useI18n()
const { apiFetch } = useApi()
const status = ref(null)
const running = ref(false)
const error = ref('')

const available = computed(() => !!props.application?.profileId)
const base = computed(() => `/api/observability/${props.provider}/applications/${encodeURIComponent(props.application?.id || '')}/registry`)
const headers = computed(() => ({ 'X-Profile-Id': props.application?.profileId || '' }))
const pending = computed(() => (status.value?.divergentResourceCount || 0) + (status.value?.divergentRelationshipCount || 0))
const pendingLabel = computed(() => pending.value
  ? t('kuapps.sync.pending', { resources: status.value?.divergentResourceCount || 0, relationships: status.value?.divergentRelationshipCount || 0 })
  : t('kuapps.sync.nothingPending'))

async function load() {
  status.value = null
  error.value = ''
  if (!available.value) return
  try {
    status.value = (await apiFetch(base.value, { headers: headers.value }))?.syncStatus || null
  } catch (err) { error.value = err.message }
  nextTick(() => createIcons({ icons }))
}

async function reconcile() {
  running.value = true
  error.value = ''
  try {
    const result = await apiFetch(`${base.value}/reconcile`, { method: 'POST', headers: headers.value })
    status.value = result?.syncStatus || status.value
    emit('reconciled', result)
  } catch (err) { error.value = err.message } finally {
    running.value = false
    nextTick(() => createIcons({ icons }))
  }
}

watch(() => [props.application?.id, props.application?.profileId, props.provider], load, { immediate: true })
</script>

<style scoped>
.kuapp-sync { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-panel); }
.kuapp-sync > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.kuapp-sync h4 { margin: 0; font-size: 13px; }
.kuapp-sync-chip { padding: 2px 8px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-dim); font-size: 10px; white-space: nowrap; }
.kuapp-sync-chip.ok { border-color: var(--green); color: var(--green); }
.kuapp-sync-explain { margin: 0; padding: 7px 10px; border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-dim); font-size: 11px; line-height: 1.5; }
.kuapp-sync-explain strong { color: var(--text); }
.kuapp-sync-error { margin: 0; color: var(--red); font-size: 11px; }
.kuapp-sync > footer { display: flex; align-items: center; gap: 8px; }
.kuapp-sync-pending { margin: 0 auto 0 0; color: var(--text-dim); font-size: 11px; }
.kuapp-sync svg { width: 13px; }
</style>
