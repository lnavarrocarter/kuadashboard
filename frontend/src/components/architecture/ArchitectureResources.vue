<template>
  <section class="architecture-resources">
    <header class="resources-header">
      <span class="resources-title">
        <span class="resources-title-icon"><i data-lucide="database"></i></span>
        <span><strong>Canonical resources</strong><small>Shared registry — provider identity, sources and relationships</small></span>
      </span>
      <span class="resources-actions">
        <button class="btn sm btn-icon" title="Refresh resources" :disabled="loading" @click="$emit('refresh')"><i data-lucide="refresh-cw"></i></button>
        <span class="resources-count"><strong>{{ resources.length }}</strong> resource{{ resources.length === 1 ? '' : 's' }}</span>
      </span>
    </header>

    <div v-if="loading" class="resources-empty">Loading canonical resources...</div>
    <div v-else-if="!resources.length" class="resources-empty">
      <i data-lucide="database-zap"></i>
      <strong>No canonical resources yet</strong>
      <span>Resources appear once APM or Architecture discovery confirms membership for this application.</span>
    </div>

    <table v-else class="resources-table">
      <thead>
        <tr>
          <th>Resource</th>
          <th>Type</th>
          <th>Scope / Location</th>
          <th>Sources</th>
          <th>Status</th>
          <th>Relations</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="resource in resources" :key="resource.id">
          <td class="resource-name-cell"><strong>{{ resource.displayName }}</strong><small>{{ resource.provider.toUpperCase() }}</small></td>
          <td>{{ resource.resourceType }}</td>
          <td>{{ scopeLabel(resource) }}</td>
          <td class="resource-sources-cell">
            <span v-for="source in resource.sources" :key="source" :class="['resource-source-badge', source]">{{ sourceLabel(source) }}</span>
            <span v-if="resource.sources.length < 2" class="resource-divergence" title="Confirmed from only one side (APM or Architecture)">
              <i data-lucide="alert-triangle"></i> Single source
            </span>
          </td>
          <td><span :class="['resource-status', statusFor(resource).status]">{{ statusFor(resource).label }}</span></td>
          <td>{{ relationshipCount(resource.id) }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  graph: { type: Object, default: null },
  registry: { type: Object, default: null },
  loading: { type: Boolean, default: false },
})
defineEmits(['refresh'])

const resources = computed(() => props.registry?.resources || [])
const relationships = computed(() => props.registry?.relationships || [])

// Cross-reference registry resources with their live Architecture node for an operational status,
// reusing the health/staleness already available on the graph (see Phase 11) instead of new telemetry.
const nodesByRegistryId = computed(() => {
  const map = new Map()
  for (const node of props.graph?.document?.nodes || []) {
    if (node.registryResourceId) map.set(node.registryResourceId, node)
  }
  return map
})

function statusFor(resource) {
  const node = nodesByRegistryId.value.get(resource.id)
  if (node?.syncState === 'stale') return { status: 'stale', label: 'Stale' }
  const health = node?.health?.status
  if (health === 'degraded') return { status: 'degraded', label: 'Degraded' }
  if (health === 'healthy') return { status: 'healthy', label: 'Healthy' }
  return { status: 'unknown', label: 'Unknown' }
}

function relationshipCount(resourceId) {
  return relationships.value.filter(relationship =>
    relationship.sourceResourceId === resourceId || relationship.targetResourceId === resourceId).length
}

function sourceLabel(source) {
  return source === 'apm_resource' ? 'APM' : source === 'architecture_node' ? 'Architecture' : source
}

function scopeLabel(resource) {
  return [resource.scopeId, resource.location].filter(Boolean).join(' / ') || '—'
}
</script>

<style scoped>
.architecture-resources { display: flex; flex-direction: column; gap: 12px; }
.resources-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.resources-title { display: flex; align-items: center; gap: 9px; }
.resources-title-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 6px; background: color-mix(in srgb, #58a6ff 20%, transparent); color: #58a6ff; }
.resources-title small { display: block; color: var(--text-dim); font-size: 11px; }
.resources-actions { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 12px; }
.resources-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 12px; color: var(--text-dim); text-align: center; }
.resources-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.resources-table th { text-align: left; padding: 6px 8px; color: var(--text-dim); font-size: 10px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
.resources-table td { padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
.resource-name-cell small { display: block; color: var(--text-dim); font-size: 10px; }
.resource-sources-cell { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.resource-source-badge { padding: 2px 6px; border-radius: 10px; font-size: 10px; background: color-mix(in srgb, #58a6ff 18%, transparent); color: #58a6ff; }
.resource-source-badge.architecture_node { background: color-mix(in srgb, #3fb950 18%, transparent); color: #3fb950; }
.resource-divergence { display: inline-flex; align-items: center; gap: 3px; color: #d29922; font-size: 10px; }
.resource-divergence :deep(svg) { width: 12px; height: 12px; }
.resource-status { padding: 2px 6px; border-radius: 10px; font-size: 10px; text-transform: capitalize; background: var(--bg-panel); color: var(--text-dim); }
.resource-status.healthy { color: #3fb950; }
.resource-status.degraded { color: #d29922; }
.resource-status.stale { color: #6e7781; }
</style>
