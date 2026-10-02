<template>
  <div class="cfc" :class="level">
    <p class="cfc-text">{{ message }}</p>
    <label class="cfc-field">
      <span>{{ t('cfn.ops.typeName', { name: stackName }) }}</span>
      <input v-model="typed" class="ctrl-input" :aria-label="t('cfn.ops.typeName', { name: stackName })" autocomplete="off" spellcheck="false" />
    </label>
    <label v-if="requireReason" class="cfc-field">
      <span>{{ t('cfn.ops.reason') }}</span>
      <input v-model="reason" class="ctrl-input" :placeholder="t('cfn.ops.reasonPlaceholder')" />
    </label>
    <div class="cfc-actions">
      <button class="btn sm" :class="level === 'high' ? 'danger' : 'primary'" :disabled="!ready || busy" @click="emit('confirm', { confirm: typed, reason })">{{ busy ? '…' : actionLabel }}</button>
      <button class="btn sm" :disabled="busy" @click="emit('cancel')">{{ t('common.cancel') }}</button>
    </div>
  </div>
</template>

<script setup>
// Typed confirmation for destructive CloudFormation operations. The server
// checks the same rule again; this only avoids sending requests it would refuse.
import { computed, ref } from 'vue'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({
  stackName: { type: String, required: true },
  message: { type: String, default: '' },
  actionLabel: { type: String, required: true },
  level: { type: String, default: 'medium' },
  requireReason: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['confirm', 'cancel'])
const { t } = useI18n()
const typed = ref('')
const reason = ref('')
const ready = computed(() => typed.value === props.stackName && (!props.requireReason || reason.value.trim().length >= 3))
</script>

<style scoped>
.cfc { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border); border-left-width: 3px; border-radius: 6px; }
.cfc.high { border-left-color: var(--red); }
.cfc.medium { border-left-color: var(--yellow); }
.cfc-text { margin: 0; font-size: 12px; }
.cfc-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--text-dim); max-width: 420px; }
.cfc-actions { display: flex; gap: 6px; }
</style>
