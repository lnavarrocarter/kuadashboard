<template>
  <span class="row-menu">
    <button
      ref="trigger" type="button" class="btn sm" aria-haspopup="menu" :aria-label="resource ? t('rowMenu.moreFor', { name: resource }) : undefined"
      :aria-expanded="open ? 'true' : 'false'" :aria-controls="open ? menuId : undefined"
      @click="toggle" @keydown.down.prevent="openAndFocus(0)" @keydown.up.prevent="openAndFocus(-1)"
    >{{ label || t('rowMenu.more') }} ▾</button>
    <Teleport to="body">
      <div
        v-if="open" :id="menuId" ref="menu" class="row-menu-list" role="menu" :style="position"
        @keydown="onMenuKeydown"
      >
        <template v-for="(item, index) in items" :key="item.id">
          <div v-if="item.separator && index > 0" class="row-menu-sep" role="separator"></div>
          <button
            type="button" role="menuitem" tabindex="-1"
            :class="['row-menu-item', { danger: item.danger }]"
            :disabled="item.disabled" :title="item.title || undefined" :data-test="`menu-${item.id}`"
            @click="select(item)"
          >{{ item.label }}</button>
        </template>
      </div>
    </Teleport>
  </span>
</template>

<script setup>
// "More" menu for table rows (menu button pattern): keeps secondary and write
// actions out of the row. Arrow keys move, Escape/Tab close, focus returns to
// the trigger; a click outside closes it.
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'

const props = defineProps({
  // [{ id, label, onSelect, disabled?, danger?, title?, separator? (line before) }]
  items: { type: Array, required: true },
  label: { type: String, default: '' },
  // Names the trigger for screen readers: "More actions for <resource>".
  resource: { type: String, default: '' },
})
const { t } = useI18n()
const open = ref(false)
const trigger = ref(null)
const menu = ref(null)
const position = ref({})
const menuId = `row-menu-${Math.random().toString(36).slice(2, 9)}`

function enabledItems() {
  return [...(menu.value?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])]
}

function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  // Fixed position so table scrolling containers do not clip it; open upwards near the bottom.
  const below = window.innerHeight - rect.bottom
  position.value = below < 220
    ? { position: 'fixed', right: `${window.innerWidth - rect.right}px`, bottom: `${window.innerHeight - rect.top + 2}px` }
    : { position: 'fixed', right: `${window.innerWidth - rect.right}px`, top: `${rect.bottom + 2}px` }
}

async function openAndFocus(index) {
  place()
  open.value = true
  document.addEventListener('mousedown', onOutside, true)
  await nextTick()
  const items = enabledItems()
  items.at(index)?.focus()
}

function close({ focusTrigger = true } = {}) {
  if (!open.value) return
  open.value = false
  document.removeEventListener('mousedown', onOutside, true)
  if (focusTrigger) trigger.value?.focus()
}

function toggle() {
  if (open.value) close()
  else openAndFocus(0)
}

function onOutside(event) {
  if (menu.value?.contains(event.target) || trigger.value?.contains(event.target)) return
  close({ focusTrigger: false })
}

function onMenuKeydown(event) {
  const items = enabledItems()
  const index = items.indexOf(document.activeElement)
  if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus() }
  else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus() }
  else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus() }
  else if (event.key === 'End') { event.preventDefault(); items.at(-1)?.focus() }
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  else if (event.key === 'Tab') close({ focusTrigger: false })
}

function select(item) {
  if (item.disabled) return
  // Return focus first, so a dialog opened by the action can restore it to the trigger.
  close()
  item.onSelect?.()
}

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside, true))
</script>

<style scoped>
.row-menu { display: inline-flex; }
.row-menu-list {
  z-index: 2500; min-width: 180px; padding: 4px 0;
  background: var(--bg-modal); border: 1px solid var(--border); border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, .35); display: flex; flex-direction: column;
}
.row-menu-item {
  background: none; border: 0; color: var(--text); font: inherit; font-size: 12px;
  text-align: left; padding: 6px 12px; cursor: pointer; white-space: nowrap;
}
.row-menu-item:hover:not(:disabled), .row-menu-item:focus { background: var(--bg-hover); outline: none; }
.row-menu-item:focus-visible { box-shadow: inset 2px 0 0 var(--accent); }
.row-menu-item:disabled { color: var(--text-dim); cursor: not-allowed; }
.row-menu-item.danger:not(:disabled) { color: var(--red); }
.row-menu-sep { height: 1px; margin: 4px 0; background: var(--border); }
</style>
