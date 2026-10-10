<template>
  <span v-if="!entries.length" class="text-dim">—</span>
  <div v-else class="tag-chips">
    <span v-for="tag in shown" :key="tag.key" class="tag-chip" :title="`${tag.key}=${tag.value}`">{{ tag.key }}={{ tag.value }}</span>
    <button
      v-if="hidden"
      type="button" class="tag-more" :aria-expanded="expanded ? 'true' : 'false'"
      :title="expanded ? t('tagList.showFewer') : t('tagList.showAll', { n: entries.length })"
      @click="expanded = !expanded"
    >{{ expanded ? t('tagList.fewer') : `+${hidden}` }}</button>
  </div>
</template>

<script setup>
// Compact tag cell: the most relevant tags first (environment, owner, app…),
// provider-internal tags (aws:*, kubernetes.io/*, eks:*…) last, and a "+N"
// toggle for the rest, so rows keep a stable height.
import { computed, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps({
  // [{ Key, Value }], [{ key, value }] or { key: value }
  tags: { type: [Array, Object], default: null },
  max: { type: Number, default: 2 },
  exclude: { type: Array, default: () => ['Name'] },
})
const { t } = useI18n()
const expanded = ref(false)

const PRIORITY = ['env', 'environment', 'stage', 'team', 'owner', 'app', 'application', 'service', 'project']
const INTERNAL = /^(aws:|kubernetes\.io\/|k8s\.io\/|eks:|karpenter|alpha\.eksctl\.io\/|eksctl\.|elasticbeanstalk:|cloudformation:)/i

function rank(key) {
  if (INTERNAL.test(key)) return 1000
  const index = PRIORITY.indexOf(key.toLowerCase())
  return index === -1 ? 100 : index
}

const entries = computed(() => {
  const raw = props.tags || []
  const list = Array.isArray(raw)
    ? raw.map(tag => ({ key: tag.Key ?? tag.key, value: tag.Value ?? tag.value }))
    : Object.entries(raw).map(([key, value]) => ({ key, value }))
  return list
    .filter(tag => tag.key && !props.exclude.includes(tag.key))
    .map((tag, index) => ({ ...tag, index }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.index - b.index)
})
const shown = computed(() => (expanded.value ? entries.value : entries.value.slice(0, props.max)))
const hidden = computed(() => Math.max(0, entries.value.length - props.max))
</script>

<style scoped>
.tag-more {
  background: none; border: 1px dashed var(--border); border-radius: 3px;
  color: var(--text-dim); font: inherit; font-size: 10px; padding: 0 5px; cursor: pointer;
}
.tag-more:hover { color: var(--text); }
.tag-more:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
