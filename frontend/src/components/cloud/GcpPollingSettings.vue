<template>
  <div v-if="open" class="modal-overlay" @click.self="!saving && $emit('close')">
    <div class="modal gps-modal" role="dialog" aria-modal="true" aria-labelledby="gps-title">
      <div class="modal-header gps-header">
        <span id="gps-title" style="font-weight:600">⏱ Sondeo de estados (historial)</span>
        <button class="btn sm" :disabled="saving" @click="$emit('close')">✕</button>
      </div>

      <div class="gps-body">
        <p class="gps-intro">
          Sin sondeo, KUA registra cambios de estado solo cuando abres las listas y cuando haces acciones.
          Con el sondeo activo, revisa los recursos periódicamente aunque no tengas la vista abierta,
          mientras KUA esté en ejecución. Aplica al perfil <strong class="gi-mono">{{ profileId }}</strong>.
        </p>

        <div v-if="loadError" class="alert-error">{{ loadError }}</div>
        <template v-else-if="form">
          <label class="gps-toggle">
            <input v-model="form.enabled" type="checkbox" data-test="poll-enabled" />
            <span>Sondeo en segundo plano {{ form.enabled ? 'activado' : 'desactivado' }}</span>
          </label>

          <div class="gps-grid">
            <label class="gps-field"><span>Intervalo</span>
              <select v-model.number="form.intervalMinutes" class="gps-input" :disabled="!form.enabled" data-test="poll-interval">
                <option v-for="m in INTERVALS" :key="m" :value="m">{{ intervalLabel(m) }}</option>
              </select>
            </label>
            <label class="gps-field"><span>Retención del historial</span>
              <select v-model.number="form.retentionDays" class="gps-input" data-test="poll-retention">
                <option v-for="d in RETENTION" :key="d" :value="d">{{ d }} días</option>
              </select>
            </label>
          </div>

          <fieldset class="gps-types" :disabled="!form.enabled">
            <legend>Recursos a sondear</legend>
            <label v-for="t in TYPES" :key="t.value"><input v-model="form.resourceTypes" type="checkbox" :value="t.value" /> {{ t.label }}</label>
          </fieldset>

          <div class="gps-cost" data-test="poll-cost">
            <strong>{{ callsPerDay.toLocaleString() }}</strong> lecturas de API por día
            <span class="gi-dim">({{ form.resourceTypes.length }} listado(s) por ciclo). Las APIs de listado de Compute, Cloud Run y Cloud SQL no se cobran por llamada, pero cuentan para la cuota del proyecto.</span>
          </div>

          <div class="gps-status gi-dim">
            Última ejecución: {{ settings?.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : 'nunca' }}
            <span v-if="settings?.lastError" class="gps-error"> · error: {{ settings.lastError }}</span>
          </div>
          <div v-if="runResult" class="gps-status" data-test="poll-run-result">
            Sondeo manual: {{ runResult.types?.map(t => t.error ? `${t.type}: error` : `${t.type}: ${t.count}`).join(' · ') || '—' }}
          </div>
        </template>
        <div v-else class="gi-empty">Cargando…</div>

        <div v-if="saveError" class="alert-error">{{ saveError }}</div>
      </div>

      <div class="modal-footer gps-footer">
        <button class="btn sm" :disabled="running || saving || !form" data-test="poll-run" @click="runNow">{{ running ? 'Sondeando…' : 'Sondear ahora' }}</button>
        <span style="flex:1"></span>
        <button class="btn sm" :disabled="saving" @click="$emit('close')">Cancelar</button>
        <button class="btn sm primary" :disabled="saving || !form || (form.enabled && !form.resourceTypes.length)" data-test="poll-save" @click="save">{{ saving ? 'Guardando…' : 'Guardar' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useGcpStore } from '../../stores/useGcpStore'
import './gcpInfo.css'

const props = defineProps({
  open:      { type: Boolean, default: false },
  profileId: { type: String, default: '' },
})
const emit = defineEmits(['close', 'saved'])

const INTERVALS = [5, 10, 15, 30, 60, 180, 360, 720, 1440]
const RETENTION = [7, 30, 90, 180, 365]
const TYPES = [
  { value: 'gcp-vm', label: 'VMs de Compute Engine' },
  { value: 'gcp-cloud-run', label: 'Servicios Cloud Run' },
  { value: 'gcp-sql', label: 'Instancias Cloud SQL' },
]

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
  if (m < 60) return `Cada ${m} minutos`
  if (m === 60) return 'Cada hora'
  if (m < 1440) return `Cada ${m / 60} horas`
  return 'Una vez al día'
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
