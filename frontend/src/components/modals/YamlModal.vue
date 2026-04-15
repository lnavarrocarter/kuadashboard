<template>
  <BaseModal :show="show" :wide="true" @close="$emit('close')">
    <template #title><i data-lucide="file-code-2"></i> YAML — {{ title }}</template>
    <textarea class="yaml-editor" v-model="content" spellcheck="false"></textarea>
    <p v-if="error" class="kubeconfig-error">{{ error }}</p>
    <template #footer>
      <button class="btn primary" @click="applyYaml">Apply</button>
      <button class="btn"         @click="$emit('close')">Close</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import { api } from '../../composables/useApi'
import { useToast } from '../../composables/useToast'

const props = defineProps({ show: Boolean, title: String, resourceType: String, namespace: String, name: String })
const emit  = defineEmits(['close'])

const { toast } = useToast()
const content = ref('')
const error   = ref('')

watch(() => props.show, async v => {
  if (!v) return
  content.value = 'Loading…'
  error.value   = ''
  try {
    const url = props.resourceType === 'nodes'
      ? `/api/nodes/${props.name}/yaml`
      : `/api/${props.namespace}/${props.resourceType}/${props.name}/yaml`
    content.value = await api('GET', url)
  } catch (e) {
    content.value = `# Error: ${e.message}`
  }
})

async function applyYaml() {
  error.value = ''
  try {
    await api('PUT', '/api/apply', { yamlContent: content.value })
    toast('Applied successfully', 'success')
    emit('close')
  } catch (e) {
    error.value = e.message
  }
}
</script>
