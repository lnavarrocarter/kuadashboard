<template>
  <section class="architecture-resources">
    <header class="resources-header">
      <span class="resources-title">
        <span class="resources-title-icon"><i data-lucide="database"></i></span>
        <span><strong>{{ t('archRes.title') }}</strong><small>{{ t('archRes.subtitle') }}</small></span>
      </span>
      <span class="resources-actions">
        <button class="btn sm btn-icon" :title="t('archRes.refresh')" :disabled="loading" @click="$emit('refresh')"><i data-lucide="refresh-cw"></i></button>
        <span class="resources-count"><strong>{{ resources.length }}</strong> {{ t(resources.length === 1 ? 'archRes.resource' : 'archRes.resources') }}</span>
      </span>
    </header>

    <div v-if="!loading && resources.length" class="resources-filters">
      <label v-if="availableProviders.length > 1">
        <span>{{ t('archRes.providerFilter') }}</span>
        <select v-model="providerFilter" class="ctrl-select" data-test="resource-provider-filter" @change="providerChanged">
          <option value="all">{{ t('archRes.allProviders') }}</option>
          <option v-for="provider in availableProviders" :key="provider" :value="provider">{{ provider.toUpperCase() }}</option>
        </select>
      </label>
      <label v-if="availableScopes.length">
        <span>{{ t('archRes.scopeFilter') }}</span>
        <select v-model="scopeFilter" class="ctrl-select" data-test="resource-scope-filter" @change="persistView">
          <option value="">{{ t('archRes.allCloudScopes') }}</option>
          <option v-for="scope in availableScopes" :key="scope.value" :value="scope.value">{{ scope.label }}</option>
        </select>
      </label>
      <span class="resources-filter-count">
        {{ t('archRes.showingCount', { shown: filteredResources.length, total: resources.length }) }}
      </span>
    </div>

    <div v-if="loading" class="resources-empty">{{ t('archRes.loading') }}</div>
    <div v-else-if="!resources.length" class="resources-empty">
      <i data-lucide="database-zap"></i>
      <strong>{{ t('archRes.emptyTitle') }}</strong>
      <span>{{ t('archRes.emptyHint') }}</span>
    </div>
    <div v-else-if="!filteredResources.length" class="resources-empty" data-test="resources-filter-empty">
      <i data-lucide="filter-x"></i>
      <strong>{{ t('archRes.filteredEmptyTitle') }}</strong>
      <span>{{ t('archRes.filteredEmptyHint') }}</span>
    </div>

    <table v-else class="resources-table">
      <thead>
        <tr>
          <th>{{ t('archRes.col.resource') }}</th>
          <th>{{ t('archRes.col.type') }}</th>
          <th>{{ t('archRes.col.scope') }}</th>
          <th>{{ t('archRes.col.sources') }}</th>
          <th>{{ t('archRes.col.status') }}</th>
          <th>{{ t('archRes.col.relations') }}</th>
          <th v-if="$slots.actions">{{ t('archRes.col.actions') }}</th>
          <th>{{ t('archRes.col.open') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="resource in filteredResources" :key="resource.id">
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
            <span v-if="resource.divergent" class="resource-divergence" :title="t('archRes.singleSourceHint')">
              <i data-lucide="alert-triangle"></i> {{ t('archRes.singleSource') }}
            </span>
          </td>
          <td class="resource-status-cell"><span :class="['resource-status', statusFor(resource).status]">{{ statusFor(resource).label }}</span></td>
          <td class="resource-relations-cell">
            <span class="relationship-count">{{ relationshipCount(resource.id) }}</span>
            <span v-if="divergentRelationshipCount(resource.id)" class="relationship-divergence" :title="t('archRes.pendingHint')">
              <i data-lucide="alert-triangle"></i> {{ t('archRes.pendingReview', { n: divergentRelationshipCount(resource.id) }) }}
            </span>
          </td>
          <td v-if="$slots.actions" class="resource-actions-cell"><slot name="actions" :resource="resource.sourceResource || resource"></slot></td>
          <!-- Straight to the resource where it lives (#239): AWS view or console, Kubernetes. -->
          <td class="resource-open-cell">
            <template v-for="destination in [resourceDestinations(resource)[0]]" :key="destination?.key || 'none'">
              <a v-if="destination?.url" class="btn sm btn-icon" data-test="registry-resource-open" :href="destination.url" target="_blank" rel="noopener noreferrer" :title="t(destination.label)" :aria-label="`${t(destination.label)}: ${resource.displayName}`"><i :data-lucide="destination.icon"></i></a>
              <button v-else-if="destination" class="btn sm btn-icon" data-test="registry-resource-open" :title="t(destination.label)" :aria-label="`${t(destination.label)}: ${resource.displayName}`" @click="emit('open-destination', destination)"><i :data-lucide="destination.icon"></i></button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { resourceDestinations } from '../../lib/resourceDestinations'

const props = defineProps({
  graph: { type: Object, default: null },
  registry: { type: Object, default: null },
  fallbackResources: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['refresh', 'operation', 'open-destination'])
const { t } = useI18n()
const providerFilter = ref('all')
const scopeFilter = ref('')

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
const availableProviders = computed(() => [...new Set(resources.value.map(resource => resource.provider).filter(Boolean))].sort())

// Stack and namespace membership live on Architecture nodes, while the registry owns stable IDs.
function scopeFor(resource) {
  const node = nodesByRegistryId.value.get(resource.id)
  return {
    stackName: node?.stackName || resource.stackName || '',
    namespace: node?.namespace || resource.namespace || resource.sourceResource?.namespace || '',
  }
}

const availableScopes = computed(() => {
  const options = new Map()
  for (const resource of resources.value) {
    if (providerFilter.value !== 'all' && resource.provider !== providerFilter.value) continue
    const { stackName, namespace } = scopeFor(resource)
    if (stackName) options.set(`cloudformation:${stackName}`, { value: `cloudformation:${stackName}`, label: `${t('archRes.cloudformation')} · ${stackName}` })
    if (resource.provider === 'kubernetes' && namespace) options.set(`namespace:${namespace}`, { value: `namespace:${namespace}`, label: `${t('archRes.kubernetesNamespace')} · ${namespace}` })
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label))
})

const filteredResources = computed(() => resources.value.filter(resource => {
  if (providerFilter.value !== 'all' && resource.provider !== providerFilter.value) return false
  if (!scopeFilter.value) return true
  const [kind, ...parts] = scopeFilter.value.split(':')
  const selectedScope = parts.join(':')
  const scope = scopeFor(resource)
  if (kind === 'cloudformation') return scope.stackName === selectedScope
  if (kind === 'namespace') return resource.provider === 'kubernetes' && scope.namespace === selectedScope
  return true
}))

watch(() => props.graph?.document?.view, view => {
  providerFilter.value = view?.resourceProviderFilter || 'all'
  scopeFilter.value = view?.resourceScopeFilter || ''
}, { immediate: true, deep: true })

function persistView() {
  emit('operation', {
    type: 'view.set',
    value: { resourceProviderFilter: providerFilter.value, resourceScopeFilter: scopeFilter.value },
  }, t('archCanvas.op.updateView'))
}

function providerChanged() {
  scopeFilter.value = ''
  persistView()
}

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
  if (node?.syncState === 'stale') return { status: 'stale', label: t('archCanvas.status.stale') }
  const health = node?.health?.status
  if (health === 'degraded') return { status: 'degraded', label: t('archCanvas.health.degraded') }
  if (health === 'healthy') return { status: 'healthy', label: t('archCanvas.health.healthy') }
  return { status: 'unknown', label: t('archRes.status.unknown') }
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
  return source === 'apm_resource' ? 'APM' : source === 'architecture_node' ? t('archView.title') : source
}

function scopeLabel(resource) {
  return [resource.scopeId, resource.location].filter(Boolean).join(' / ') || '—'
}
</script>

<style scoped>
.architecture-resources { display: flex; flex-direction: column; gap: 12px; }
.resources-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.resources-filters { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); }
.resources-filters label { display: grid; gap: 4px; color: var(--text-dim); font-size: 12px; }
.resources-filters .ctrl-select { min-width: 180px; }
.resources-filter-count { margin-left: auto; padding-bottom: 6px; color: var(--text-dim); font-size: 12px; }
.resources-title { display: flex; align-items: center; gap: 9px; }
.resources-title-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 6px; background: color-mix(in srgb, #58a6ff 20%, transparent); color: #58a6ff; }
.resources-title small { display: block; color: var(--text-dim); font-size: 12px; }
.resources-actions { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 12px; }
.resources-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 32px 12px; color: var(--text-dim); text-align: center; }
.resources-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); }
.resources-table thead th { text-align: left; padding: 8px 10px; color: var(--text-dim); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 82%, var(--bg)); }
.resources-table tbody tr { transition: background 120ms ease; }
.resources-table tbody tr:hover { background: color-mix(in srgb, #58a6ff 8%, transparent); }
.resources-table td { padding: 10px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.resources-table tbody tr:last-child td { border-bottom: 0; }
.resource-name-cell { min-width: 220px; }
.resource-name-meta { display: flex; flex-direction: column; gap: 5px; }
.resource-name-meta strong { font-size: 12px; line-height: 1.3; }
.resource-meta-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.resource-meta-row small { color: var(--text-dim); font-size: 12px; }
.resource-type-pill { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); font-size: 12px; color: var(--text-dim); }
.resource-scope-cell { min-width: 180px; }
.scope-value { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 6px; background: color-mix(in srgb, #58a6ff 12%, transparent); color: var(--text); font-size: 12px; }
.resource-sources-cell { min-width: 180px; }
.resource-source-list { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
.resource-source-badge { padding: 2px 6px; border-radius: 10px; font-size: 12px; background: color-mix(in srgb, #58a6ff 18%, transparent); color: #58a6ff; }
.resource-source-badge.architecture_node { background: color-mix(in srgb, #3fb950 18%, transparent); color: #3fb950; }
.resource-divergence { display: inline-flex; align-items: center; gap: 3px; color: #d29922; font-size: 12px; }
.resource-divergence :deep(svg) { width: 12px; height: 12px; }
.resource-status-cell { min-width: 110px; }
.resource-status { display: inline-flex; align-items: center; justify-content: center; min-width: 68px; padding: 3px 7px; border-radius: 999px; font-size: 12px; font-weight: 600; text-transform: capitalize; background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); }
.resource-status.healthy { color: #3fb950; background: color-mix(in srgb, #3fb950 12%, var(--bg)); border-color: color-mix(in srgb, #3fb950 38%, var(--border)); }
.resource-status.degraded { color: #d29922; background: color-mix(in srgb, #d29922 12%, var(--bg)); border-color: color-mix(in srgb, #d29922 32%, var(--border)); }
.resource-status.stale { color: #6e7781; background: color-mix(in srgb, #6e7781 8%, var(--bg)); border-color: color-mix(in srgb, #6e7781 28%, var(--border)); }
.resource-relations-cell { min-width: 120px; display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.relationship-count { display: inline-flex; align-items: center; justify-content: center; min-width: 26px; padding: 2px 7px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); font-size: 12px; font-weight: 600; }
.relationship-divergence { display: inline-flex; align-items: center; gap: 3px; color: #d29922; font-size: 12px; }
.relationship-divergence :deep(svg) { width: 12px; height: 12px; }
.resource-actions-cell { width: 130px; }
.resource-actions-cell > * { display: flex; justify-content: flex-end; }
@media (max-width: 720px) {
  .resources-header { align-items: flex-start; }
  .resources-filters { align-items: stretch; }
  .resources-filters label, .resources-filters .ctrl-select { width: 100%; min-width: 0; max-width: 100%; }
  .resources-filter-count { margin-left: 0; padding-bottom: 0; }
  .resources-table { display: block; overflow-x: auto; }
}
</style>
