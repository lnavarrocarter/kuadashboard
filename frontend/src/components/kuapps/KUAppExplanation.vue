<template>
  <BaseModal :show="!!request" wide @close="$emit('close')">
    <template #title><i data-lucide="circle-help"></i> {{ t('kuapps.explain.title', { source: request?.sourceName || '', target: request?.targetName || '' }) }}</template>
    <div class="kuapp-explain">
      <p v-if="loading" class="kuapp-explain-muted">{{ t('kuapps.explain.loading') }}</p>
      <p v-else-if="error" class="kuapp-explain-error" role="alert">{{ error }}</p>
      <template v-else-if="result">
        <p class="kuapp-explain-summary">{{ t(result.summary.key, summaryParams) }}</p>

        <section>
          <h4>{{ t('kuapps.explain.confidence') }}</h4>
          <div class="kuapp-explain-confidence">
            <strong v-if="result.confidence.value != null">{{ Math.round(result.confidence.value * 100) }}%</strong>
            <span v-for="(count, kind) in result.confidence.byClass" :key="kind" :class="['kuapp-explain-class', kind, { empty: !count }]">{{ t(`kuapps.explain.class.${kind}`) }} · {{ count }}</span>
          </div>
        </section>

        <section>
          <h4>{{ t('kuapps.explain.why') }}</h4>
          <p v-if="!result.evidence.length" class="kuapp-explain-muted">{{ t('kuapps.explain.noEvidence') }}</p>
          <ul class="kuapp-explain-list">
            <li v-for="(item, index) in result.evidence" :key="index">
              <span :class="['kuapp-explain-class', item.class]">{{ t(`kuapps.explain.class.${item.class}`) }}</span>
              <span>{{ t(item.key, item.params) }}</span>
            </li>
          </ul>
        </section>

        <section>
          <h4>{{ t('kuapps.explain.signals') }}</h4>
          <dl class="kuapp-explain-signals">
            <div><dt>{{ result.target.name }}</dt><dd>{{ rateLabel(result.signals.target) }}</dd></div>
            <div><dt>{{ result.source.name }}</dt><dd>{{ rateLabel(result.signals.source) }}</dd></div>
          </dl>
          <ul v-if="result.signals.mentions.length" class="kuapp-explain-list">
            <li v-for="item in result.signals.mentions" :key="item.signature">
              <span :class="['kuapp-explain-class', item.match === 'semantic' ? 'inferred' : 'observed']">{{ item.match === 'semantic' ? t('kuapps.explain.semanticMatch', { score: item.score }) : t('kuapps.explain.ruleMatch') }}</span>
              <span><code>{{ item.signature }}</code> × {{ item.occurrences }}</span>
            </li>
          </ul>
          <p v-for="limit in result.limits" :key="limit" class="kuapp-explain-muted">{{ t(`kuapps.explain.limit.${limit}`, { source: result.source.name, target: result.target.name }) }}</p>
          <button v-if="result.signalsResourceId" class="btn sm" data-test="explain-open-signals" @click="$emit('open-signals', result.signalsResourceId)"><i data-lucide="activity"></i> {{ t('kuapps.explain.openSignals', { name: result.signalsResourceId === result.source.id ? result.source.name : result.target.name }) }}</button>
          <p v-if="result.signals.syncedAt" class="kuapp-explain-muted">{{ t('kuapps.explain.synced', { date: new Date(result.signals.syncedAt).toLocaleString() }) }}</p>
        </section>

        <section v-if="result.advice.length">
          <h4>{{ t('kuapps.explain.advice') }}</h4>
          <ul class="kuapp-explain-list">
            <li v-for="item in result.advice" :key="item.id" :class="['kuapp-explain-advice', item.severity]">{{ t(item.key, item.params) }}</li>
          </ul>
        </section>

        <section>
          <h4>{{ t('kuapps.explain.decide') }}</h4>
          <p class="kuapp-explain-muted">{{ t(result.decision.accept) }}</p>
          <p class="kuapp-explain-muted">{{ t(result.decision.reject) }}</p>
        </section>
      </template>
    </div>
    <template #footer>
      <AgentBriefActions v-if="result" :build="buildBrief" :subject="`relationship-${result.source.name}-${result.target.name}`" />
      <button class="btn" @click="$emit('close')">{{ t('action.close') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import AgentBriefActions from '../advisor/AgentBriefActions.vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'

// "Why?" for a relationship or a suggestion (#172). The server builds it from the evidence,
// the cached log aggregates of the pair and the local embedding model: nothing leaves the computer.
const props = defineProps({
  applicationId: { type: String, default: '' },
  // { sourceResourceId, targetResourceId, sourceName, targetName, relationType, status, confidence, evidence }
  request: { type: Object, default: null },
})
defineEmits(['close', 'open-signals'])
const { t } = useI18n()
const result = ref(null)
const loading = ref(false)
const error = ref('')

// Relationship types read as words: "depends on", not "depends_on".
function relationLabel(type) {
  const key = `kuapps.explain.relation.${type}`
  const label = t(key)
  return label === key ? String(type || '').replace(/_/g, ' ') : label
}
const summaryParams = computed(() => result.value ? { ...result.value.summary.params, relationType: relationLabel(result.value.summary.params.relationType) } : {})

function rateLabel(signal) {
  if (!signal) return t('kuapps.explain.noLogs')
  if (signal.errorRatePercent == null) return t('kuapps.explain.noEvents')
  return t('kuapps.explain.errorRate', { rate: Math.round(signal.errorRatePercent * 10) / 10 })
}

// A self-contained Markdown task for an AI agent, in the app language, built from what is shown.
function buildBrief() {
  const value = result.value
  if (!value) return ''
  const lines = [
    `# ${t('kuapps.explain.title', { source: value.source.name, target: value.target.name })}`,
    '',
    t(value.summary.key, summaryParams.value),
    '',
    `## ${t('kuapps.explain.why')}`,
    ...value.evidence.map(item => `- [${t(`kuapps.explain.class.${item.class}`)}] ${t(item.key, item.params)}`),
    '',
    `## ${t('kuapps.explain.signals')}`,
    `- ${value.target.name}: ${rateLabel(value.signals.target)}`,
    `- ${value.source.name}: ${rateLabel(value.signals.source)}`,
    ...value.signals.mentions.map(item => `- \`${item.signature}\` × ${item.occurrences} (${item.match})`),
    '',
    `## ${t('kuapps.explain.advice')}`,
    ...value.advice.map(item => `- ${t(item.key, item.params)}`),
    '',
    t('kuapps.explain.briefTask'),
  ]
  return lines.join('\n')
}

async function load() {
  result.value = null
  error.value = ''
  if (!props.request || !props.applicationId) return
  loading.value = true
  try {
    result.value = await api('POST', `/api/kua-apps/applications/${encodeURIComponent(props.applicationId)}/relationships/explain`, props.request)
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

watch(() => props.request, load, { immediate: true })
</script>

<style scoped>
.kuapp-explain { display: grid; gap: 14px; max-height: 64vh; overflow: auto; }
.kuapp-explain section { display: grid; gap: 6px; }
.kuapp-explain h4 { margin: 0; color: var(--text-dim); font-size: 12px; letter-spacing: .05em; text-transform: uppercase; }
.kuapp-explain-summary { margin: 0; font-size: 13px; line-height: 1.5; }
.kuapp-explain-muted { margin: 0; color: var(--text-dim); font-size: 12px; }
.kuapp-explain-error { margin: 0; color: var(--red); }
.kuapp-explain-confidence { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.kuapp-explain-confidence strong { font-size: 18px; }
.kuapp-explain-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.kuapp-explain-list li { display: flex; gap: 8px; align-items: baseline; font-size: 12px; line-height: 1.45; }
.kuapp-explain-list code { font-size: 12px; overflow-wrap: anywhere; }
.kuapp-explain-class { flex: none; padding: 1px 7px; border: 1px solid currentColor; border-radius: 10px; font-size: 12px; white-space: nowrap; }
.kuapp-explain-class.declared { color: var(--green); }
.kuapp-explain-class.observed { color: var(--accent); }
.kuapp-explain-class.inferred { color: var(--yellow); }
.kuapp-explain-class.empty { opacity: .45; }
.kuapp-explain-signals { margin: 0; display: grid; gap: 4px; }
.kuapp-explain-signals > div { display: grid; grid-template-columns: minmax(120px, 30%) minmax(0, 1fr); gap: 8px; font-size: 12px; }
.kuapp-explain-signals dt { color: var(--text-dim); overflow-wrap: anywhere; }
.kuapp-explain-signals dd { margin: 0; }
.kuapp-explain-advice { padding-left: 8px; border-left: 3px solid var(--border); }
.kuapp-explain-advice.warning { border-left-color: var(--yellow); }
.kuapp-explain-advice.ok { border-left-color: var(--green); }
.kuapp-explain-advice.info { border-left-color: var(--accent); }
</style>
