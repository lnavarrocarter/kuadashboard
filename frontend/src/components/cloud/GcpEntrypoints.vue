<template>
  <section class="gcp-entrypoints" data-test="gcp-entrypoints">
    <div class="gcp-entrypoints-header">
      <h3>{{ t('entrypoints.title') }}</h3>
      <button type="button" class="btn sm" :disabled="loading" @click="load">
        {{ t(loading ? 'common.loading' : inventory ? 'action.refresh' : 'entrypoints.load') }}
      </button>
    </div>
    <p class="text-dim">{{ t('gcp.entrypoints.note') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="inventory">
      <p class="text-dim">{{ inventory.projectId }}</p>
      <section v-for="group in inventory.groups" :key="group.source">
        <h4>{{ t('gcp.entrypoints.' + group.source) }}</h4>
        <p v-if="group.status !== 'complete'" role="status" class="text-dim">{{ t('gcp.entrypoints.' + group.status) }}</p>
        <p v-else-if="!group.entries.length" class="text-dim">{{ t('gcp.entrypoints.empty') }}</p>
        <table v-if="group.entries.length" class="cloud-table">
          <thead><tr>
            <th>{{ t('entrypoints.resource') }}</th>
            <th>{{ t('entrypoints.addresses') }}</th>
            <th>{{ t('gcp.entrypoints.destination') }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="entry in group.entries" :key="entry.location + '/' + entry.name">
              <td>{{ entry.name }} <span v-if="entry.location" class="text-dim">· {{ entry.location }}</span></td>
              <td>{{ entry.addresses.join(', ') || '—' }}</td>
              <td>
                <div v-for="destination in entry.destinations" :key="destination">{{ destination }}</div>
                <div v-if="entry.unresolved" class="text-dim">{{ t('gcp.entrypoints.unresolved') }}</div>
                <span v-else-if="!entry.destinations?.length">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </section>
</template>

<script setup>
import { onUnmounted, ref } from 'vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'

const props = defineProps({ profileId: { type: String, required: true } })
const { t } = useI18n()
const inventory = ref(null)
const error = ref('')
const loading = ref(false)
let active = true

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api('GET', '/api/cloud/gcp/entrypoints', undefined, {
      headers: { 'X-Profile-Id': props.profileId },
    })
    if (active) inventory.value = result
  } catch (err) {
    if (active) error.value = err.message
  } finally {
    if (active) loading.value = false
  }
}

onUnmounted(() => { active = false })
</script>

<style scoped>
.gcp-entrypoints { padding: 12px 0; }
.gcp-entrypoints-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.gcp-entrypoints h3 { margin: 0; font-size: 13px; }
.gcp-entrypoints h4 { margin: 12px 0 6px; font-size: 12px; }
.gcp-entrypoints td { overflow-wrap: anywhere; }
</style>
