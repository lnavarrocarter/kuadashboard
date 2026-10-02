<template>
  <div class="cex">
    <div class="cfn-toolbar">
      <input v-model="search" class="ctrl-input cex-search" :placeholder="t('cfn.exports.search')" />
      <label class="cfn-check"><input v-model="unusedOnly" type="checkbox" /> {{ t('cfn.exports.unusedOnly') }}</label>
      <button class="btn sm" :disabled="loading" :title="t('awsLogs.refresh')" @click="load">↻</button>
    </div>
    <div class="text-dim cex-hint">{{ t('cfn.exports.hint') }}</div>
    <div v-if="error" class="activity-notice">{{ error }}</div>
    <div v-if="data && data.importsChecked < data.exports.length" class="activity-notice">{{ t('cfn.exports.capped', { n: data.importsChecked }) }}</div>
    <div v-if="loading && !data" class="empty-row">{{ t('common.loading') }}</div>
    <div v-else-if="data && !rows.length" class="empty-row">{{ t('cfn.exports.empty') }}</div>
    <table v-else-if="data" class="cloud-table">
      <thead><tr><th>{{ t('cfn.exports.name') }}</th><th>{{ t('cfn.exports.value') }}</th><th>{{ t('cfn.exports.from') }}</th><th>{{ t('cfn.exports.importedBy') }}</th></tr></thead>
      <tbody>
        <tr v-for="e in rows" :key="e.name">
          <td><code>{{ e.name }}</code></td>
          <td class="cex-break text-dim">{{ e.value }}</td>
          <td><button class="cfn-link" @click="emit('open-stack', e.exportingStackId)">{{ e.exportingStack }}</button></td>
          <td>
            <span v-if="e.importError" class="text-dim" :title="e.importError">—</span>
            <span v-else-if="!e.importedBy.length" class="msg-chip">{{ t('cfn.exports.unused') }}</span>
            <span v-for="s in e.importedBy" :key="s" class="cex-stack"><button class="cfn-link" @click="emit('open-stack', s)">{{ s }}</button></span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({ profileId: { type: String, default: '' } })
const emit = defineEmits(['open-stack', 'loaded'])
const { t } = useI18n()
const { apiFetch } = useApi()

const data = ref(null)
const loading = ref(false)
const error = ref(null)
const search = ref('')
const unusedOnly = ref(false)

const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (data.value?.exports || []).filter(e =>
    (!unusedOnly.value || (!e.importedBy.length && !e.importError)) &&
    (!q || `${e.name} ${e.value} ${e.exportingStack} ${e.importedBy.join(' ')}`.toLowerCase().includes(q)))
})

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = await apiFetch('/api/cloud/aws/cloudformation/exports', { headers: { 'X-Profile-Id': props.profileId } })
    emit('loaded', data.value)
  } catch (err) { error.value = err.message } finally { loading.value = false }
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.cex { display: flex; flex-direction: column; gap: 8px; }
.cfn-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cfn-check { display: flex; gap: 4px; align-items: center; font-size: 12px; }
.cex-search { min-width: 220px; flex: 1 1 220px; max-width: 420px; }
.cex-hint { font-size: 11px; }
.cex-break { overflow-wrap: anywhere; white-space: normal; }
.cex-stack:not(:last-child)::after { content: ', '; }
.cfn-link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
</style>
