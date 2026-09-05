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
          <th v-if="$slots.actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="resource in resources" :key="resource.id">
          <td class="resource-name-cell">
            <div class="resource-name-meta">
              <strong>{{ resource.displayName }}</strong>
              <div class="resource-meta-row">
                <span class="resource-type-pill">{{ resource.resourceType }}</span>
                <small>{{ resource.provider.toUpperCase() }}</small>
              </div>
            </div>
          </td>
          <td>{{ resource.resourceType }}</td>
          <td class="resource-scope-cell">
            <span class="scope-value">{{ scopeLabel(resource) }}</span>
          </td>
          <td class="resource-sources-cell">
            <div class="resource-source-list">
              <span v-for="source in resource.sources" :key="source" :class="['resource-source-badge', source]">{{ sourceLabel(source) }}</span>
            </div>
            <span v-if="resource.divergent" class="resource-divergence" title="Confirmed from only one side (APM or Architecture)">
              <i data-lucide="alert-triangle"></i> Single source
            </span>
          </td>
          <td class="resource-status-cell"><span :class="['resource-status', statusFor(resource).status]">{{ statusFor(resource).label }}</span></td>
          <td class="resource-relations-cell">
            <span class="relationship-count">{{ relationshipCount(resource.id) }}</span>
            <span v-if="divergentRelationshipCount(resource.id)" class="relationship-divergence" title="Suggested relationships still pending review">
              <i data-lucide="alert-triangle"></i> {{ divergentRelationshipCount(resource.id) }} pending review
            </span>
          </td>
          <td v-if="$slots.actions" class="resource-actions-cell"><slot name="actions" :resource="resource.sourceResource || resource"></slot></td>
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
  fallbackResources: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})
defineEmits(['refresh'])

const resources = computed(() => props.registry
  ? props.registry.resources || []
  : props.fallbackResources.map(resource => ({
    id: resource.id,
    provider: resource.provider || resource.type || 'unknown',
    resourceType: resource.kind || resource.type || 'resource',
    displayName: resource.name || resource.id,
    scopeId: resource.kubeContext || resource.namespace || '',
    location: resource.region || '',
    sources: [resource.associationSource || 'apm_resource'],
    correlatable: false,
    divergent: false,
    sourceResource: resource,
  })))
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

function divergentRelationshipCount(resourceId) {
  return relationships.value.filter(relationship => relationship.divergent &&
    (relationship.sourceResourceId === resourceId || relationship.targetResourceId === resourceId)).length
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
.resources-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); }
.resources-table thead th { text-align: left; padding: 8px 10px; color: var(--text-dim); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 82%, var(--bg)); }
.resources-table tbody tr { transition: background 120ms ease; }
.resources-table tbody tr:hover { background: color-mix(in srgb, #58a6ff 8%, transparent); }
.resources-table td { padding: 10px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.resources-table tbody tr:last-child td { border-bottom: 0; }
.resource-name-cell { min-width: 220px; }
.resource-name-meta { display: flex; flex-direction: column; gap: 5px; }
.resource-name-meta strong { font-size: 12px; line-height: 1.3; }
.resource-meta-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.resource-meta-row small { color: var(--text-dim); font-size: 10px; }
.resource-type-pill { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); font-size: 9px; color: var(--text-dim); }
.resource-scope-cell { min-width: 180px; }
.scope-value { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 6px; background: color-mix(in srgb, #58a6ff 12%, transparent); color: var(--text); font-size: 11px; }
.resource-sources-cell { min-width: 180px; }
.resource-source-list { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
.resource-source-badge { padding: 2px 6px; border-radius: 10px; font-size: 10px; background: color-mix(in srgb, #58a6ff 18%, transparent); color: #58a6ff; }
.resource-source-badge.architecture_node { background: color-mix(in srgb, #3fb950 18%, transparent); color: #3fb950; }
.resource-divergence { display: inline-flex; align-items: center; gap: 3px; color: #d29922; font-size: 10px; }
.resource-divergence :deep(svg) { width: 12px; height: 12px; }
.resource-status-cell { min-width: 110px; }
.resource-status { display: inline-flex; align-items: center; justify-content: center; min-width: 68px; padding: 3px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; text-transform: capitalize; background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); }
.resource-status.healthy { color: #3fb950; background: color-mix(in srgb, #3fb950 12%, var(--bg)); border-color: color-mix(in srgb, #3fb950 38%, var(--border)); }
.resource-status.degraded { color: #d29922; background: color-mix(in srgb, #d29922 12%, var(--bg)); border-color: color-mix(in srgb, #d29922 32%, var(--border)); }
.resource-status.stale { color: #6e7781; background: color-mix(in srgb, #6e7781 8%, var(--bg)); border-color: color-mix(in srgb, #6e7781 28%, var(--border)); }
.resource-relations-cell { min-width: 120px; display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.relationship-count { display: inline-flex; align-items: center; justify-content: center; min-width: 26px; padding: 2px 7px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); font-size: 11px; font-weight: 600; }
.relationship-divergence { display: inline-flex; align-items: center; gap: 3px; color: #d29922; font-size: 10px; }
.relationship-divergence :deep(svg) { width: 12px; height: 12px; }
.resource-actions-cell { width: 130px; }
.resource-actions-cell > * { display: flex; justify-content: flex-end; }
</style>
