<template>
  <div class="aw">
    <div v-if="loading && !data" class="aw-state">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="aw-state error">
      <span>{{ error.message }}</span>
      <button v-if="error.details?.access" class="aw-link" @click="emit('request-access', { access: error.details.access, message: error.message })">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <ul v-else-if="data" class="aw-list">
      <li v-for="a in data.alarms" :key="a.name" :title="a.reason || ''">
        <span :class="['aw-state-badge', a.state?.toLowerCase()]">{{ a.state }}</span>
        <span class="aw-name">{{ a.name }}</span>
      </li>
      <li v-for="name in data.missing || []" :key="name" class="aw-missing">{{ t('awsDashboards.alarmMissing', { name }) }}</li>
    </ul>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useAwsStore } from '../../../stores/useAwsStore'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({
  dashboard: { type: String, required: true },
  index: { type: Number, required: true },
  refreshKey: { type: Number, default: 0 },
})
const emit = defineEmits(['request-access'])

const awsStore = useAwsStore()
const { t } = useI18n()
const data = ref(null)
const loading = ref(false)
const error = ref(null)

async function load() {
  loading.value = true
  try {
    data.value = await awsStore.fetchCwWidgetAlarms(props.dashboard, props.index)
    error.value = null
  } catch (e) {
    error.value = e
  } finally {
    loading.value = false
  }
}

watch(() => [props.dashboard, props.index, props.refreshKey], load, { immediate: true })
</script>

<style scoped>
.aw { height: 100%; overflow: auto; }
.aw-state { font-size: 12px; color: var(--text-dim); display: flex; flex-direction: column; gap: 4px; }
.aw-state.error { color: var(--red); }
.aw-link { border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; padding: 0; align-self: flex-start; }
.aw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
.aw-list li { display: flex; align-items: center; gap: 8px; }
.aw-state-badge { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 9px; border: 1px solid var(--border); color: var(--text-dim); }
.aw-state-badge.alarm { color: var(--red); border-color: color-mix(in srgb, var(--red) 55%, var(--border)); }
.aw-state-badge.ok { color: var(--green); border-color: color-mix(in srgb, var(--green) 55%, var(--border)); }
.aw-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aw-missing { color: var(--text-dim); }
</style>
