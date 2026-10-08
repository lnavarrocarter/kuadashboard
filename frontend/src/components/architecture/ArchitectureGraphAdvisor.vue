<template>
  <details class="graph-advisor" data-test="architecture-graph-advisor" :open="recommendations.length > 0">
    <summary>
      <i data-lucide="brain-circuit"></i>
      <span><strong>{{ t('archGraphAdvisor.title') }}</strong><small>{{ t('archGraphAdvisor.subtitle') }}</small></span>
      <b>{{ recommendations.length }}</b>
    </summary>
    <div v-if="recommendations.length" class="graph-advisor-list">
      <article v-for="item in recommendations" :key="item.id" class="graph-advisor-item">
        <i :data-lucide="iconFor(item.type)"></i>
        <span class="graph-advisor-copy">
          <strong>{{ titleFor(item) }}</strong>
          <small>{{ detailFor(item) }}</small>
          <small v-if="item.type === 'relationship'" class="graph-advisor-evidence">{{ item.reason }}</small>
        </span>
        <button class="btn sm" :class="{ primary: item.type === 'relationship' || item.type === 'aggregate', danger: item.type === 'remove' }" :disabled="saving" @click="apply(item)">
          <i :data-lucide="item.type === 'deduplicate' ? 'git-merge' : item.type === 'remove' ? 'trash-2' : item.type === 'aggregate' ? 'layers-3' : 'git-branch'"></i>
          {{ actionFor(item) }}
        </button>
      </article>
    </div>
    <p v-else class="graph-advisor-empty">{{ t('archGraphAdvisor.empty') }}</p>
  </details>
</template>

<script setup>
import { computed, nextTick, onMounted, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../../composables/useI18n'
import { architectureGraphRecommendations } from '../../lib/architectureGraphAdvisor'

const props = defineProps({ graph: { type: Object, required: true }, saving: { type: Boolean, default: false } })
const emit = defineEmits(['operation'])
const { t } = useI18n()
const recommendations = computed(() => architectureGraphRecommendations(props.graph))

function titleFor(item) {
  if (item.type === 'relationship') return t('archGraphAdvisor.relationshipTitle')
  if (item.type === 'deduplicate') return t('archGraphAdvisor.mergeTitle')
  if (item.type === 'remove') return t('archGraphAdvisor.removeTitle')
  return t('archGraphAdvisor.aggregateTitle')
}

function detailFor(item) {
  if (item.type === 'relationship') return `${item.source.name} → ${item.target.name}`
  if (item.type === 'deduplicate') return t('archGraphAdvisor.mergeDetail', { target: item.target.name, sources: item.sources.map(node => node.name).join(', ') })
  if (item.type === 'remove') return t('archGraphAdvisor.removeDetail', { name: item.node.name })
  return t('archGraphAdvisor.aggregateDetail', { n: item.count })
}

function actionFor(item) { return t(`archGraphAdvisor.action.${item.type}`) }

function iconFor(type) {
  return ({ relationship: 'git-branch', deduplicate: 'git-merge', remove: 'trash-2', aggregate: 'layers-3' })[type] || 'sparkles'
}

function apply(item) {
  if (item.type === 'deduplicate' && !globalThis.confirm(t('archGraphAdvisor.confirmMerge', { n: item.sources.length }))) return
  if (item.type === 'remove' && !globalThis.confirm(t('archGraphAdvisor.confirmRemove', { name: item.node.name }))) return
  const reason = item.type === 'relationship'
    ? t('archGraphAdvisor.reasonRelationship', { source: item.source.name, target: item.target.name })
    : item.type === 'deduplicate'
      ? t('archGraphAdvisor.reasonMerge', { name: item.target.name })
      : item.type === 'remove'
        ? t('archGraphAdvisor.reasonRemove', { name: item.node.name })
        : t('archGraphAdvisor.reasonAggregate')
  emit('operation', item.operation, reason)
  nextTick(() => createIcons({ icons }))
}

function refreshIcons() { nextTick(() => createIcons({ icons })) }
watch(recommendations, refreshIcons)
onMounted(refreshIcons)
</script>

<style scoped>
.graph-advisor { margin: 0 0 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); }
.graph-advisor > summary { min-height: 52px; padding: 8px 12px; display: flex; align-items: center; gap: 9px; cursor: pointer; list-style: none; }
.graph-advisor > summary::-webkit-details-marker { display: none; }
.graph-advisor > summary > i { color: var(--accent, #d29922); }
.graph-advisor > summary > span, .graph-advisor-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.graph-advisor > summary small, .graph-advisor-copy small, .graph-advisor-empty { color: var(--text-dim); }
.graph-advisor > summary > b { margin-left: auto; min-width: 24px; padding: 2px 6px; color: var(--text); text-align: center; background: var(--bg-hover); border-radius: 4px; }
.graph-advisor-list { border-top: 1px solid var(--border); }
.graph-advisor-item { min-height: 58px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.graph-advisor-item:last-child { border-bottom: 0; }
.graph-advisor-item > i { flex: none; color: var(--text-dim); }
.graph-advisor-copy { flex: 1; overflow-wrap: anywhere; }
.graph-advisor-evidence { font-size: 10px; }
.graph-advisor-empty { margin: 0; padding: 12px; }
@media (max-width: 620px) { .graph-advisor-item { align-items: flex-start; flex-wrap: wrap; }.graph-advisor-copy { flex-basis: calc(100% - 28px); }.graph-advisor-item > .btn { margin-left: 28px; } }
</style>