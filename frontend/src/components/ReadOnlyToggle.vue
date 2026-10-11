<template>
  <!-- On: a labelled pill that stays visible on every provider. Off: a plain lock button. -->
  <button
    :class="['btn', 'sm', 'read-only-toggle', { 'is-on': readOnlyState.enabled }]"
    data-test="read-only-toggle"
    :aria-pressed="String(readOnlyState.enabled)"
    :disabled="busy || readOnlyState.forced"
    :title="title"
    :aria-label="title"
    @click="onClick"
  >
    <i :data-lucide="readOnlyState.enabled ? 'lock' : 'lock-open'"></i>
    <span v-if="readOnlyState.enabled">{{ t('readOnly.badge') }}</span>
  </button>
  <ConfirmModal
    :show="confirmOff"
    :title="t('readOnly.disableTitle')"
    :message="t('readOnly.disableMessage')"
    :confirm-label="t('readOnly.disableConfirm')"
    icon="lock-open"
    @confirm="disable"
    @close="confirmOff = false"
  />
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import ConfirmModal from './ConfirmModal.vue'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import { loadReadOnly, readOnlyState, setReadOnly } from '../composables/useReadOnly'

const { t } = useI18n()
const { toast } = useToast()
const busy = ref(false)
const confirmOff = ref(false)

const title = computed(() => {
  if (readOnlyState.forced) return t('readOnly.forced')
  return t(readOnlyState.enabled ? 'readOnly.onHint' : 'readOnly.offHint')
})

async function change(enabled) {
  busy.value = true
  try {
    await setReadOnly(enabled)
    toast(t(enabled ? 'readOnly.enabled' : 'readOnly.disabled'), enabled ? 'success' : 'warn')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    busy.value = false
  }
}

// Turning it on is always safe; turning it off is confirmed.
function onClick() {
  if (readOnlyState.enabled) confirmOff.value = true
  else change(true)
}

function disable() {
  confirmOff.value = false
  change(false)
}

watch(() => readOnlyState.enabled, () => nextTick(() => createIcons({ icons })))
onMounted(() => loadReadOnly().catch(() => {}).finally(() => nextTick(() => createIcons({ icons }))))
</script>

<style scoped>
.read-only-toggle.is-on {
  color: var(--yellow);
  border-color: var(--yellow);
  font-weight: 700;
  letter-spacing: .4px;
  text-transform: uppercase;
  font-size: 10px;
}
</style>
