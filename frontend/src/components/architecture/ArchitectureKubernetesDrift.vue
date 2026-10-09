<template>
  <!-- The map against its clusters (#239): checked when the map opens (free reads of the Kubernetes
       API), with the change it proposes. Nothing changes until the user applies it. -->
  <section v-if="visible" :class="['k8s-drift', tone]" data-test="k8s-drift" :role="changes.length ? 'alert' : 'status'">
    <header>
      <i :data-lucide="store.kubernetesDriftChecking ? 'loader-2' : changes.length ? 'triangle-alert' : 'check-circle-2'"></i>
      <span class="k8s-drift-copy">
        <strong>{{ title }}</strong>
        <small>{{ subtitle }}</small>
      </span>
      <button class="btn sm" data-test="k8s-drift-recheck" :disabled="store.kubernetesDriftChecking || store.saving" @click="store.checkKubernetesDrift({ force: true })">
        <i data-lucide="refresh-cw"></i>{{ t('archDrift.recheck') }}
      </button>
    </header>
    <p v-if="drift?.error" class="k8s-drift-problem">{{ t('archDrift.failed', { error: drift.error }) }}</p>
    <p v-for="context in unreachable" :key="context.context" class="k8s-drift-problem" data-test="k8s-drift-unreachable">
      {{ t('archDrift.unreachable', { context: context.context, error: context.error || '' }) }}
    </p>
    <template v-if="changes.length">
      <ul class="k8s-drift-list">
        <li v-for="change in changes" :key="change.nodeId">
          <label>
            <input v-model="selected" type="checkbox" :value="change.nodeId" :disabled="store.saving" />
            <span><strong>{{ change.name }}</strong><small>{{ change.kind || change.resourceType }} · {{ change.namespace || t('archK8s.clusterScope') }}</small></span>
          </label>
          <span :class="['k8s-drift-change', change.change]">{{ changeText(change) }}</span>
        </li>
      </ul>
      <footer>
        <small>{{ t('archDrift.explain') }}</small>
        <button class="btn sm primary" data-test="k8s-drift-apply" :disabled="!selected.length || store.saving" @click="apply">
          <i :data-lucide="store.saving ? 'loader-2' : 'check'"></i>{{ t('archDrift.apply', { n: selected.length }) }}
        </button>
      </footer>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useArchitectureStore } from '../../stores/useArchitectureStore'
import { useI18n } from '../../composables/useI18n'

const store = useArchitectureStore()
const { t } = useI18n()
const selected = ref([])

const drift = computed(() => store.kubernetesDrift)
const changes = computed(() => drift.value?.changes || [])
const unreachable = computed(() => (drift.value?.contexts || []).filter(context => context.status === 'unreachable'))
const visible = computed(() => store.kubernetesDriftChecking || !!drift.value)
const tone = computed(() => (changes.value.length || drift.value?.error || unreachable.value.length ? 'attention' : 'ok'))
const title = computed(() => {
  if (store.kubernetesDriftChecking && !drift.value) return t('archDrift.checking')
  if (changes.value.length) return t('archDrift.title', { n: changes.value.length })
  if (drift.value?.error || unreachable.value.length) return t('archDrift.partial')
  return t('archDrift.upToDate')
})
const subtitle = computed(() => {
  if (!drift.value?.checkedAt) return t('archDrift.reads')
  const contexts = (drift.value.contexts || []).filter(context => context.status === 'checked').map(context => context.context.split(/[/:]/).pop())
  return t('archDrift.checked', { contexts: contexts.join(', ') || '-', time: new Date(drift.value.checkedAt).toLocaleTimeString() })
})

function changeText(change) {
  const names = change.successors.map(successor => successor.name)
  if (change.change === 'recreated') return t('archDrift.change.recreated')
  if (change.change === 'replaced') {
    return t('archDrift.change.replaced', { names: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '') })
  }
  return t('archDrift.change.gone')
}

async function apply() {
  await store.applyKubernetesDrift(selected.value)
}

// Every change is proposed; the user can leave some out before applying.
watch(changes, value => { selected.value = value.map(change => change.nodeId) }, { immediate: true })
watch(() => `${store.selectedProjectId}:${store.graph ? 'loaded' : ''}`, () => store.checkKubernetesDrift())
watch([visible, changes, () => store.kubernetesDriftChecking], () => nextTick(() => createIcons({ icons })))
onMounted(() => store.checkKubernetesDrift())
</script>

<style scoped>
.k8s-drift { margin: 8px 0; padding: 10px 12px; display: grid; gap: 8px; border: 1px solid var(--border); border-left: 3px solid var(--green); border-radius: 6px; background: var(--bg-panel); font-size: 13px; }
.k8s-drift.attention { border-left-color: var(--yellow); }
.k8s-drift > header { display: flex; align-items: center; gap: 10px; }
.k8s-drift > header :deep(svg) { width: 16px; height: 16px; flex: none; }
.k8s-drift-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; margin-right: auto; }
.k8s-drift-copy small, .k8s-drift footer small { color: var(--text-dim); font-size: 12px; }
.k8s-drift-problem { margin: 0; color: var(--yellow); font-size: 12px; }
.k8s-drift-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 260px; overflow: auto; }
.k8s-drift-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 4px 6px; border-radius: 4px; background: var(--bg); }
.k8s-drift-list label { display: flex; align-items: center; gap: 8px; min-width: 0; }
.k8s-drift-list label span { display: flex; flex-direction: column; min-width: 0; }
.k8s-drift-list small { color: var(--text-dim); font-size: 12px; }
.k8s-drift-change { font-size: 12px; color: var(--text-dim); }
.k8s-drift-change.gone { color: var(--red); }
.k8s-drift footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
</style>
