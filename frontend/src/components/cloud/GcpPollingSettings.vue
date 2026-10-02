<template>
  <div v-if="open" class="modal-overlay" @click.self="!saving && $emit('close')">
    <div class="modal gps-modal" role="dialog" aria-modal="true" aria-labelledby="gps-title">
      <div class="modal-header gps-header">
        <span id="gps-title" style="font-weight:600">{{ t('gps.title') }}</span>
        <button class="btn sm" :disabled="saving" @click="$emit('close')">✕</button>
      </div>

      <div class="gps-body">
        <p class="gps-intro">
          {{ t('gps.introPre') }} <strong class="gi-mono">{{ profileId }}</strong>.
        </p>

        <div v-if="loadError" class="alert-error">{{ loadError }}</div>
        <template v-else-if="form">
          <label class="gps-toggle">
            <input v-model="form.enabled" type="checkbox" data-test="poll-enabled" />
            <span>{{ form.enabled ? t('gps.enabled') : t('gps.disabled') }}</span>
          </label>

          <div class="gps-grid">
            <label class="gps-field"><span>{{ t('gps.interval') }}</span>
              <select v-model.number="form.intervalMinutes" class="gps-input" :disabled="!form.enabled" data-test="poll-interval">
                <option v-for="m in INTERVALS" :key="m" :value="m">{{ intervalLabel(m) }}</option>
              </select>
            </label>
            <label class="gps-field"><span>{{ t('gps.retention') }}</span>
              <select v-model.number="form.retentionDays" class="gps-input" data-test="poll-retention">
                <option v-for="d in RETENTION" :key="d" :value="d">{{ t('gps.days', { n: d }) }}</option>
              </select>
            </label>
          </div>

          <fieldset class="gps-types" :disabled="!form.enabled">
            <legend>{{ t('gps.resources') }}</legend>
            <label v-for="type in TYPES" :key="type.value"><input v-model="form.resourceTypes" type="checkbox" :value="type.value" /> {{ t(type.label) }}</label>
          </fieldset>

          <div class="gps-cost" data-test="poll-cost">
            <strong>{{ callsPerDay.toLocaleString() }}</strong> {{ t('gps.callsPerDay') }}
            <span class="gi-dim">{{ t('gps.costHint', { n: form.resourceTypes.length }) }}</span>
          </div>

          <div class="gps-status gi-dim">
            {{ t('gps.lastRun', { when: settings?.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : t('gps.never') }) }}
            <span v-if="settings?.lastError" class="gps-error"> · {{ t('gps.error', { error: settings.lastError }) }}</span>
          </div>
          <div v-if="runResult" class="gps-status" data-test="poll-run-result">
            {{ t('gps.manualRun', { result: runResult.types?.map(item => item.error ? `${item.type}: error` : `${item.type}: ${item.count}`).join(' · ') || '—' }) }}
          </div>
        </template>
        <div v-else class="gi-empty">{{ t('gps.loading') }}</div>

        <div v-if="saveError" class="alert-error">{{ saveError }}</div>
      </div>

      <div class="modal-footer gps-footer">
        <button class="btn sm" :disabled="running || saving || !form" data-test="poll-run" @click="runNow">{{ running ? t('gps.running') : t('gps.runNow') }}</button>
        <span style="flex:1"></span>
        <button class="btn sm" :disabled="saving" @click="$emit('close')">{{ t('gps.cancel') }}</button>
        <button class="btn sm primary" :disabled="saving || !form || (form.enabled && !form.resourceTypes.length)" data-test="poll-save" @click="save">{{ saving ? t('gps.saving') : t('gps.save') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useGcpStore } from '../../stores/useGcpStore'
import { useI18n } from '../../composables/useI18n'
import './gcpInfo.css'

const props = defineProps({
  open:      { type: Boolean, default: false },
  profileId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'saved'])

const INTERVALS = [5, 10, 15, 30, 60, 180, 360, 720, 1440]
const RETENTION = [7, 30, 90, 180, 365]
const TYPES = [
  { value: 'gcp-vm', label: 'gps.type.vm' },
  { value: 'gcp-cloud-run', label: 'gps.type.run' },
  { value: 'gcp-sql', label: 'gps.type.sql' },
]

const { t } = useI18n()
const gcpStore = useGcpStore()
const settings = ref(null)
const form = ref(null)
const loadError = ref('')
const saveError = ref('')
const saving = ref(false)
const running = ref(false)
const runResult = ref(null)

watch(() => props.open, async open => {
  if (!open) return
  form.value = null
  loadError.value = ''
  saveError.value = ''
  runResult.value = null
  try {
    settings.value = await gcpStore.fetchPollSettings()
    form.value = {
      enabled: settings.value.enabled,
      intervalMinutes: settings.value.intervalMinutes,
      resourceTypes: [...settings.value.resourceTypes],
      retentionDays: settings.value.retentionDays,
    }
  } catch (e) {
    loadError.value = e.message
  }
}, { immediate: true })

// Same formula as lib/gcpStatePoller.pollCallsPerDay
const callsPerDay = computed(() => (form.value?.enabled
  ? Math.ceil((24 * 60) / form.value.intervalMinutes) * form.value.resourceTypes.length
  : 0))

function intervalLabel(m) {
  if (m < 60) return t('gps.everyMinutes', { n: m })
  if (m === 60) return t('gps.everyHour')
  if (m < 1440) return t('gps.everyHours', { n: m / 60 })
  return t('gps.daily')
}

async function save() {
  saving.value = true
  saveError.value = ''
  try {
    settings.value = await gcpStore.updatePollSettings(form.value)
    emit('saved', settings.value)
    emit('close')
  } catch (e) {
    saveError.value = e.message
  } finally {
    saving.value = false
  }
}

async function runNow() {
  running.value = true
  saveError.value = ''
  try {
    const res = await gcpStore.runPollNow()
    runResult.value = res
    settings.value = res.settings || settings.value
  } catch (e) {
    saveError.value = e.message
  } finally {
    running.value = false
  }
}
</script>

<style scoped>
.gps-modal { width: 560px; max-width: 96vw; max-height: 90vh; display: flex; flex-direction: column; }
.gps-header { display: flex; justify-content: space-between; align-items: center; }
.gps-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; font-size: 13px; }
.gps-intro { margin: 0; color: var(--text-dim); font-size: 12px; line-height: 1.5; }
.gps-toggle { display: flex; gap: 8px; align-items: center; font-weight: 600; cursor: pointer; }
.gps-toggle input { accent-color: var(--accent); width: 16px; height: 16px; }
.gps-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.gps-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-dim); }
.gps-input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
.gps-types { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; margin: 0; }
.gps-types legend { font-size: 12px; color: var(--text-dim); padding: 0 4px; }
.gps-types[disabled] { opacity: .55; }
.gps-cost { border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 12px; }
.gps-status { font-size: 12px; }
.gps-error { color: var(--red); }
.gps-footer { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-top: 1px solid var(--border); }
@media (max-width: 560px) { .gps-grid { grid-template-columns: 1fr; } }
</style>
