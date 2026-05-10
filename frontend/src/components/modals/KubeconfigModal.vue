<template>
  <BaseModal :show="show" :wide="true" @close="$emit('close')">
    <template #title><i data-lucide="plus-circle"></i> Import Kubeconfig</template>
    <p class="kubeconfig-hint">Import from a file, register an existing path, or paste kubeconfig YAML content.</p>
    <div class="kubeconfig-actions">
      <button class="btn sm primary" @click="pickFile"><i data-lucide="folder-open"></i> Select file</button>
      <label class="btn sm kubeconfig-file-label">
        <i data-lucide="file-up"></i> Load file
        <input type="file" accept=".yaml,.yml,.conf,.config,text/yaml,text/plain" @change="loadBrowserFile" />
      </label>
    </div>
    <label class="kubeconfig-field">
      Existing kubeconfig path
      <div class="kubeconfig-path-row">
        <input v-model.trim="filePath" class="ctrl-input" placeholder="~/.kube/config or /path/to/kubeconfig.yaml" spellcheck="false" />
        <button class="btn sm" :disabled="loading || !filePath" @click="registerPath">Add path</button>
      </div>
    </label>
    <textarea class="yaml-editor" v-model="content" placeholder="Paste kubeconfig YAML..." spellcheck="false"></textarea>
    <p v-if="error" class="kubeconfig-error">{{ error }}</p>
    <template #footer>
      <button class="btn primary" :disabled="loading || !content.trim()" @click="importConfig">{{ loading ? 'Importing...' : 'Import YAML' }}</button>
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
const filePath = ref('')
const error   = ref('')
const loading = ref(false)

async function finishImport(message) {
  toast(message, 'success')
  await kubeStore.loadContexts()
  await kubeStore.loadNamespaces()
  await kubeStore.loadResources()
  emit('close')
}

async function pickFile() {
  error.value = ''
  const bridge = window.kuaElectron
  if (!bridge?.openFileDialog) {
    error.value = 'Native file picker is only available in the desktop app. Use Load file instead.'
    return
  }
  try {
    const selected = await bridge.openFileDialog({
      title: 'Select kubeconfig file',
      filters: [{ name: 'Kubeconfig / YAML', extensions: ['yaml', 'yml', 'conf', 'config', '*'] }],
      properties: ['openFile'],
    })
    if (!selected) return
    filePath.value = selected
    await registerPath()
  } catch (e) {
    error.value = e.message
  }
}

function loadBrowserFile(event) {
  error.value = ''
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { content.value = String(reader.result || '') }
  reader.onerror = () => { error.value = 'Could not read selected file' }
  reader.readAsText(file)
  event.target.value = ''
}

async function registerPath() {
  error.value = ''
  if (!filePath.value) return
  loading.value = true
  try {
    const result = await api('POST', '/api/kubeconfig/path', { path: filePath.value })
    await finishImport(`Kubeconfig path added (${result.contexts?.length || 0} contexts)`)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function importConfig() {
  error.value = ''
  loading.value = true
  try {
    const result = await api('POST', '/api/kubeconfig/import', { yamlContent: content.value })
    await finishImport(`Kubeconfig imported (${result.added ?? 0} new contexts)`)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>
