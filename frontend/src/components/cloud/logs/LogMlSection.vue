<template>
  <section class="msg-section lml" data-test="log-ml">
    <div class="lml-head">
      <h5><i data-lucide="sparkles"></i>{{ t('awsLogs.ml.title') }}</h5>
      <span v-if="status?.enabled" class="lml-actions">
        <button class="btn sm" data-test="log-ml-disable" @click="disable(false)">{{ t('awsLogs.ml.disable') }}</button>
        <button v-if="status.downloaded" class="btn sm" data-test="log-ml-remove" @click="disable(true)">{{ t('awsLogs.ml.remove', { size: mb(status.diskBytes) }) }}</button>
      </span>
    </div>

    <template v-if="!status"><p class="text-dim li-meta">{{ t('common.loading') }}</p></template>

    <template v-else-if="!status.enabled">
      <p class="li-meta">{{ t('awsLogs.ml.intro') }}</p>
      <div>
        <button class="btn sm accent" data-test="log-ml-enable" @click="enable">
          {{ status.downloaded ? t('awsLogs.ml.enable') : t('awsLogs.ml.enableDownload', { size: mb(status.downloadBytes) }) }}
        </button>
      </div>
    </template>

    <template v-else>
      <p v-if="status.state === 'loading'" class="li-meta" data-test="log-ml-progress">
        {{ status.progress?.total ? t('awsLogs.ml.downloading', { loaded: mb(status.progress.loaded), total: mb(status.progress.total) }) : t('awsLogs.ml.loading') }}
      </p>
      <p v-else-if="status.state === 'error'" class="activity-notice">{{ t('awsLogs.ml.failed', { error: status.error }) }}</p>

      <form class="lml-search" @submit.prevent="search">
        <input v-model="query" class="ctrl-input" :placeholder="t('awsLogs.ml.placeholder')" :aria-label="t('awsLogs.ml.placeholder')" data-test="log-ml-query" />
        <select v-model="scope" class="ctrl-select" :aria-label="t('awsLogs.ml.scope')">
          <option value="all">{{ t('awsLogs.ml.scopeAll') }}</option>
          <option value="group">{{ t('awsLogs.ml.scopeGroup') }}</option>
        </select>
        <button class="btn sm" :disabled="!query.trim() || searching" data-test="log-ml-search">{{ searching ? t('awsLogs.ml.searching') : t('awsLogs.ml.search') }}</button>
      </form>
      <p v-if="searchError" class="activity-notice">{{ searchError }}</p>
      <template v-else-if="results">
        <p v-if="!results.length" class="text-dim li-meta">{{ t('awsLogs.ml.noResults') }}</p>
        <ul v-else class="lml-results" data-test="log-ml-results">
          <li v-for="r in results" :key="r.logGroup + r.signature">
            <span class="lml-score" :title="t('awsLogs.ml.scoreHint')">{{ Math.round(r.score * 100) }}%</span>
            <button v-if="r.logGroup === group" class="btn sm li-sig-btn" :title="r.sample" @click="$emit('filter', { signature: r.signature, category: '' })">
              <code>{{ r.signature }}</code> × {{ r.occurrences }}
            </button>
            <span v-else class="lml-other" :title="r.sample"><code>{{ r.signature }}</code> × {{ r.occurrences }} <span class="text-dim">· {{ r.logGroup }}</span></span>
          </li>
        </ul>
      </template>

      <template v-if="ml?.clusters?.length">
        <h6 class="lml-sub">{{ t('awsLogs.ml.clusters') }}</h6>
        <p class="text-dim li-meta">{{ t('awsLogs.ml.clustersHint') }}</p>
        <div v-for="(cluster, i) in ml.clusters" :key="i" class="lml-cluster" data-test="log-ml-cluster">
          <span class="msg-chip warn">× {{ cluster.occurrences }}</span>
          <button v-for="s in cluster.signatures" :key="s.signature" class="btn sm li-sig-btn" @click="$emit('filter', { signature: s.signature, category: '' })">
            <code>{{ s.signature }}</code> × {{ s.occurrences }}
          </button>
          <span v-if="cluster.size > cluster.signatures.length" class="text-dim">{{ t('advisor.more', { n: cluster.size - cluster.signatures.length }) }}</span>
        </div>
      </template>
      <p v-if="ml?.state === 'ready'" class="text-dim li-meta">{{ t('awsLogs.ml.privacy') }}</p>
    </template>
  </section>
</template>

<script setup>
import { nextTick, onMounted, onUnmounted, onUpdated, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({
  group: { type: String, required: true },
  profileId: { type: String, default: '' },
  // `ml` of the log intelligence response: { state, clusters, suggestions } or null
  ml: { type: Object, default: null },
})
const emit = defineEmits(['filter', 'ready'])

const { t } = useI18n()
const { apiFetch } = useApi()
const status = ref(null)
const query = ref('')
const scope = ref('all')
const results = ref(null)
const searching = ref(false)
const searchError = ref('')
let timer = null

const mb = bytes => Math.max(1, Math.round((bytes || 0) / 1048576))

async function refresh() {
  const previous = status.value?.state
  try { status.value = await apiFetch('/api/system/ml') } catch { /* keep the last status */ }
  clearTimeout(timer)
  if (status.value?.state === 'loading') timer = setTimeout(refresh, 1000)
  if (previous && previous !== 'ready' && status.value?.state === 'ready') emit('ready')
}

async function enable() {
  status.value = await apiFetch('/api/system/ml/enable', { method: 'POST' })
  refresh()
}

async function disable(remove) {
  status.value = await apiFetch('/api/system/ml/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remove }) })
  results.value = null
  emit('ready')
}

async function search() {
  if (!query.value.trim()) return
  searching.value = true
  searchError.value = ''
  const params = new URLSearchParams({ q: query.value.trim() })
  if (scope.value === 'group') params.set('group', props.group)
  // The first search loads the model; show its progress meanwhile.
  if (status.value?.state !== 'ready') setTimeout(refresh, 300)
  try {
    const response = await apiFetch(`/api/cloud/aws/cloudwatch/log-intelligence/search?${params}`, { headers: { 'X-Profile-Id': props.profileId } })
    results.value = response.results
  } catch (err) {
    searchError.value = err.message
  } finally {
    searching.value = false
    refresh()
  }
}

const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(() => { refresh(); refreshIcons() })
onUpdated(refreshIcons)
onUnmounted(() => clearTimeout(timer))
</script>

<style scoped>
.lml { display: flex; flex-direction: column; gap: 8px; }
.lml-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.lml-head h5 { margin: 0; display: inline-flex; gap: 6px; align-items: center; }
.lml-head h5 svg { width: 14px; height: 14px; color: var(--accent); }
.lml-actions { display: inline-flex; gap: 4px; }
.lml-search { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lml-search input { flex: 1; min-width: 180px; }
.lml-results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.lml-results li { display: flex; gap: 8px; align-items: center; min-width: 0; font-size: 11px; }
.lml-score { font-variant-numeric: tabular-nums; color: var(--text-dim); min-width: 34px; text-align: right; flex: none; }
.lml-other { overflow-wrap: anywhere; }
.lml-other code { font-size: 10px; padding: 0 4px; border-radius: 3px; background: var(--bg-hover); }
.lml-sub { margin: 4px 0 0; font-size: 12px; }
.lml-cluster { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
</style>
