<template>
  <section :class="['apm-topology', { 'review-only': reviewOnly }]" :aria-label="t('apm.topologyLabel')">
    <div v-if="!reviewOnly" class="apm-topology-lane app-lane">
      <button class="apm-node application-node" type="button" @click="$emit('select', null)">
        <i data-lucide="boxes"></i>
        <span>
          <small>{{ t('apm.application') }}</small>
          <strong>{{ topology.application?.name || t('apm.application') }}</strong>
        </span>
      </button>
    </div>

    <div v-if="!reviewOnly" class="membership-line" aria-hidden="true"><span>{{ t('apm.belongsTo') }}</span></div>

    <section v-if="topology.analysis && reviewPart !== 'decisions'" class="topology-intelligence">
      <div class="analysis-score">
        <span>{{ t('apm.topologyScore') }}</span>
        <strong>{{ topology.analysis.score }}</strong>
        <small>{{ t('apm.topologyCoverage', { coverage: topology.analysis.coveragePercent }) }}</small>
      </div>
      <div class="analysis-copy">
        <div class="analysis-heading">
          <span><i data-lucide="brain-circuit"></i> {{ t('apm.topologyIntelligence') }}</span>
          <button v-if="canAnalyzeCloud" class="btn sm" type="button" :disabled="analyzingCloud" @click="$emit('analyze-cloud')">
            <i :data-lucide="analyzingCloud ? 'loader-2' : 'scan-search'"></i>
            {{ analyzingCloud ? t('apm.analyzingCloudTopology') : t('apm.analyzeCloudTopology') }}
          </button>
        </div>
        <div v-if="topology.analysis.findings?.length" class="finding-list">
          <span v-for="finding in topology.analysis.findings" :key="finding.code" :class="['finding', finding.severity]">
            {{ t(`apm.analysis.${finding.code}`, { count: finding.resourceIds?.length || topology.analysis.counts.suggestions }) }}
          </span>
        </div>
        <p v-else>{{ t('apm.analysisHealthy') }}</p>
        <p v-if="topology.analysis.cloudScan" class="cloud-scan-summary">
          {{ t('apm.cloudScanSummary', { requests: topology.analysis.cloudScan.requests, unresolved: topology.analysis.cloudScan.unresolvedReferences.length }) }}
        </p>
      </div>
    </section>

    <section v-if="!reviewOnly && logs && (logs.signals.length || logs.uncachedResourceIds.length || logs.unavailableScopeResourceIds?.length)" class="log-intelligence">
      <div class="dependency-title"><i data-lucide="scroll-text"></i> {{ t('apm.logs.title') }}</div>
      <div v-for="signal in logs.signals" :key="signal.resourceId + signal.logGroup" class="log-signal">
        <div class="log-signal-head">
          <strong>{{ signal.resourceName }}</strong>
          <small>{{ signal.logGroup }}</small>
          <span :class="['log-rate', { high: signal.errorRateHigh }]">
            {{ signal.last24h?.errorRatePercent == null ? t('apm.logs.noEvents') : t('apm.logs.errorRate', { rate: signal.last24h.errorRatePercent, errors: signal.last24h.errors, events: signal.last24h.events }) }}
          </span>
          <button v-if="resourceType(signal.resourceId) === 'lambda'" class="btn sm" type="button" @click="$emit('open-lambda-logs', signal.resourceName)">
            <i data-lucide="file-search"></i> {{ t('apm.openLogs') }}
          </button>
          <button v-else-if="resourceType(signal.resourceId) === 'kubernetes'" class="btn sm" type="button" @click="$emit('open-kubernetes-logs', resourceById(signal.resourceId))">
            <i data-lucide="scroll-text"></i> {{ t('apm.openLogs') }}
          </button>
        </div>
        <div v-if="Object.keys(signal.severeKeywords).length" class="log-keywords">
          <span v-for="(count, keyword) in signal.severeKeywords" :key="keyword" class="finding warning">{{ t(`apm.logs.keyword_${keyword}`) }} × {{ count }}</span>
        </div>
        <div v-if="signal.topCategories?.length" class="log-keywords">
          <span v-for="item in signal.topCategories" :key="item.category" class="finding info">{{ t(`awsLogs.cat.${item.category}`) }} × {{ item.count }}</span>
        </div>
        <ul v-if="signal.recommendations?.length" class="log-recommendations">
          <li v-for="rec in signal.recommendations" :key="rec.id" :class="rec.severity">
            <i data-lucide="lightbulb"></i> {{ t(`awsLogs.rec.${rec.id}.title`, rec.params) }}
          </li>
        </ul>
        <ul v-if="signal.recurringErrors.length" class="log-signatures">
          <li v-for="item in signal.recurringErrors" :key="item.signature" :title="item.sample">
            <code>{{ item.signature }}</code> <small>× {{ item.occurrences }}</small>
          </li>
        </ul>
        <small class="log-freshness">{{ t('apm.logs.freshness', { synced: formatAge(signal.lastSyncAt), last: formatAge(signal.lastEventAt) }) }}</small>
      </div>
      <details v-if="logs.uncachedResourceIds.length" class="analysis-disclaimer resource-coverage">
        <summary>{{ t('apm.logs.uncached', { count: logs.uncachedResourceIds.length }) }}</summary>
        <ul class="resource-coverage-list">
          <li v-for="resourceId in logs.uncachedResourceIds" :key="resourceId">{{ resourceName(resourceId) }}</li>
        </ul>
      </details>
      <details v-if="logs.unavailableScopeResourceIds?.length" class="analysis-disclaimer resource-coverage">
        <summary>{{ t('apm.logs.scopeUnavailable', { count: logs.unavailableScopeResourceIds.length }) }}</summary>
        <ul class="resource-coverage-list">
          <li v-for="resourceId in logs.unavailableScopeResourceIds" :key="resourceId">{{ resourceName(resourceId) }}</li>
        </ul>
      </details>
      <div v-if="logs.unresolvedReferences?.length" class="log-unresolved">
        <small>{{ t('apm.logs.referencedOutside') }}</small>
        <span v-for="ref in logs.unresolvedReferences" :key="`${ref.type}:${ref.name}`" class="finding info" :title="ref.target">
          {{ ref.type }}: {{ ref.name }} · {{ t('apm.logs.seenIn', { names: ref.seenIn.join(', '), count: ref.occurrences }) }}
        </span>
      </div>
    </section>

    <template v-if="!reviewOnly">
    <div v-if="topology.resources?.length" class="apm-resource-grid">
      <button
        v-for="resource in topology.resources"
        :key="resource.id"
        :class="['apm-node', { selected: selectedResourceId === resource.id }]"
        type="button"
        @click="$emit('select', resource)"
      >
        <i :data-lucide="apmResourceIcon(resource)"></i>
        <span>
          <small>{{ apmResourceLabel(resource) }}</small>
          <strong>{{ resource.name }}</strong>
          <em>{{ apmResourceLocation(resource) }}</em>
        </span>
        <span :class="['node-state', resource.enabled ? 'enabled' : 'disabled']">
          {{ resource.enabled ? t('apm.enabled') : t('apm.paused') }}
        </span>
      </button>
    </div>
    <div v-else class="apm-topology-empty">{{ t('apm.noResources') }}</div>

    <div v-if="topology.edges?.length" class="dependency-list">
      <div class="dependency-title"><i data-lucide="git-branch"></i> {{ t('apm.confirmedDependencies') }}</div>
      <div v-for="edge in resolvedEdges" :key="edge.id" class="dependency-row">
        <span>{{ edge.source }}</span>
        <i data-lucide="arrow-right"></i>
        <span>{{ edge.target }}</span>
      </div>
    </div>
    <div v-else class="dependency-empty">
      {{ t('apm.noDependencies') }}
    </div>
    </template>

    <div v-if="resolvedSuggestions.length && reviewPart !== 'findings'" class="suggestion-list">
      <div class="suggestion-heading">
        <div class="dependency-title"><i data-lucide="sparkles"></i> {{ t('apm.suggestedDependencies') }}</div>
        <button class="btn sm" type="button" :disabled="confirmingSuggestions" @click="$emit('confirm-all-dependencies', resolvedSuggestions)">
          <i :data-lucide="confirmingSuggestions ? 'loader-2' : 'check-check'"></i>
          {{ confirmingSuggestions ? t('apm.confirmingDependencies') : t('apm.confirmAllDependencies') }}
        </button>
      </div>
      <div v-for="edge in resolvedSuggestions" :key="`${edge.sourceResourceId}:${edge.targetResourceId}`" class="suggestion-row">
        <div class="suggestion-path">
          <strong>{{ edge.source }}</strong><i data-lucide="arrow-right"></i><strong>{{ edge.target }}</strong>
          <small>{{ t('apm.confidence', { confidence: Math.round(edge.confidence * 100) }) }} · {{ evidenceLabel(edge) }}</small>
        </div>
        <span class="suggestion-actions">
          <button v-if="reviewOnly" class="btn sm" type="button" data-test="explain-suggestion" @click="$emit('explain', edge)">
            <i data-lucide="circle-help"></i> {{ t('kuapps.explain.button') }}
          </button>
          <button class="btn sm" type="button" :disabled="confirmingSuggestions" @click="$emit('confirm-dependency', edge)">
            <i data-lucide="check"></i> {{ t('apm.confirmDependency') }}
          </button>
        </span>
      </div>
      <p class="analysis-disclaimer">{{ t('apm.analysisDisclaimer') }}</p>
    </div>

    <div v-if="unresolvedReferences.length && reviewPart !== 'findings'" class="unresolved-list">
      <div class="dependency-title"><i data-lucide="package-plus"></i> {{ t('apm.referencedResources') }}</div>
      <div v-for="reference in unresolvedReferences" :key="`${reference.type}:${reference.name}`" class="unresolved-row">
        <div>
          <strong>{{ reference.name }}</strong>
          <small>{{ reference.type }} · {{ t('apm.aslStatesCount', { count: reference.states.length }) }}</small>
        </div>
        <button class="btn sm" type="button" @click="$emit('add-cloud-resource', reference)">
          <i data-lucide="plus"></i> {{ t('apm.addToApplication') }}
        </button>
      </div>
      <p class="analysis-disclaimer">{{ t('apm.referencedResourcesHint') }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../../../composables/useI18n'
import { apmResourceIcon, apmResourceLabel, apmResourceLocation } from './resourcePresentation'

const props = defineProps({
  topology: { type: Object, default: () => ({ application: null, resources: [], edges: [] }) },
  selectedResourceId: { type: String, default: '' },
  canAnalyzeCloud: { type: Boolean, default: false },
  analyzingCloud: { type: Boolean, default: false },
  confirmingSuggestions: { type: Boolean, default: false },
  // Only what needs a decision: structure analysis, suggestions and unresolved references.
  reviewOnly: { type: Boolean, default: false },
  // In Review: 'decisions' (suggestions and references to add) or 'findings' (structure); '' both.
  reviewPart: { type: String, default: '' },
})

defineEmits(['select', 'confirm-dependency', 'confirm-all-dependencies', 'analyze-cloud', 'add-cloud-resource', 'open-lambda-logs', 'open-kubernetes-logs', 'explain'])
const { t } = useI18n()

const resolvedEdges = computed(() => {
  const names = Object.fromEntries((props.topology.resources || []).map(resource => [resource.id, resource.name]))
  return (props.topology.edges || []).map(edge => ({
    ...edge,
    source: names[edge.sourceResourceId] || edge.sourceResourceId,
    target: names[edge.targetResourceId] || edge.targetResourceId,
  }))
})

const resolvedSuggestions = computed(() => {
  const names = Object.fromEntries((props.topology.resources || []).map(resource => [resource.id, resource.name]))
  return (props.topology.analysis?.suggestions || []).map(edge => ({
    ...edge,
    source: names[edge.sourceResourceId] || edge.sourceResourceId,
    target: names[edge.targetResourceId] || edge.targetResourceId,
  }))
})

const unresolvedReferences = computed(() => {
  const grouped = new Map()
  for (const reference of props.topology.analysis?.cloudScan?.unresolvedReferences || []) {
    const key = `${reference.type}:${reference.name}`
    const current = grouped.get(key) || { ...reference, states: [] }
    if (!current.states.includes(reference.statePath)) current.states.push(reference.statePath)
    grouped.set(key, current)
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name))
})

// Observed evidence from cached log groups (lib/logIntelligenceEvidence.js).
const logs = computed(() => props.topology.analysis?.logs || null)

function resourceById(id) {
  return (props.topology.resources || []).find(resource => resource.id === id)
}
function resourceName(id) { return resourceById(id)?.name || id }
function resourceType(id) { return resourceById(id)?.type || '' }

function formatAge(timestamp) {
  if (!timestamp) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000))
  if (minutes < 60) return t('apm.logs.minutesAgo', { n: minutes })
  const hours = Math.round(minutes / 60)
  return hours < 48 ? t('apm.logs.hoursAgo', { n: hours }) : t('apm.logs.daysAgo', { n: Math.round(hours / 24) })
}

function evidenceLabel(edge) {
  return (edge.evidence || []).map(item => {
    if (item.type === 'observed_log_reference') return t('apm.evidenceLog', { group: item.values[0], count: item.values[2] })
    if (item.type === 'asl_reference') return t('apm.evidenceAsl', { state: item.values[0], resource: item.values[1] })
    if (item.type === 'shared_name_tokens') return t('apm.evidenceName', { values: item.values.join(', ') })
    if (item.type === 'same_kubernetes_scope') return t('apm.evidenceScope', { values: item.values.join(', ') })
    return t('apm.evidenceTypes')
  }).join(' · ')
}

function renderIcons() {
  nextTick(() => createIcons({ icons }))
}

watch(() => props.topology, renderIcons, { deep: true })
onMounted(renderIcons)
</script>

<style scoped>
.apm-topology { display: flex; flex-direction: column; min-height: 320px; padding: 18px; background: var(--bg-row); border: 1px solid var(--border); border-radius: 8px; }
.apm-topology.review-only { min-height: 0; }
.apm-topology-lane { display: flex; justify-content: center; }
.apm-node { min-width: 0; min-height: 74px; display: flex; align-items: center; gap: 10px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--text); padding: 10px 12px; text-align: left; cursor: pointer; }
.apm-node:hover, .apm-node.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); }
.apm-node > svg { width: 20px; height: 20px; color: #58a6ff; flex: 0 0 auto; }
.apm-node span:not(.node-state) { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.apm-node small { color: var(--text-dim); font-size: 9px; text-transform: uppercase; }
.apm-node strong, .apm-node em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.apm-node strong { font-size: 12px; }
.apm-node em { max-width: 250px; color: var(--text-dim); font-size: 9px; font-style: normal; }
.application-node { min-width: min(320px, 100%); border-color: rgba(63, 185, 80, .5); }
.application-node > svg { color: #3fb950; }
.membership-line { height: 48px; display: flex; justify-content: center; align-items: center; color: var(--text-dim); font-size: 9px; text-transform: uppercase; }
.membership-line::before, .membership-line::after { content: ''; width: 1px; height: 15px; background: var(--border); }
.membership-line { flex-direction: column; gap: 2px; }
.topology-intelligence { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 14px; align-items: stretch; margin-bottom: 16px; padding: 12px; border: 1px solid color-mix(in srgb, #58a6ff 45%, var(--border)); background: color-mix(in srgb, #58a6ff 5%, var(--surface)); border-radius: 7px; }
.analysis-score { display: flex; flex-direction: column; justify-content: center; align-items: center; border-right: 1px solid var(--border); }
.analysis-score span, .analysis-score small { color: var(--text-dim); font-size: 9px; }
.analysis-score strong { font-size: 28px; color: #58a6ff; line-height: 1.1; }
.analysis-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 7px; }
.analysis-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10px; text-transform: uppercase; color: var(--text-dim); }
.analysis-heading span, .analysis-heading button { display: flex; align-items: center; gap: 6px; }
.analysis-heading svg { width: 14px; height: 14px; color: #58a6ff; }
.analysis-heading button { text-transform: none; }
.cloud-scan-summary { color: #58a6ff !important; }
.analysis-copy p, .analysis-disclaimer { margin: 0; color: var(--text-dim); font-size: 10px; }
.resource-coverage { min-width: 0; padding-top: 5px; border-top: 1px solid var(--border); }
.resource-coverage summary { cursor: pointer; line-height: 1.4; }
.resource-coverage-list { max-height: 130px; overflow: auto; overflow-wrap: anywhere; margin: 5px 0 0; padding: 0 8px 0 20px; }
.resource-coverage-list li { padding: 2px 0; }
.finding-list { display: flex; flex-wrap: wrap; gap: 5px; }
.finding { padding: 3px 6px; border: 1px solid var(--border); border-radius: 4px; font-size: 9px; }
.finding.critical { color: #f85149; border-color: color-mix(in srgb, #f85149 45%, var(--border)); }
.finding.warning { color: #d29922; border-color: color-mix(in srgb, #d29922 45%, var(--border)); }
.finding.info { color: #58a6ff; }
.apm-resource-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.node-state { margin-left: auto; align-self: flex-start; font-size: 9px; }
.node-state.enabled { color: #3fb950; }
.node-state.disabled { color: var(--text-dim); }
.dependency-list { margin-top: 20px; border-top: 1px solid var(--border); padding-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.dependency-title { display: flex; align-items: center; gap: 6px; color: var(--text-dim); font-size: 10px; text-transform: uppercase; }
.dependency-title svg, .dependency-row svg { width: 13px; height: 13px; }
.dependency-row { display: grid; grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr); align-items: center; gap: 8px; font-size: 11px; }
.dependency-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dependency-row svg { color: #d29922; }
.log-intelligence { margin-top: 14px; padding: 12px; border: 1px solid var(--border); border-radius: 7px; display: flex; flex-direction: column; gap: 10px; }
.log-signal { display: flex; flex-direction: column; gap: 5px; padding-bottom: 8px; border-bottom: 1px dashed var(--border); }
.log-signal:last-of-type { border-bottom: 0; }
.log-signal-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 12px; }
.log-signal-head small { color: var(--text-dim); font-family: monospace; }
.log-signal-head .btn { margin-left: auto; }
.log-rate { font-size: 11px; color: var(--text-dim); }
.log-rate.high { color: var(--red); font-weight: 600; }
.log-keywords, .log-unresolved { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.log-signatures { margin: 0; padding-left: 16px; font-size: 11px; display: flex; flex-direction: column; gap: 2px; }
.log-signatures code { overflow-wrap: anywhere; }
.log-recommendations { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.log-recommendations li { display: flex; gap: 5px; align-items: center; }
.log-recommendations li.high { color: var(--red); }
.log-recommendations li.medium { color: #d29922; }
.log-recommendations svg { width: 12px; height: 12px; flex: none; }
.log-freshness { font-size: 10px; color: var(--text-dim); }
.suggestion-list { margin-top: 14px; padding: 12px; border: 1px dashed color-mix(in srgb, #58a6ff 45%, var(--border)); display: flex; flex-direction: column; gap: 8px; }
.suggestion-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.suggestion-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.suggestion-actions { display: flex; gap: 6px; flex: none; }
.suggestion-path { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr); align-items: center; gap: 5px; font-size: 10px; }
.suggestion-path strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.suggestion-path svg { width: 12px; height: 12px; color: #58a6ff; }
.suggestion-path small { grid-column: 1 / -1; color: var(--text-dim); }
.analysis-disclaimer { padding-top: 4px; border-top: 1px solid var(--border); }
.unresolved-list { margin-top: 14px; padding: 12px; border: 1px solid var(--border); display: flex; flex-direction: column; gap: 7px; }
.unresolved-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.unresolved-row > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.unresolved-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.unresolved-row small { color: var(--text-dim); font-size: 9px; }
.dependency-empty, .apm-topology-empty { color: var(--text-dim); font-size: 10px; text-align: center; padding: 20px; }
@media (max-width: 680px) { .apm-resource-grid { grid-template-columns: 1fr; } .topology-intelligence { grid-template-columns: 1fr; } .analysis-score { border-right: 0; border-bottom: 1px solid var(--border); padding-bottom: 9px; } .suggestion-row, .unresolved-row { align-items: stretch; flex-direction: column; } }
</style>