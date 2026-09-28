<template>
  <div ref="rootRef" :class="['split-pane', { resizing, split }]">
    <div class="split-top" :style="split ? { flexBasis: `${topPx}px` } : null" data-test="split-top">
      <slot name="top" />
    </div>

    <template v-if="split">
      <div
        class="split-handle"
        role="separator"
        aria-orientation="horizontal"
        :aria-valuenow="Math.round(ratio * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        tabindex="0"
        title="Arrastra para ajustar · doble clic para alternar"
        data-test="split-handle"
        @pointerdown="startDrag"
        @dblclick="toggleCollapse"
        @keydown="onKey"
      >
        <span class="split-grip"></span>
        <span class="split-actions" @pointerdown.stop @dblclick.stop>
          <button v-if="!collapsed" class="split-btn" title="Dar todo el espacio al detalle" data-test="split-collapse" @click="setCollapsed(true)">⤒ Expandir detalle</button>
          <button v-else class="split-btn" title="Volver a mostrar la lista" data-test="split-restore" @click="setCollapsed(false)">⤓ Mostrar lista</button>
        </span>
      </div>
      <div class="split-bottom" data-test="split-bottom">
        <slot name="bottom" />
      </div>
    </template>
  </div>
</template>

<script setup>
// Vertical list/detail split: drag (or arrow keys) to resize, double-click or the
// button to collapse the top to a thin strip. The ratio is remembered per
// storageKey and applied to the current height, so the layout adapts when the
// available space changes (e.g. the console panel opens), keeping minimum sizes.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  split:        { type: Boolean, default: false },   // false → top takes all the space
  storageKey:   { type: String, default: '' },
  defaultRatio: { type: Number, default: 0.4 },      // top share of the height
  minTop:       { type: Number, default: 72 },       // px, when not collapsed
  minBottom:    { type: Number, default: 180 },      // px
  collapsedTop: { type: Number, default: 44 },       // px shown when collapsed
})

const rootRef = ref(null)
const height = ref(0)
const resizing = ref(false)

function readStored() {
  try {
    const raw = props.storageKey && localStorage.getItem(`kua.split.${props.storageKey}`)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed.ratio === 'number' ? parsed : null
  } catch { return null }
}
const stored = readStored()
const ratio = ref(stored?.ratio ?? props.defaultRatio)
const collapsed = ref(!!stored?.collapsed)

function persist() {
  if (!props.storageKey) return
  try { localStorage.setItem(`kua.split.${props.storageKey}`, JSON.stringify({ ratio: ratio.value, collapsed: collapsed.value })) } catch { /* storage unavailable */ }
}

// Top height in px for the current container height, clamped to the minimums
const topPx = computed(() => {
  const h = height.value
  if (!h) return Math.round(ratio.value * 400)
  if (collapsed.value) return props.collapsedTop
  const max = Math.max(props.minTop, h - props.minBottom)
  return Math.round(Math.min(max, Math.max(props.minTop, ratio.value * h)))
})

function setCollapsed(value) {
  collapsed.value = value
  persist()
}
function toggleCollapse() { setCollapsed(!collapsed.value) }

function setRatioFromTop(top) {
  const h = height.value || 1
  ratio.value = Math.min(0.9, Math.max(0.05, top / h))
  if (collapsed.value) collapsed.value = false
}

let dragStart = null
function startDrag(event) {
  if (event.button != null && event.button !== 0) return   // primary button only
  dragStart = { y: event.clientY, top: topPx.value }
  resizing.value = true
  event.currentTarget.setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onDrag)
  window.addEventListener('pointerup', endDrag)
  event.preventDefault()
}
function onDrag(event) {
  if (!dragStart) return
  setRatioFromTop(dragStart.top + (event.clientY - dragStart.y))
}
function endDrag() {
  if (!dragStart) return
  dragStart = null
  resizing.value = false
  window.removeEventListener('pointermove', onDrag)
  window.removeEventListener('pointerup', endDrag)
  persist()
}

function onKey(event) {
  const step = event.shiftKey ? 80 : 24
  if (event.key === 'ArrowUp') setRatioFromTop(topPx.value - step)
  else if (event.key === 'ArrowDown') setRatioFromTop(topPx.value + step)
  else if (event.key === 'Enter' || event.key === ' ') toggleCollapse()
  else if (event.key === 'Home') setCollapsed(true)
  else return
  event.preventDefault()
  persist()
}

let observer = null
onMounted(() => {
  const measure = () => { height.value = rootRef.value?.clientHeight || 0 }
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(rootRef.value)
  }
})
onBeforeUnmount(() => { observer?.disconnect(); endDrag() })

// A new selection after collapsing keeps the user's choice; nothing to reset here
watch(() => props.split, () => { height.value = rootRef.value?.clientHeight || height.value })

defineExpose({ setCollapsed, collapsed, ratio })
</script>

<style scoped>
.split-pane { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; }
.split-top { flex: 1 1 auto; min-height: 0; overflow: auto; }
.split-pane.split .split-top { flex: 0 0 auto; }
.split-bottom { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.split-pane.resizing { user-select: none; cursor: row-resize; }

.split-handle {
  flex: 0 0 auto; height: 12px; position: relative; cursor: row-resize; touch-action: none;
  border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--text) 5%, transparent), transparent);
  display: flex; align-items: center; justify-content: center;
}
.split-handle:hover, .split-handle:focus-visible, .split-pane.resizing .split-handle {
  background: color-mix(in srgb, var(--accent) 16%, transparent); outline: none;
}
.split-grip { width: 44px; height: 3px; border-radius: 2px; background: var(--text-dim); opacity: .7; }
.split-actions { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; gap: 4px; }
.split-btn {
  font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg); color: var(--text-dim);
}
.split-btn:hover { color: var(--accent); border-color: var(--accent); }
</style>
