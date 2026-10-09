<template>
  <div class="kri" data-test="resource-inspector">
    <header class="kri-head">
      <div><span class="kri-kicker">{{ t('kuapps.resourceInspector') }}</span><h3>{{ resource.displayName }}</h3></div>
      <button class="btn btn-icon" :title="t('action.close')" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>
    <div class="kri-tabs" role="tablist" :aria-label="t('kuapps.resourceInspector')" @keydown="onTabKey">
      <button
        v-for="item in TABS" :key="item" :ref="element => (tabButtons[item] = element)"
        role="tab" :class="{ active: tab === item }" :aria-selected="tab === item" :tabindex="tab === item ? 0 : -1"
        :data-test="`inspector-tab-${item}`" @click="tab = item"
      >{{ t(`kuapps.inspector.${item}`) }}</button>
    </div>

    <template v-if="tab === 'detail'">
      <dl class="kri-detail">
        <div><dt>{{ t('kuapps.provider') }}</dt><dd>{{ resource.provider }}</dd></div>
        <div><dt>{{ t('kuapps.type') }}</dt><dd>{{ resource.resourceType }}</dd></div>
        <div><dt>{{ t('kuapps.scope') }}</dt><dd>{{ resource.scopeId || t('kuapps.scopeUnknown') }}</dd></div>
        <div><dt>{{ t('kuapps.location') }}</dt><dd>{{ resource.location || t('kuapps.scopeUnknown') }}</dd></div>
        <template v-if="resource.provider === 'kubernetes'">
          <div><dt>{{ t('kuapps.sync.namespace') }}</dt><dd>{{ resource.namespace || t('kuapps.sync.clusterScope') }}</dd></div>
          <div><dt>{{ t('kuapps.sync.context') }}</dt><dd>{{ resource.kubeContext || t('kuapps.sync.contextUnknown') }}</dd></div>
        </template>
        <div v-if="resource.sources?.length"><dt>{{ t('kuapps.sources') }}</dt><dd class="kri-sources"><span v-for="source in resource.sources" :key="source">{{ t(`kuapps.source.${source}`, source) }}</span></dd></div>
        <div data-test="inspector-signal-state"><dt>{{ t('kuapps.signalState.title') }}</dt><dd><span :class="['kri-state', state]">{{ t(`kuapps.signalState.${state}`) }}</span> <small>{{ t(`kuapps.signalState.${state}.hint`) }}</small><small v-if="resource.signals?.lastDataAt"> · {{ t('kuapps.signalState.lastData', { when: new Date(resource.signals.lastDataAt).toLocaleString() }) }}</small></dd></div>
      </dl>
      <div class="kri-identity"><small>{{ t('kuapps.identity') }}</small><code>{{ resource.nativeIdentifier || t('kuapps.scopeUnknown') }}</code></div>
      <!-- Concrete next steps: never promise signals for a type KUA does not collect. -->
      <div class="kri-actions">
        <button v-if="context !== 'map'" class="btn sm" data-test="inspector-open-map" @click="$emit('open-map', resource.id)"><i data-lucide="network"></i>{{ t('kuapps.inspector.openMap') }}</button>
        <button v-if="state === 'no_connection'" class="btn sm primary" data-test="inspector-bind" @click="$emit('bind-scope')"><i data-lucide="key-round"></i>{{ t('kuapps.issue.action.bind_scope') }}</button>
        <button v-else-if="state === 'gone'" class="btn sm primary" @click="$emit('review-missing')">{{ t('kuapps.issue.action.review_missing') }}</button>
        <button v-else-if="signalsAvailable && state !== 'unsupported'" class="btn sm primary" data-test="inspector-open-signals" @click="tab = 'signals'"><i data-lucide="activity"></i>{{ t('kuapps.issue.action.open_signals') }}</button>
      </div>
    </template>

    <template v-else-if="tab === 'signals'">
      <KUAppResourceSignals
        v-if="signalsAvailable"
        :application-id="applicationId"
        :registry-id="resource.id"
        :collection="collection"
        :hours="hours"
        compact
        @retry="$emit('retry', resource.id)"
        @open-kubernetes-logs="item => $emit('open-kubernetes-logs', item)"
      />
      <p v-else class="kri-dim">{{ t('kuapps.signalsStatus.pending') }}</p>
    </template>

    <div v-else class="kri-relationships">
      <p v-if="!relationships.length" class="kri-dim">{{ t('kuapps.inspector.noRelationships') }}</p>
      <button v-for="relationship in relationships" :key="relationship.id" class="kri-relationship" @click="$emit('select-resource', relationship.otherId)">
        <span>{{ relationship.outgoing ? '→' : '←' }} <strong>{{ relationship.otherName }}</strong></span>
        <small>{{ relationLabel(relationship.relationType) }} · {{ t(`apm.relationshipStatus.${relationship.status}`) }}</small>
        <span class="kri-why" role="button" tabindex="0" @click.stop="$emit('explain', relationship)" @keydown.enter.stop="$emit('explain', relationship)">{{ t('kuapps.explain.button') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import KUAppResourceSignals from './KUAppResourceSignals.vue'

// One resource inspector for Resources and the Map (#239): the same detail, signals and
// relationships, and the selection is kept when moving between them.
const props = defineProps({
  applicationId: { type: String, required: true },
  resource: { type: Object, required: true },
  relationships: { type: Array, default: () => [] },
  signalsAvailable: { type: Boolean, default: false },
  collection: { type: Object, default: () => ({ provider: 'generic', profileId: 'local' }) },
  hours: { type: Number, default: 24 },
  context: { type: String, default: 'resources' },
  initialTab: { type: String, default: 'detail' },
})
defineEmits(['close', 'select-resource', 'explain', 'open-map', 'retry', 'bind-scope', 'review-missing', 'open-kubernetes-logs'])

const TABS = ['detail', 'signals', 'relationships']
const STATES = new Set(['unsupported', 'gone', 'no_connection', 'disabled', 'error', 'no_data', 'stale', 'partial', 'current'])
const { t } = useI18n()
const tab = ref(TABS.includes(props.initialTab) ? props.initialTab : 'detail')
const tabButtons = {}
const state = computed(() => (STATES.has(props.resource.signals?.state) ? props.resource.signals.state : 'unknown'))
// Internal relation ids read as words; an unknown one keeps its id.
const relationLabel = type => {
  const key = `kuapps.relation.${type}`
  const label = t(key)
  return label === key ? String(type || '').replace(/_/g, ' ') : label
}

// Arrow keys move between tabs, as a tablist should.
function onTabKey(event) {
  const index = TABS.indexOf(tab.value)
  const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
    : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
  if (next < 0) return
  event.preventDefault()
  tab.value = TABS[next]
  nextTick(() => tabButtons[tab.value]?.focus())
}

watch(() => props.initialTab, value => { if (TABS.includes(value)) tab.value = value })
</script>

<style scoped>
.kri { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.kri-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.kri-head h3 { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.kri-kicker { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim); }
.kri-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
.kri-tabs button { padding: 6px 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer; font-size: 13px; }
.kri-tabs button.active { color: var(--text); border-bottom-color: var(--accent); }
.kri-detail { display: flex; flex-direction: column; gap: 6px; margin: 0; font-size: 13px; }
.kri-detail > div { display: grid; grid-template-columns: minmax(90px, 35%) minmax(0, 1fr); gap: 8px; }
.kri-detail dt { color: var(--text-dim); }
.kri-detail dd { margin: 0; overflow-wrap: anywhere; }
.kri-detail small { color: var(--text-dim); font-size: 12px; }
.kri-sources { display: flex; flex-wrap: wrap; gap: 4px; }
.kri-sources span { font-size: 12px; padding: 0 6px; border: 1px solid var(--border); border-radius: 999px; }
.kri-state { font-size: 12px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-dim); }
.kri-state.current { color: var(--success, #16a34a); border-color: currentColor; }
.kri-state.stale, .kri-state.partial, .kri-state.no_connection { color: var(--warning, #d97706); border-color: currentColor; }
.kri-state.gone, .kri-state.error { color: var(--danger, #dc2626); border-color: currentColor; }
.kri-identity { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.kri-identity small { color: var(--text-dim); }
.kri-identity code { overflow-wrap: anywhere; }
.kri-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.kri-actions .btn svg { width: 14px; height: 14px; margin-right: 4px; vertical-align: -2px; }
.kri-relationships { display: flex; flex-direction: column; gap: 4px; }
.kri-relationship { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 13px; }
.kri-relationship small { color: var(--text-dim); font-size: 12px; }
.kri-why { font-size: 12px; color: var(--accent); cursor: pointer; }
.kri-dim { margin: 0; font-size: 12px; color: var(--text-dim); }
</style>
