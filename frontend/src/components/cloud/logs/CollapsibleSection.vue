<template>
  <section class="msg-section cs" :class="{ collapsed }" :data-test="dataTest || undefined">
    <div class="cs-head">
      <h5 class="cs-title">
        <button type="button" class="cs-toggle" :aria-expanded="!collapsed" :data-test="`section-toggle-${id}`" @click="toggle(id)">
          <span class="cs-chevron" aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
          <span>{{ title }}</span>
          <span v-if="badge != null && badge !== ''" class="cs-badge" :class="tone">{{ badge }}</span>
        </button>
      </h5>
      <div v-if="$slots.actions && !collapsed" class="cs-actions"><slot name="actions" /></div>
    </div>
    <!-- v-show keeps the content state (search results, open snippets) while closed -->
    <div v-show="!collapsed" class="cs-body"><slot /></div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useCollapsedSections } from '../../../composables/useCollapsedSections'

const props = defineProps({
  // Stable name: the collapsed state is remembered by it.
  id: { type: String, required: true },
  title: { type: String, required: true },
  // Short summary shown next to the title (also while collapsed), e.g. a count.
  badge: { type: [String, Number], default: null },
  // '', 'warn' or 'err': color of the badge.
  tone: { type: String, default: '' },
  dataTest: { type: String, default: '' },
})

const { isCollapsed, toggle } = useCollapsedSections()
const collapsed = computed(() => isCollapsed(props.id))
</script>

<style scoped>
.cs { display: flex; flex-direction: column; gap: 6px; }
.cs-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.cs-title { margin: 0; }
.cs-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.cs-toggle:hover { color: var(--accent); }
.cs-chevron { width: 10px; color: var(--text-dim); font-size: 10px; }
.cs-badge { font-size: 10px; font-weight: 600; padding: 0 6px; border-radius: 8px; background: var(--bg-hover); color: var(--text-dim); }
.cs-badge.warn { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 15%, transparent); }
.cs-badge.err { color: var(--red); background: color-mix(in srgb, var(--red) 15%, transparent); }
.cs-actions { display: inline-flex; gap: 4px; align-items: center; }
.cs-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
</style>
