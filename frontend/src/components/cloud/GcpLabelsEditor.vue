<template>
  <div class="gi-root">
    <div class="gi-card">
      <div class="gi-card-title">Etiquetas ({{ rows.length }})</div>

      <table v-if="rows.length" class="gi-table gle-table" data-test="label-rows">
        <thead><tr><th>Clave</th><th>Valor</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="row.id">
            <td>
              <input v-model.trim="row.key" class="gle-input" :class="{ invalid: row.key && keyError(row, i) }" placeholder="env" data-test="label-key" :disabled="busy" />
              <div v-if="row.key && keyError(row, i)" class="gle-error">{{ keyError(row, i) }}</div>
            </td>
            <td>
              <input v-model.trim="row.value" class="gle-input" :class="{ invalid: valueError(row) }" placeholder="prod" data-test="label-value" :disabled="busy" />
              <div v-if="valueError(row)" class="gle-error">{{ valueError(row) }}</div>
            </td>
            <td><button class="btn sm" title="Quitar" :disabled="busy" data-test="label-remove" @click="rows.splice(i, 1)">✕</button></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="gi-empty">Sin etiquetas.</div>

      <div class="gle-actions">
        <button class="btn sm" :disabled="busy || rows.length >= maxUser" data-test="label-add" @click="addRow">＋ Agregar etiqueta</button>
        <span class="gi-dim gle-hint">Minúsculas, números, "_" y "-"; la clave empieza con letra; máx. 63 caracteres.</span>
      </div>

      <div v-if="systemLabels.length" class="gle-system">
        <div class="gi-dim">Etiquetas del sistema (solo lectura):</div>
        <span v-for="[k, v] in systemLabels" :key="k" class="gi-chip">{{ k }}={{ v }}</span>
      </div>
    </div>

    <div v-if="dirty" class="gi-card" data-test="label-diff">
      <div class="gi-card-title">Cambios</div>
      <div v-for="(v, k) in diff.added" :key="`a-${k}`" class="gle-diff added">＋ {{ k }}={{ v }}</div>
      <div v-for="(c, k) in diff.changed" :key="`c-${k}`" class="gle-diff changed">✎ {{ k }}: {{ c.from }} → {{ c.to }}</div>
      <div v-for="k in diff.removed" :key="`r-${k}`" class="gle-diff removed">－ {{ k }}</div>
    </div>

    <div v-if="error" class="alert-error" style="margin:0">{{ error }}</div>

    <div class="gle-footer">
      <button class="btn sm" :disabled="!dirty || busy" @click="reset">Descartar</button>
      <button class="btn sm primary" :disabled="!dirty || !valid || busy" data-test="label-save" @click="save">{{ busy ? 'Guardando…' : 'Guardar etiquetas' }}</button>
    </div>
  </div>
</template>

<script setup>
// Edit GCP labels: same rules as the backend (lib/gcpResources.validateLabels);
// system labels (goog-*, domain-prefixed) are shown read-only and never sent.
import { computed, ref, watch } from 'vue'
import './gcpInfo.css'

const props = defineProps({
  labels: { type: Object, default: () => ({}) },
  busy:   { type: Boolean, default: false },
  error:  { type: String, default: '' },
})
const emit = defineEmits(['save'])

const KEY = /^[a-z][a-z0-9_-]{0,62}$/
const VALUE = /^[a-z0-9_-]{0,63}$/
const isSystem = k => /^goog-/.test(k) || /[./]/.test(k)

let seq = 0
const rows = ref([])
const systemLabels = computed(() => Object.entries(props.labels || {}).filter(([k]) => isSystem(k)))
const maxUser = computed(() => 64 - systemLabels.value.length)

function reset() {
  rows.value = Object.entries(props.labels || {})
    .filter(([k]) => !isSystem(k))
    .map(([key, value]) => ({ id: ++seq, key, value: value ?? '' }))
}
watch(() => props.labels, reset, { immediate: true, deep: true })

function addRow() { rows.value.push({ id: ++seq, key: '', value: '' }) }

function keyError(row, index) {
  if (!row.key) return 'Requerida'
  if (isSystem(row.key)) return 'Clave reservada del sistema'
  if (!KEY.test(row.key)) return 'Formato inválido'
  if (rows.value.findIndex(r => r.key === row.key) !== index) return 'Clave duplicada'
  return ''
}
function valueError(row) { return VALUE.test(row.value || '') ? '' : 'Formato inválido' }

const valid = computed(() => rows.value.every((r, i) => !keyError(r, i) && !valueError(r)))
const desired = computed(() => Object.fromEntries(rows.value.map(r => [r.key, r.value || ''])))

const diff = computed(() => {
  const current = Object.fromEntries(Object.entries(props.labels || {}).filter(([k]) => !isSystem(k)))
  const out = { added: {}, changed: {}, removed: [] }
  for (const [k, v] of Object.entries(desired.value)) {
    if (!k) continue
    if (!(k in current)) out.added[k] = v
    else if (current[k] !== v) out.changed[k] = { from: current[k], to: v }
  }
  for (const k of Object.keys(current)) if (!(k in desired.value)) out.removed.push(k)
  return out
})
const dirty = computed(() => Object.keys(diff.value.added).length > 0 || Object.keys(diff.value.changed).length > 0 || diff.value.removed.length > 0)

function save() {
  if (!dirty.value || !valid.value) return
  emit('save', desired.value)
}
</script>

<style scoped>
.gle-table td { vertical-align: top; }
.gle-input { width: 100%; box-sizing: border-box; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); font-family: monospace; font-size: 12px; }
.gle-input.invalid { border-color: var(--red); }
.gle-error { color: var(--red); font-size: 11px; margin-top: 2px; }
.gle-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.gle-hint { font-size: 11px; }
.gle-system { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 12px; }
.gle-diff { font-family: monospace; font-size: 12px; padding: 1px 0; }
.gle-diff.added { color: var(--green); }
.gle-diff.changed { color: var(--yellow); }
.gle-diff.removed { color: var(--red); }
.gle-footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
