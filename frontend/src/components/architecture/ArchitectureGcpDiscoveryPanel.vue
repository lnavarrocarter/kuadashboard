<template>
  <section class="gcp-discovery" data-test="gcp-discovery">
    <header>
      <span><i data-lucide="cloud-cog"></i><span><strong>{{ t('gcpDisc.title') }}</strong><small>{{ t('gcpDisc.subtitle') }}</small></span></span>
      <button class="btn sm btn-icon" :title="t('action.close')" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>
    <ol class="gcp-steps">
      <li :class="{ active: step === 0, done: step > 0 }">{{ t('gcpDisc.stepGroups') }}</li>
      <li :class="{ active: step === 1 }">{{ t('gcpDisc.stepResources') }}</li>
    </ol>
    <div v-if="store.discovering" class="gcp-progress" role="status" aria-live="polite"><i data-lucide="loader-2"></i><span>{{ t('gcpDisc.reading') }}</span></div>

    <!-- Step 0: what to read, like choosing CloudFormation stacks on AWS -->
    <div v-if="step === 0 && groups" class="gcp-body">
      <div class="gcp-find">
        <input v-model.trim="fullName" class="ctrl-input" :placeholder="t('gcpDisc.fullNamePlaceholder')" data-test="gcp-full-name" @keydown.enter="findByName" />
        <button class="btn sm" :disabled="!fullName || store.discovering" data-test="gcp-find-name" @click="findByName">{{ t('gcpDisc.findName') }}</button>
      </div>
      <p v-if="nameNotFound" class="gcp-warn">{{ t('gcpDisc.nameNotFound') }}</p>

      <section class="gcp-group">
        <h4>{{ t('gcpDisc.deployments') }} <small>{{ t('gcpDisc.deploymentsHint') }}</small></h4>
        <p v-if="groups.infraManager !== 'available'" class="gcp-dim" data-test="gcp-infra-status">{{ t(`gcpDisc.infra.${groups.infraManager}`) }}</p>
        <p v-else-if="!groups.deployments.length" class="gcp-dim">{{ t('gcpDisc.noDeployments') }}</p>
        <label v-for="deployment in groups.deployments" :key="deployment.id" class="gcp-row">
          <input v-model="selectedDeployments" type="checkbox" :value="deployment.id" :disabled="!selectedDeployments.includes(deployment.id) && selectedDeployments.length >= 10" />
          <span><strong>{{ deployment.name }}</strong><small>{{ [deployment.location, deployment.state].filter(Boolean).join(' · ') }}</small></span>
        </label>
      </section>

      <section class="gcp-group">
        <h4>{{ t('gcpDisc.labels') }} <small>{{ t('gcpDisc.labelsHint') }}</small></h4>
        <input v-if="groups.labels.length > 8" v-model.trim="labelFilter" class="ctrl-input" :placeholder="t('gcpDisc.filterLabels')" />
        <p v-if="!groups.labels.length" class="gcp-dim">{{ t('gcpDisc.noLabels') }}</p>
        <div class="gcp-labels">
          <label v-for="label in visibleLabels" :key="labelId(label)" class="gcp-chip" :class="{ on: selectedLabels.includes(labelId(label)) }">
            <input v-model="selectedLabels" type="checkbox" :value="labelId(label)" />{{ labelId(label) }} <small>{{ label.count }}</small>
          </label>
        </div>
      </section>

      <p v-if="groups.failures?.length" class="gcp-warn">{{ t('gcpDisc.failures', { list: groups.failures.map(item => `${item.type} (${item.code})`).join(', ') }) }}</p>
      <footer>
        <button class="btn sm" :disabled="store.discovering" data-test="gcp-whole-project" @click="preview({})">{{ t('gcpDisc.wholeProject', { count: groups.total }) }}</button>
        <button class="btn sm primary" :disabled="store.discovering || (!selectedDeployments.length && !selectedLabels.length)" data-test="gcp-continue" @click="preview({ deployments: selectedDeployments, labels: selectedLabels })">{{ t('gcpDisc.continue') }}</button>
      </footer>
    </div>

    <!-- Step 1: resources by type, relationships, then the import -->
    <div v-else-if="step === 1 && result" class="gcp-body">
      <div class="gcp-summary">
        <span><strong>{{ result.nodes.length }}</strong> {{ t('gcpDisc.resources') }}</span>
        <span v-if="result.relationships.length"><strong>{{ result.relationships.length }}</strong> {{ t('gcpDisc.relationships') }}</span>
        <span v-if="result.groups?.length" class="gcp-dim">{{ result.groups.map(group => group.name || group.id).join(', ') }}</span>
        <button class="btn sm" @click="step = 0">{{ t('gcpDisc.back') }}</button>
      </div>
      <details v-if="result.unmapped?.length" class="gcp-unmapped">
        <summary>{{ t('gcpDisc.unmapped', { count: result.unmapped.length }) }}</summary>
        <ul><li v-for="item in result.unmapped" :key="`${item.deployment}:${item.address}`" class="mono-xs">{{ item.deployment }} · {{ item.address }}</li></ul>
      </details>
      <p v-if="result.failures?.length" class="gcp-warn">{{ t('gcpDisc.failures', { list: result.failures.map(item => `${item.source} (${item.code})`).join(', ') }) }}</p>
      <input v-model.trim="search" class="ctrl-input" :placeholder="t('gcpDisc.search')" data-test="gcp-search" />
      <div class="gcp-list">
        <template v-for="group in groupedNodes" :key="group.type">
          <h5>{{ group.label }} <small>{{ group.nodes.length }}</small></h5>
          <label v-for="node in group.nodes" :key="node.id" class="gcp-row" :class="{ 'gcp-in-graph': node.alreadyInGraph }">
            <input v-model="selectedNodeIds" type="checkbox" :value="node.id" :disabled="node.alreadyInGraph" />
            <span>
              <strong>{{ node.name }}</strong>
              <small>{{ [node.region, ...labelList(node)].filter(Boolean).join(' · ') }}</small>
              <small class="mono-xs gcp-native" :title="node.nativeId">{{ node.nativeId }}</small>
            </span>
            <span v-if="node.alreadyInGraph" class="gcp-dim">{{ alreadyAddedLabel(t, store.linkedApplication) }}</span>
          </label>
        </template>
        <p v-if="!groupedNodes.length" class="gcp-dim">{{ t('gcpDisc.noResources') }}</p>
      </div>
      <details v-if="result.relationships.length" class="gcp-relationships">
        <summary>{{ t('gcpDisc.relationshipsTitle', { count: result.relationships.length }) }}</summary>
        <ul><li v-for="edge in result.relationships" :key="edge.id">{{ nodeName(edge.sourceNodeId) }} → <em>{{ edge.relationType }}</em> → {{ nodeName(edge.targetNodeId) }}</li></ul>
      </details>
      <footer>
        <span>{{ t('gcpDisc.selected', { count: selectedNodeIds.length }) }}</span>
        <button class="btn sm primary" :disabled="store.saving || !selectedNodeIds.length" data-test="gcp-import" @click="importResources">{{ store.saving ? t('gcpDisc.importing') : t('gcpDisc.import') }}</button>
      </footer>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useI18n } from '../../composables/useI18n'
import { alreadyAddedLabel } from '../../lib/discoveryMembership'

const emit = defineEmits(['close', 'imported'])
const store = useArchitectureStore()
const { t } = useI18n()

const TYPE_LABELS = {
  'gcp-compute-instance': 'Compute Engine VMs', 'gcp-disk': 'Persistent disks', 'gcp-gke': 'GKE', 'gcp-sql': 'Cloud SQL',
  'gcp-bucket': 'Cloud Storage', 'gcp-pubsub-topic': 'Pub/Sub topics', 'gcp-pubsub-subscription': 'Pub/Sub subscriptions',
  'gcp-cloud-run': 'Cloud Run', 'gcp-cloud-run-job': 'Cloud Run jobs', 'gcp-function': 'Cloud Functions', 'gcp-firestore': 'Firestore',
  'gcp-memorystore': 'Memorystore', 'gcp-workflow': 'Workflows', 'gcp-scheduler-job': 'Cloud Scheduler', 'gcp-tasks-queue': 'Cloud Tasks',
  'gcp-bigquery-dataset': 'BigQuery',
}

const step = ref(0)
const groups = computed(() => store.gcpGroups)
const result = computed(() => store.gcpPreview)
const selectedDeployments = ref([])
const selectedLabels = ref([])
const labelFilter = ref('')
const fullName = ref('')
const nameNotFound = ref(false)
const search = ref('')
const selectedNodeIds = ref([])

const labelId = label => `${label.key}=${label.value}`
const visibleLabels = computed(() => (groups.value?.labels || [])
  .filter(label => !labelFilter.value || labelId(label).toLowerCase().includes(labelFilter.value.toLowerCase())))
const labelList = node => Object.entries(node.labels || {}).slice(0, 3).map(([key, value]) => `${key}=${value}`)
const nodeName = id => result.value?.nodes.find(node => node.id === id)?.name || id

const groupedNodes = computed(() => {
  const text = search.value.toLowerCase()
  const nodes = (result.value?.nodes || []).filter(node => !text || [node.name, node.nativeId, node.resourceType, ...labelList(node)]
    .some(value => String(value || '').toLowerCase().includes(text)))
  const byType = new Map()
  for (const node of nodes.slice().sort((left, right) => left.name.localeCompare(right.name))) {
    const list = byType.get(node.resourceType) || []
    list.push(node)
    byType.set(node.resourceType, list)
  }
  return [...byType].map(([type, list]) => ({ type, label: TYPE_LABELS[type] || type, nodes: list }))
})

async function preview(filters) {
  nameNotFound.value = false
  const data = await store.previewCloudResources('gcp', filters)
  if (!data) return null
  selectedNodeIds.value = data.nodes.filter(node => !node.alreadyInGraph).map(node => node.id)
  step.value = 1
  refreshIcons()
  return data
}

// Like "Find ARN" on AWS: read the project and keep only the resource with that full name.
async function findByName() {
  const wanted = fullName.value.replace(/^\/\/[^/]+\//, '')
  const data = await preview({})
  if (!data) return
  const match = data.nodes.find(node => node.nativeId === wanted)
  if (!match) { step.value = 0; nameNotFound.value = true; return }
  selectedNodeIds.value = match.alreadyInGraph ? [] : [match.id]
  search.value = match.name
}

async function importResources() {
  const graph = await store.importCloudResources({ provider: 'gcp', selectedNodeIds: selectedNodeIds.value })
  if (graph) { selectedNodeIds.value = []; emit('imported', graph) }
}

function refreshIcons() { nextTick(() => createIcons({ icons })) }
onMounted(async () => { await store.loadGcpGroups(); refreshIcons() })
</script>

<style scoped>
.gcp-discovery { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-panel); overflow: hidden; }
.gcp-discovery > header { padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--border); }
.gcp-discovery > header > span { display: flex; align-items: center; gap: 8px; }
.gcp-discovery > header > span > span { display: flex; flex-direction: column; }
.gcp-discovery small, .gcp-dim { color: var(--text-dim); }
.gcp-steps { display: flex; gap: 16px; margin: 0; padding: 8px 12px; list-style: none; font-size: 12px; color: var(--text-dim); border-bottom: 1px solid var(--border); }
.gcp-steps .active { color: var(--text); font-weight: 600; }
.gcp-progress { padding: 10px 12px; display: flex; gap: 8px; color: #2f81f7; border-bottom: 1px solid var(--border); }
.gcp-progress > i { animation: spin .9s linear infinite; }
.gcp-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; }
.gcp-find { display: flex; gap: 8px; }
.gcp-find input { flex: 1; }
.gcp-group h4 { margin: 0 0 6px; font-size: 12px; }
.gcp-row { display: flex; align-items: flex-start; gap: 8px; padding: 6px 4px; border-bottom: 1px solid var(--border); cursor: pointer; }
.gcp-row > span { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.gcp-row.gcp-in-graph { opacity: .65; cursor: default; }
.gcp-native { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gcp-labels { display: flex; flex-wrap: wrap; gap: 6px; max-height: 140px; overflow: auto; }
.gcp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; font-size: 11px; cursor: pointer; }
.gcp-chip.on { border-color: #2f81f7; color: #2f81f7; }
.gcp-chip input { display: none; }
.gcp-summary { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.gcp-summary .btn { margin-left: auto; }
.gcp-list { max-height: 320px; overflow: auto; }
.gcp-list h5 { margin: 8px 0 2px; font-size: 11px; text-transform: uppercase; color: var(--text-dim); }
.gcp-warn { color: #d29922; font-size: 12px; margin: 0; }
.gcp-unmapped ul, .gcp-relationships ul { margin: 4px 0; padding-left: 18px; font-size: 12px; }
.gcp-discovery footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
