<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title><i data-lucide="trash-2"></i> Confirm Delete</template>
    <p>{{ message }}</p>
    <template #footer>
      <button class="btn danger" @click="$emit('confirm')">Delete</button>
      <button class="btn"        @click="$emit('close')">Cancel</button>
    </template>
  </BaseModal>
</template>

<script setup>
import BaseModal from '../BaseModal.vue'
defineProps({ show: Boolean, message: String })
defineEmits(['confirm', 'close'])
</script>
