<template>
  <section class="cloud-discovery-panel">
    <header>
      <span><i :data-lucide="provider === 'gcp' ? 'cloud-cog' : 'triangle'"></i><strong>Add {{ providerLabel }} resources</strong><small>Preview the live inventory, confirm resources, then import them atomically.</small></span>
      <button class="btn sm btn-icon" :title="`Close ${providerLabel} discovery`" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>
    <div v-if="store.discovering" class="cloud-discovery-progress" role="status" aria-live="polite"><i data-lucide="loader-2"></i><span>Reading {{ providerLabel }} inventory…</span></div>
    <template v-if="!preview">
      <div class="cloud-discovery-empty"><span>Architecture will read {{ provider === 'gcp' ? 'Cloud Run services and Cloud Functions' : 'projects and their latest deployments' }} for the active profile.</span><button class="btn sm primary" :disabled="store.discovering" @click="loadPreview"><i data-lucide="scan-search"></i> Preview inventory</button></div>
    </template>
    <template v-else>
      <div class="cloud-discovery-summary"><span><strong>{{ preview.nodes.length }}</strong> resources</span><span v-if="provider === 'vercel'"><strong>{{ deploymentCount }}</strong> deployments</span><span v-if="preview.failures.length" class="warning"><strong>{{ preview.failures.length }}</strong> partial reads</span><button class="btn sm" :disabled="store.discovering" @click="loadPreview"><i data-lucide="refresh-cw"></i> Refresh</button></div>
      <div class="cloud-discovery-resource-list">
        <label v-for="node in sortedNodes" :key="node.id" class="cloud-discovery-row" :class="{ 'already-in-project': node.alreadyInGraph }">
          <input v-model="selectedNodeIds" type="checkbox" :value="node.id" :disabled="node.alreadyInGraph" /><i :data-lucide="resourceIcon(node.resourceType)"></i>
          <span><strong>{{ node.name }}</strong><small>{{ resourceDetail(node) }}</small></span><span v-if="node.alreadyInGraph" class="already-badge">already in project</span><span v-else class="resource-state">{{ resourceState(node) }}</span>
        </label>
      </div>
      <footer><span>{{ selectedNodeIds.length }} selected</span><button class="btn sm primary" :disabled="store.saving || !selectedNodeIds.length" @click="importResources"><i :data-lucide="store.saving ? 'loader-2' : 'download'"></i>{{ store.saving ? 'Importing…' : 'Add to diagram' }}</button></footer>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

const props = defineProps({ provider: { type: String, required: true } })
const emit = defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const selectedNodeIds = ref([])
const preview = computed(() => props.provider === 'gcp' ? store.gcpPreview : store.vercelPreview)
const providerLabel = computed(() => props.provider === 'gcp' ? 'GCP' : 'Vercel')
const sortedNodes = computed(() => (preview.value?.nodes || []).slice().sort((left, right) => left.name.localeCompare(right.name)))
const deploymentCount = computed(() => (preview.value?.nodes || []).reduce((sum, node) => sum + (node.deployments?.length || 0), 0))
async function loadPreview() { selectedNodeIds.value = []; const result = await store.previewCloudResources(props.provider); if (result) selectedNodeIds.value = result.nodes.filter(node => !node.alreadyInGraph).map(node => node.id); refreshIcons() }
async function importResources() { const graph = await store.importCloudResources({ provider: props.provider, selectedNodeIds: selectedNodeIds.value }); if (graph) { selectedNodeIds.value = []; emit('imported', graph); refreshIcons() } }
function resourceIcon(type) { return type === 'gcp-function' ? 'square-function' : type === 'vercel-project' ? 'triangle' : 'cloud-cog' }
function resourceDetail(node) { if (node.resourceType === 'vercel-project') return [node.framework, node.region, node.deployments?.length ? `${node.deployments.length} deployments` : 'no deployments'].filter(Boolean).join(' · '); return [node.resourceType === 'gcp-cloud-run' ? 'Cloud Run' : 'Cloud Function', node.region, node.runtime].filter(Boolean).join(' · ') }
function resourceState(node) { return node.latestDeployment?.state || node.state || node.status || 'discovered' }
function refreshIcons() { nextTick(() => createIcons({ icons })) }
watch(preview, value => { if (!value) selectedNodeIds.value = []; refreshIcons() })
onMounted(async () => { await loadPreview(); refreshIcons() })
</script>

<style scoped>
.cloud-discovery-panel { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); overflow: hidden; }
.cloud-discovery-panel > header, .cloud-discovery-summary, .cloud-discovery-panel footer { padding: 10px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.cloud-discovery-panel > header { justify-content: space-between; }.cloud-discovery-panel > header > span { display: flex; align-items: center; gap: 8px; }.cloud-discovery-panel > header > span > span { display: flex; flex-direction: column; }
.cloud-discovery-panel header small, .cloud-discovery-summary span, .cloud-discovery-row small, .cloud-discovery-empty, .cloud-discovery-panel footer { color: var(--text-dim); }
.cloud-discovery-progress, .cloud-discovery-empty { min-height: 52px; padding: 12px; display: flex; align-items: center; gap: 10px; }.cloud-discovery-progress { color: #2f81f7; border-bottom: 1px solid var(--border); }.cloud-discovery-progress > i { animation: spin .9s linear infinite; }.cloud-discovery-empty { justify-content: space-between; }
.cloud-discovery-summary strong { color: var(--text); }.cloud-discovery-summary .btn { margin-left: auto; }.cloud-discovery-summary .warning { color: #d29922; }.cloud-discovery-resource-list { max-height: 300px; overflow: auto; }
.cloud-discovery-row { min-height: 50px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); cursor: pointer; }.cloud-discovery-row:hover { background: var(--bg-hover); }.cloud-discovery-row > span:not(.already-badge):not(.resource-state) { display: flex; flex: 1; min-width: 0; flex-direction: column; }.cloud-discovery-row > i { width: 17px; height: 17px; color: #2f81f7; }.cloud-discovery-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.resource-state, .already-badge { font-size: 10px; text-transform: capitalize; }.already-badge { color: var(--text-dim); text-transform: none; }.cloud-discovery-row.already-in-project { opacity: .65; cursor: default; }
.cloud-discovery-panel footer { justify-content: space-between; border-bottom: 0; font-size: 11px; } @keyframes spin { to { transform: rotate(360deg); } } @media (max-width: 650px) { .cloud-discovery-empty { align-items: flex-start; flex-direction: column; } }
</style>
