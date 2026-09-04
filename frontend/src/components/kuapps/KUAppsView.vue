<template>
  <div class="kuapps-view">
    <div class="kuapps-tabs" role="tablist" aria-label="KUApps views">
      <button
        :class="['kuapps-tab', { active: activeView === 'architecture' }]"
        role="tab"
        :aria-selected="activeView === 'architecture'"
        @click="selectView('architecture')"
      >
        <i data-lucide="network"></i>
        <span><strong>Architecture</strong><small>Application resources and relationships</small></span>
      </button>
      <button
        :class="['kuapps-tab', { active: activeView === 'observability' }]"
        role="tab"
        :aria-selected="activeView === 'observability'"
        @click="selectView('observability')"
      >
        <i data-lucide="square-activity"></i>
        <span><strong>Observability</strong><small>Health, metrics and traces</small></span>
      </button>
    </div>

    <ArchitectureView
      v-if="activeView === 'architecture'"
      ref="architectureRef"
      :profile-id="profileId"
      :application-id="applicationId"
      :project-id="projectId"
      @open-observability="openObservability"
      @open-observability-setup="openObservabilitySetup"
      @application-context="forwardApplicationContext"
      @open-kubernetes-logs="$emit('open-kubernetes-logs', $event)"
      @open-kubernetes-detail="$emit('open-kubernetes-detail', $event)"
      @open-kubernetes-pods="$emit('open-kubernetes-pods', $event)"
      @open-aws-resource="$emit('open-aws-resource', $event)"
      @open-aws-logs="$emit('open-aws-logs', $event)"
    />

    <ApmObservabilityView
      v-else
      ref="observabilityRef"
      :provider="apmProvider"
      :profile-id="apmProfileId"
      :application-id="applicationId"
      :focus-resource="focusResource"
      @open-architecture="openArchitecture"
      @application-context="forwardApplicationContext"
      @open-kubernetes-logs="$emit('open-kubernetes-logs', $event)"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import ArchitectureView from '../architecture/ArchitectureView.vue'
import ApmObservabilityView from '../cloud/apm/ApmObservabilityView.vue'

const props = defineProps({
  activeView: { type: String, default: 'architecture' },
  profileId: { type: String, default: '' },
  projectId: { type: String, default: '' },
  applicationId: { type: String, default: '' },
  observabilityProvider: { type: String, default: 'generic' },
  observabilityProfileId: { type: String, default: 'local' },
  focusResource: { type: Object, default: null },
})
const emit = defineEmits([
  'update-view', 'open-observability', 'open-architecture', 'application-context',
  'open-kubernetes-logs', 'open-kubernetes-detail', 'open-kubernetes-pods',
  'open-aws-resource', 'open-aws-logs',
])

const architectureRef = ref(null)
const observabilityRef = ref(null)
const activeView = computed(() => props.activeView === 'observability' ? 'observability' : 'architecture')
const apmProvider = computed(() => ['aws', 'gcp', 'vercel', 'generic'].includes(props.observabilityProvider)
  ? props.observabilityProvider
  : 'generic')
const apmProfileId = computed(() => props.observabilityProfileId || (apmProvider.value === 'generic' ? 'local' : ''))

function selectView(view) {
  emit('update-view', view)
  nextTick(() => createIcons({ icons }))
}

function openObservability(application, focus = null) {
  emit('open-observability', application, focus)
  selectView('observability')
}

function openObservabilitySetup() {
  selectView('observability')
  nextTick(() => observabilityRef.value?.openSetup?.())
}

function openArchitecture(payload) {
  emit('open-architecture', payload)
  selectView('architecture')
}

function forwardApplicationContext(application) {
  emit('application-context', application)
}

async function reloadActiveTab(options = {}) {
  if (activeView.value === 'observability') return observabilityRef.value?.refreshLocal?.(options)
  return architectureRef.value?.refreshWorkspace?.(options)
}

watch(() => [props.activeView, props.observabilityProvider], () => nextTick(() => createIcons({ icons })))
onMounted(() => createIcons({ icons }))

defineExpose({ reloadActiveTab, openObservabilitySetup })
</script>

<style scoped>
.kuapps-view { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--bg); color: var(--text); }
.kuapps-tabs { display: flex; align-items: stretch; gap: 1px; padding: 8px 12px 0; border-bottom: 1px solid var(--border); background: var(--surface); }
.kuapps-tab { min-width: 190px; display: flex; align-items: center; gap: 9px; padding: 8px 12px 9px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-dim); text-align: left; cursor: pointer; }
.kuapps-tab:hover, .kuapps-tab.active { color: var(--text); background: var(--bg-hover); }
.kuapps-tab.active { border-bottom-color: var(--accent); }
.kuapps-tab > svg { width: 17px; color: var(--accent); }
.kuapps-tab span { display: flex; flex-direction: column; gap: 2px; }
.kuapps-tab small { color: var(--text-dim); font-size: 9px; }
.kuapps-view > :deep(.architecture-view), .kuapps-view > :deep(.apm-view) { flex: 1; min-height: 0; }
@media (max-width: 700px) { .kuapps-tabs { overflow-x: auto; }.kuapps-tab { min-width: 165px; } }
</style>
