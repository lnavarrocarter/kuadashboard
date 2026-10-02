<template>
  <div class="sfnx">
    <div class="sfnx-toolbar">
      <div class="sfnx-tabs" role="tablist" aria-label="Vista de eventos">
        <button role="tab" :aria-selected="mode === 'diagram'" @click="mode = 'diagram'">Diagrama</button>
        <button role="tab" :aria-selected="mode === 'history'" @click="mode = 'history'">Historial ({{ events.length }})</button>
      </div>
      <label v-if="mode === 'diagram' && model.scopes.length > 1" class="sfnx-scope">Rama
        <select v-model="scopeId" @change="selectedId = null; selectedName = ''" aria-label="Rama del diagrama">
          <option v-for="scope in model.scopes" :key="scope.id" :value="scope.id">{{ scope.label }}</option>
        </select>
      </label>
    </div>
    <div v-if="definitionWarning" class="sfnx-warning" role="status">{{ definitionWarning }}</div>
    <div v-if="mode === 'diagram'" class="sfnx-layout">
      <StepFnDiagram :definition="scope?.definition || ''" execution :node-statuses="nodeStatuses" :selected-name="selected && !selected.scopeId ? '' : selectedName" :transitions="transitions" @node-click="selectNode" />
      <aside class="sfnx-inspector" aria-label="Detalle del paso">
        <label class="sfnx-select">Paso / visita
          <select :value="selectedId ?? ''" @change="selectVisit(Number($event.target.value))" aria-label="Paso y visita">
            <option value="" disabled>Seleccionar</option>
            <option v-for="visit in model.visits" :key="visit.id" :value="visit.id">#{{ visit.id }} {{ visit.name }}{{ visit.iteration !== undefined ? ` / Iteracion ${visit.iteration}` : '' }} / {{ statusLabel(visit.status) }}</option>
          </select>
        </label>
        <template v-if="selected">
          <p v-if="!selected.scopeId" class="sfnx-warning">No se pudo asociar esta visita a una rama unica de la definicion. Los detalles corresponden al evento #{{ selected.id }}.</p>
          <div class="sfnx-heading"><h3>{{ selected.name }}</h3><span :class="['sfnx-status', selected.status]">{{ statusLabel(selected.status) }}</span></div>
          <dl class="sfnx-summary">
            <dt>Tipo</dt><dd>{{ selected.type }}</dd>
            <dt>Inicio</dt><dd>{{ date(selected.start) }}</dd>
            <dt>Duracion</dt><dd>{{ duration(selected) }}</dd>
            <template v-if="selected.iteration !== undefined"><dt>Iteracion</dt><dd>{{ selected.iteration }}</dd></template>
            <template v-if="selected.parent"><dt>Contenedor</dt><dd><button class="sfnx-link" @click="selectVisit(selected.parent.id)">{{ selected.parent.name }} #{{ selected.parent.id }}</button></dd></template>
          </dl>
          <div v-if="visitsForNode.length > 1" class="sfnx-visits">
            <label>Visita de este paso
              <select :value="selected.id" @change="selectVisit(Number($event.target.value))" aria-label="Visita del paso">
                <option v-for="(visit, index) in visitsForNode" :key="visit.id" :value="visit.id">{{ index + 1 }} / #{{ visit.id }} / {{ statusLabel(visit.status) }}{{ visit.iteration !== undefined ? ` / Iteracion ${visit.iteration}` : '' }}</option>
              </select>
            </label>
          </div>
          <details v-if="failures.length" open class="sfnx-failure"><summary>Errores ({{ failures.length }})</summary><pre>{{ formatExecutionJson(failures) }}</pre></details>
          <details v-for="field in ['input', 'output']" :key="`${selected.id}-${field}`" open class="sfnx-payload">
            <summary>{{ field === 'input' ? 'Entrada' : 'Salida' }}</summary>
            <pre v-if="selected[field] !== undefined">{{ formatExecutionJson(selected[field]) }}</pre>
            <p v-else class="sfnx-muted">No disponible</p>
          </details>
          <section class="sfnx-step-events"><h4>Eventos del paso ({{ selected.events.length }})</h4>
            <details v-for="item in selected.events" :key="item.id" class="sfnx-event"><summary><span>#{{ item.id }} {{ item.type }}</span><time>{{ date(item.timestamp) }}</time></summary><pre>{{ formatExecutionJson(item) }}</pre></details>
          </section>
        </template>
        <div v-else class="sfnx-muted sfnx-empty"><h3>{{ selectedName || 'Sin paso seleccionado' }}</h3>{{ selectedName ? 'Este paso no tiene visitas en el historial.' : 'No hay estados asociados a los eventos disponibles.' }}</div>
      </aside>
    </div>
    <div v-else class="sfnx-history">
      <details v-for="item in events" :key="item.id" class="sfnx-event"><summary><span>#{{ item.id }} {{ item.type }}</span><time>{{ date(item.timestamp) }}</time></summary><pre>{{ formatExecutionJson(item) }}</pre></details>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import StepFnDiagram from './StepFnDiagram.vue'
import { buildExecution, formatExecutionJson } from '../lib/stepFnExecution'

const props = defineProps({
  events: { type: Array, default: () => [] },
  definition: { type: String, default: '' },
  definitionWarning: { type: String, default: '' },
})
const mode = ref('diagram')
const scopeId = ref('root')
const selectedId = ref(null)
const selectedName = ref('')
const model = computed(() => buildExecution(props.events, props.definition))
const scope = computed(() => model.value.scopes.find(item => item.id === scopeId.value))
const selected = computed(() => model.value.visits.find(item => item.id === selectedId.value))
const visitsForNode = computed(() => model.value.visits.filter(item => item.name === selectedName.value && item.scopeId === selected.value?.scopeId))
const transitions = computed(() => model.value.transitions.filter(item => item.scopeId === scopeId.value))
const nodeStatuses = computed(() => {
  const statuses = Object.fromEntries(model.value.visits.filter(item => item.scopeId === scopeId.value).map(item => [item.name, item.status]))
  if (selected.value?.scopeId === scopeId.value) statuses[selected.value.name] = selected.value.status
  return statuses
})
const failures = computed(() => selected.value?.events.filter(item => /Failed|TimedOut|Aborted$/.test(item.type)) || [])
function statusLabel(status) {
  return { SUCCEEDED: 'Completado', FAILED: 'Fallido', TIMED_OUT: 'Tiempo agotado', RUNNING: 'En curso', ABORTED: 'Interrumpido' }[status] || status
}
function selectVisit(id) {
  const visit = model.value.visits.find(item => item.id === id)
  if (!visit) return
  selectedId.value = visit.id
  selectedName.value = visit.name
  scopeId.value = visit.scopeId || 'root'
}
function selectNode(node) {
  const visits = model.value.visits.filter(item => item.name === node.name && item.scopeId === scopeId.value)
  const visit = visits.findLast(item => ['FAILED', 'TIMED_OUT'].includes(item.status)) || visits.at(-1)
  selectedName.value = node.name
  selectedId.value = visit?.id ?? null
}
function date(value) { return value == null ? '-' : new Date(value).toLocaleString() }
function duration(visit) {
  if (visit.start == null) return '-'
  if (!visit.end && visit.status === 'RUNNING') return 'En curso'
  const milliseconds = new Date(visit.end) - new Date(visit.start)
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '-'
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(2)} s`
}
watch(model, value => {
  if (value.visits.some(item => item.id === selectedId.value)) return
  const initial = value.visits.findLast(item => ['FAILED', 'TIMED_OUT'].includes(item.status)) || value.visits.findLast(item => item.status === 'RUNNING') || value.visits.at(-1)
  if (initial) selectVisit(initial.id)
  else { selectedId.value = null; selectedName.value = ''; scopeId.value = 'root' }
}, { immediate: true })
</script>

<style scoped>
.sfnx { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 10px; color: #ddd; font-size: 12px; }
.sfnx-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; flex-shrink: 0; }
.sfnx-tabs { display: flex; border-bottom: 1px solid #38383e; }
.sfnx-tabs button { background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; color: #a1a1aa; cursor: pointer; }
.sfnx-tabs button[aria-selected="true"] { color: #60a5fa; border-bottom-color: #60a5fa; }
.sfnx-scope { display: flex; gap: 8px; align-items: center; min-width: 0; flex: 1; }
.sfnx select { width: 100%; min-width: 0; max-width: 100%; color: #ddd; background: #18181d; border: 1px solid #414148; border-radius: 4px; padding: 7px; text-overflow: ellipsis; }
.sfnx-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(320px, 1fr); gap: 14px; }
.sfnx-inspector { overflow: auto; min-width: 0; padding: 0 4px 12px 14px; border-left: 1px solid #303038; }
.sfnx-select { display: grid; gap: 6px; color: #a1a1aa; }
.sfnx-heading { display: flex; align-items: start; gap: 10px; justify-content: space-between; margin: 18px 0 12px; flex-wrap: wrap; }
.sfnx h3 { font-size: 16px; margin: 0; overflow-wrap: anywhere; }
.sfnx h4 { font-size: 12px; margin: 16px 0 8px; }
.sfnx-status { font-size: 11px; color: #a1a1aa; }
.sfnx-status.SUCCEEDED { color: #4ade80; }
.sfnx-status.FAILED { color: #f87171; }
.sfnx-status.TIMED_OUT { color: #fbbf24; }
.sfnx-status.RUNNING { color: #60a5fa; }
.sfnx-summary { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 16px; }
.sfnx-summary dt, .sfnx-muted { color: #a1a1aa; }
.sfnx-summary dd { margin: 0; overflow-wrap: anywhere; }
.sfnx-link { background: none; border: 0; padding: 0; color: #60a5fa; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
.sfnx-visits { margin: 12px 0; }
.sfnx-visits label { display: grid; gap: 6px; }
.sfnx details { border-bottom: 1px solid #303038; }
.sfnx summary { padding: 10px 0; cursor: pointer; overflow-wrap: anywhere; }
.sfnx pre { margin: 0 0 10px; padding: 10px; background: #0d0d12; color: #b9cee5; font: 11px/1.6 'JetBrains Mono', 'Fira Code', monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; tab-size: 2; }
.sfnx-failure summary { color: #f87171; }
.sfnx-event summary span { margin-right: 8px; }
.sfnx-event time { color: #a1a1aa; font-size: 10px; }
.sfnx-history { overflow: auto; min-height: 0; }
.sfnx-empty { padding: 18px 0; line-height: 1.7; }
.sfnx-warning { color: #fbbf24; font-size: 11px; }
@media (max-width: 760px) {
  .sfnx-layout { display: flex; flex-direction: column; overflow: auto; }
  .sfnx-layout > .sfn-diagram { height: 340px; flex-shrink: 0; }
  .sfnx-inspector { overflow: visible; border-left: 0; border-top: 1px solid #303038; padding: 12px 0; }
  .sfnx-scope { flex-basis: 100%; }
}
</style>