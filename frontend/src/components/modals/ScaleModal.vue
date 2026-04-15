<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title><i data-lucide="layers"></i> Scale — {{ name }}</template>
    <label class="form-label">Replicas</label>
    <input type="number" class="input" v-model.number="replicas" min="0" max="50" />
    <template #footer>
      <button class="btn primary" @click="$emit('confirm', replicas)">Scale</button>
      <button class="btn"         @click="$emit('close')">Cancel</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'

const props = defineProps({ show: Boolean, name: String, current: Number })
const emit  = defineEmits(['confirm', 'close'])
const replicas = ref(props.current ?? 1)
watch(() => props.current, v => { replicas.value = v ?? 1 })
</script>
