<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title><i :data-lucide="icon"></i> {{ title }}</template>
    <p>{{ message }}</p>
    <template #footer>
      <button class="btn primary" @click="$emit('confirm')">{{ confirmLabel }}</button>
      <button class="btn" @click="$emit('close')">Cancel</button>
    </template>
  </BaseModal>
</template>

<script setup>
import BaseModal from './BaseModal.vue'
defineProps({
  show: Boolean,
  title: { type: String, default: 'Confirm' },
  message: { type: String, default: '' },
  confirmLabel: { type: String, default: 'Continue' },
  icon: { type: String, default: 'circle-alert' },
})
defineEmits(['confirm', 'close'])
</script>
