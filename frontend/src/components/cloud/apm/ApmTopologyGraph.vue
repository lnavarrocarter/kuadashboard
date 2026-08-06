<template>
  <section class="apm-topology" :aria-label="t('apm.topologyLabel')">
    <div class="apm-topology-lane app-lane">
      <button class="apm-node application-node" type="button" @click="$emit('select', null)">
        <i data-lucide="boxes"></i>
        <span>
          <small>{{ t('apm.application') }}</small>
          <strong>{{ topology.application?.name || t('apm.application') }}</strong>
        </span>
      </button>
    </div>

    <div class="membership-line" aria-hidden="true"><span>{{ t('apm.belongsTo') }}</span></div>

    <div v-if="topology.resources?.length" class="apm-resource-grid">
      <button
        v-for="resource in topology.resources"
        :key="resource.id"
        :class="['apm-node', { selected: selectedResourceId === resource.id }]"
        type="button"
        @click="$emit('select', resource)"
      >
        <i :data-lucide="apmResourceIcon(resource.type)"></i>
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
})

defineEmits(['select'])
const { t } = useI18n()

const resolvedEdges = computed(() => {
  const names = Object.fromEntries((props.topology.resources || []).map(resource => [resource.id, resource.name]))
  return (props.topology.edges || []).map(edge => ({
    ...edge,
    source: names[edge.sourceResourceId] || edge.sourceResourceId,
    target: names[edge.targetResourceId] || edge.targetResourceId,
  }))
})

function renderIcons() {
  nextTick(() => createIcons({ icons }))
}

watch(() => props.topology, renderIcons, { deep: true })
onMounted(renderIcons)
</script>

<style scoped>
.apm-topology { display: flex; flex-direction: column; min-height: 320px; padding: 18px; background: var(--bg-row); border: 1px solid var(--border); border-radius: 8px; }
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
.dependency-empty, .apm-topology-empty { color: var(--text-dim); font-size: 10px; text-align: center; padding: 20px; }
@media (max-width: 680px) { .apm-resource-grid { grid-template-columns: 1fr; } }
</style>