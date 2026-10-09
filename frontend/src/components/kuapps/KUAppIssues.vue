<template>
  <section class="kis" data-test="kuapp-issues">
    <header class="kis-head">
      <strong>{{ t('kuapps.issue.title') }}</strong>
      <span v-if="data" class="kis-counts">
        <span v-if="data.counts.critical" class="kis-chip critical">{{ t('kuapps.issue.critical', { n: data.counts.critical }) }}</span>
        <span v-if="data.counts.warning" class="kis-chip warning">{{ t('kuapps.issue.warning', { n: data.counts.warning }) }}</span>
        <span v-if="data.counts.info" class="kis-chip info">{{ t('kuapps.issue.info', { n: data.counts.info }) }}</span>
      </span>
    </header>
    <p v-if="loading && !data" class="kis-dim">{{ t('common.loading') }}</p>
    <p v-else-if="error" class="kis-warn" role="alert">{{ error }}</p>
    <p v-else-if="data && !data.issues.length" class="kis-dim" data-test="kuapp-issues-none">{{ t('kuapps.issue.none') }}</p>
    <ol v-else-if="data" class="kis-list">
      <li v-for="issue in shown" :key="issue.id" :class="['kis-item', issue.severity]" :data-test="`issue-${issue.id}`">
        <span :class="['kis-dot', issue.severity]" :aria-label="t(`kuapps.issue.severity.${issue.severity}`)"></span>
        <span class="kis-body">
          <strong>{{ issue.resourceName }}</strong>
          <small>{{ evidence(issue) }}<template v-if="issue.since"> · {{ t('kuapps.issue.since', { ago: ago(t, issue.since) }) }}</template></small>
        </span>
        <button class="btn sm" :data-test="`issue-action-${issue.id}`" @click="$emit('action', issue)">{{ t(ISSUE_ACTIONS[issue.action]) }}</button>
      </li>
    </ol>
    <button v-if="data && limit && data.issues.length > limit" class="btn sm kis-more" data-test="kuapp-issues-more" @click="$emit('show-all')">{{ t('kuapps.issue.showAll', { n: data.issues.length }) }}</button>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { ago, issueEvidence, ISSUE_ACTIONS } from '../../lib/kuappIssues'

// What needs attention, most important first: the resource, the evidence, since when and the
// action that resolves it (#239). GET /api/kua-apps/applications/:id/observability/issues.
const props = defineProps({
  applicationId: { type: String, required: true },
  hours: { type: Number, default: 24 },
  limit: { type: Number, default: 0 },
})
const emit = defineEmits(['action', 'show-all', 'loaded'])
const { t } = useI18n()
const data = ref(null)
const loading = ref(false)
const error = ref('')
const evidence = issue => issueEvidence(t, issue)
const shown = computed(() => (props.limit ? data.value.issues.slice(0, props.limit) : data.value.issues))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response = await api('GET', `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/observability/issues?hours=${props.hours}`)
    // An older backend (or anything unexpected) reads as "nothing listed", never as a crash.
    data.value = {
      counts: { critical: 0, warning: 0, info: 0, ...(response?.counts || {}) },
      issues: Array.isArray(response?.issues) ? response.issues : [],
    }
    emit('loaded', data.value)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

watch(() => [props.applicationId, props.hours], load, { immediate: true })
defineExpose({ reload: load })
</script>

<style scoped>
.kis { display: flex; flex-direction: column; gap: 6px; }
.kis-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.kis-counts { display: flex; gap: 4px; flex-wrap: wrap; }
.kis-chip { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; }
.kis-chip.critical, .kis-dot.critical { color: var(--danger, #dc2626); }
.kis-chip.warning, .kis-dot.warning { color: var(--warning, #d97706); }
.kis-chip.info, .kis-dot.info { color: var(--text-dim); }
.kis-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.kis-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; min-width: 0; }
.kis-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.kis-body { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: 13px; }
.kis-body strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kis-body small { color: var(--text-dim); font-size: 12px; overflow-wrap: anywhere; }
.kis-dim { margin: 0; font-size: 12px; color: var(--text-dim); }
.kis-warn { margin: 0; font-size: 12px; color: var(--warning, #d97706); }
.kis-more { align-self: flex-start; }
</style>
