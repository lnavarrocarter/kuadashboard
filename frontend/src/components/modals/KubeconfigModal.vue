<template>
  <BaseModal :show="show" :wide="true" @close="$emit('close')">
    <template #title><i data-lucide="plus-circle"></i> Import Kubeconfig</template>
    <p class="kubeconfig-hint">Paste kubeconfig YAML content below to add new contexts.</p>
    <textarea class="yaml-editor" v-model="content" placeholder="Paste kubeconfig YAML..." spellcheck="false"></textarea>
    <p v-if="error" class="kubeconfig-error">{{ error }}</p>
    <template #footer>
      <button class="btn primary" @click="importConfig">Import</button>
      <button class="btn"         @click="$emit('close')">Cancel</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref } from 'vue'
import BaseModal from '../BaseModal.vue'
import { api } from '../../composables/useApi'
import { useToast } from '../../composables/useToast'
import { useKubeStore } from '../../stores/useKubeStore'

const emit  = defineEmits(['close'])
defineProps({ show: Boolean })

const { toast }   = useToast()
const kubeStore   = useKubeStore()
const content = ref('')
const error   = ref('')

async function importConfig() {
  error.value = ''
  try {
    await api('POST', '/api/kubeconfig/import', { content: content.value })
    toast('Kubeconfig imported', 'success')
    await kubeStore.loadContexts()
    emit('close')
  } catch (e) {
    error.value = e.message
  }
}
</script>
