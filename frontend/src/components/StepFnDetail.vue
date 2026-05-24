<template>
  <Teleport to="body">
    <div v-if="open" class="sfnd-backdrop" @mousedown.self="$emit('close')">
      <div class="sfnd-modal">

        <!-- Header -->
        <div class="sfnd-header">
          <div class="sfnd-title">
            <span class="sfnd-icon">⚡</span>
            <span>{{ sm?.name }}</span>
            <span v-if="sm?.type" :class="['sfnd-type-badge', sm.type === 'EXPRESS' ? 'express' : 'standard']">{{ sm.type }}</span>
          </div>
          <button class="sfnd-close" @click="$emit('close')">✕</button>
        </div>

        <!-- Tabs -->
        <div class="sfnd-tabs">
          <button v-for="tab in TABS" :key="tab.id"
            :class="['sfnd-tab', { active: activeTab === tab.id }]"
            @click="switchTab(tab.id)">
            {{ tab.label }}
          </button>
          <div class="sfnd-tabs-right">
            <button v-if="!loaded && !loading" class="btn sm" @click="load">Cargar</button>
            <button v-else-if="loaded" class="btn sm" @click="load" :disabled="loading" title="Refrescar">↺</button>
          </div>
        </div>

        <!-- Body -->
        <div class="sfnd-body">

          <div v-if="loading && !loaded" class="sfnd-spinner-wrap">
            <div class="sfnd-spinner"></div>
            <span>Cargando detalles...</span>
          </div>
          <div v-else-if="error && !loaded" class="sfnd-error">{{ error }}</div>

          <template v-else-if="data">

            <!-- ══ DETALLES ════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'details'" class="sfnd-section">
              <div class="sfnd-grid">
                <div class="sfnd-card">
                  <div class="sfnd-card-title">State Machine</div>
                  <dl>
                    <dt>Nombre</dt>
                    <dd>{{ data.name }}</dd>
                    <dt>ARN</dt>
                    <dd class="mono wrap copyable">{{ data.arn }}<button class="copy-btn" @click.stop="copyField(data.arn,'arn')" :title="copiedKey==='arn'?'¡Copiado!':'Copiar'">{{ copiedKey==='arn' ? '✓' : '⧉' }}</button></dd>
                    <dt>Tipo</dt>
                    <dd><span :class="data.type === 'EXPRESS' ? 'status-warn' : 'status-ok'">{{ data.type }}</span></dd>
                    <dt>Estado</dt>
                    <dd><span :class="['sfnd-state', data.status?.toLowerCase()]">{{ data.status || '—' }}</span></dd>
                    <dt>Creado</dt>
                    <dd>{{ fmtDate(data.creationDate) }}</dd>
                  </dl>
                </div>

                <div class="sfnd-card">
                  <div class="sfnd-card-title">IAM y Trazado</div>
                  <dl>
                    <dt>Role ARN</dt>
                    <dd class="mono wrap copyable">{{ data.roleArn || '—' }}<button v-if="data.roleArn" class="copy-btn" @click.stop="copyField(data.roleArn,'role')" :title="copiedKey==='role'?'¡Copiado!':'Copiar'">{{ copiedKey==='role' ? '✓' : '⧉' }}</button></dd>
                    <dt>Tracing</dt>
                    <dd>{{ data.tracingEnabled ? '✅ Habilitado' : '—' }}</dd>
                  </dl>
                </div>

                <div v-if="data.loggingConfig" class="sfnd-card">
                  <div class="sfnd-card-title">Logging</div>
                  <dl>
                    <dt>Nivel</dt>
                    <dd class="mono">{{ data.loggingConfig.level || 'OFF' }}</dd>
                    <dt>Incl. datos exec.</dt>
                    <dd>{{ data.loggingConfig.includeExecutionData ? 'Sí' : 'No' }}</dd>
                    <template v-if="data.loggingConfig.destinations?.length">
                      <dt>Destino CW</dt>
                      <dd class="mono wrap" style="font-size:10px">{{ data.loggingConfig.destinations[0]?.cloudWatchLogsLogGroup?.logGroupArn || '—' }}</dd>
                    </template>
                  </dl>
                </div>

                <div v-if="data.definition" class="sfnd-card sfnd-card-wide">
                  <div class="sfnd-card-title" style="display:flex;justify-content:space-between;align-items:center">
                    <span>Definición ASL</span>
                    <button class="copy-btn" style="font-size:11px;padding:2px 6px" @click.stop="copyField(data.definition,'def')" :title="copiedKey==='def'?'¡Copiado!':'Copiar'">{{ copiedKey==='def' ? '✓ Copiado' : '⧉ Copiar' }}</button>
                  </div>
                  <pre class="sfnd-json">{{ fmtJson(data.definition) }}</pre>
                </div>
              </div>
            </div>

            <!-- ══ DIAGRAMA ════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'diagram'" class="sfnd-section sfnd-diagram-wrap">
              <StepFnDiagram :definition="data.definition" style="flex:1;min-height:0" />
            </div>

            <!-- ══ EJECUCIONES ════════════════════════════════════════════ -->
            <div v-show="activeTab === 'executions'" class="sfnd-section">
              <div v-if="!data.executions?.length" class="sfnd-empty">No se encontraron ejecuciones recientes.</div>
              <table v-else class="sfnd-table">
                <thead><tr>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Inicio</th>
                  <th>Fin</th>
                  <th>Duración</th>
                  <th>Eventos</th>
                </tr></thead>
                <tbody>
                  <tr v-for="ex in data.executions" :key="ex.executionArn"
                    :class="['sfnd-exec-row', { selected: selectedExecution?.executionArn === ex.executionArn }]"
                    @click="selectExecution(ex)">
                    <td class="mono-xs" :title="ex.name">{{ ex.name }}</td>
                    <td><span :class="execStatusClass(ex.status)">{{ ex.status }}</span></td>
                    <td class="text-dim nowrap">{{ fmtDate(ex.startDate) }}</td>
                    <td class="text-dim nowrap">{{ ex.stopDate ? fmtDate(ex.stopDate) : '—' }}</td>
                    <td class="text-dim nowrap">{{ calcDuration(ex.startDate, ex.stopDate) }}</td>
                    <td>
                      <button class="btn sm" @click.stop="viewEvents(ex)" style="font-size:10px">
                        Ver logs
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- ══ EVENTOS ════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'events'" class="sfnd-section">
              <div v-if="!selectedExecution" class="sfnd-empty">Selecciona una ejecución en la pestaña Ejecuciones para ver sus eventos.</div>
              <template v-else>
                <div class="sfnd-events-header">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-size:12px;color:#888">Ejecución:</span>
                    <span class="mono-xs" style="color:#ccc">{{ selectedExecution.name }}</span>
                    <span :class="execStatusClass(selectedExecution.status)">{{ selectedExecution.status }}</span>
                  </div>
                  <button class="btn sm" @click="loadEvents(selectedExecution)" :disabled="eventsLoading">↺ Refrescar</button>
                </div>
                <div v-if="eventsLoading" class="sfnd-spinner-wrap" style="padding:20px 0">
                  <div class="sfnd-spinner"></div>
                  <span>Cargando eventos...</span>
                </div>
                <div v-else-if="eventsError" class="sfnd-error">{{ eventsError }}</div>
                <div v-else-if="!events.length" class="sfnd-empty">No se encontraron eventos.</div>
                <div v-else class="sfnd-events-list">
                  <div v-for="ev in events" :key="ev.id" class="sfnd-event-item" :class="`ev-type-${evCategory(ev.type)}`">
                    <div class="sfnd-event-meta">
                      <span class="sfnd-event-id">#{{ ev.id }}</span>
                      <span class="sfnd-event-type" :class="`ev-badge-${evCategory(ev.type)}`">{{ ev.type }}</span>
                      <span class="sfnd-event-ts text-dim">{{ fmtDate(ev.timestamp) }}</span>
                      <span v-if="ev.previousEventId" class="sfnd-event-prev text-dim">← #{{ ev.previousEventId }}</span>
                    </div>
                    <div v-if="evDetails(ev)" class="sfnd-event-details">
                      <pre class="sfnd-json sfnd-json-sm">{{ fmtJson(JSON.stringify(evDetails(ev))) }}</pre>
                    </div>
                  </div>
                </div>
              </template>
            </div>

            <!-- ══ VERSIONES ══════════════════════════════════════════════ -->
            <div v-show="activeTab === 'versions'" class="sfnd-section" style="flex-direction:row;gap:12px;overflow:hidden">
              <!-- Version list -->
              <div style="min-width:220px;max-width:260px;display:flex;flex-direction:column;gap:0;border-right:1px solid #222;overflow-y:auto">
                <div style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1a1a1a">
                  <span style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.05em">Versiones ({{ versions.length }})</span>
                  <button class="btn sm" @click="loadVersions" :disabled="versionsLoading" style="font-size:10px;padding:2px 6px">↺</button>
                </div>
                <div v-if="versionsLoading" class="sfnd-spinner-wrap" style="padding:16px 0">
                  <div class="sfnd-spinner"></div>
                </div>
                <div v-else-if="versionsError" class="sfnd-error" style="margin:8px">{{ versionsError }}</div>
                <div v-else-if="!versions.length" class="sfnd-empty" style="padding:16px 12px;font-size:12px">Sin versiones publicadas.</div>
                <div v-else>
                  <div v-for="v in versions" :key="v.stateMachineVersionArn"
                    :class="['sfnd-version-item', { selected: selectedVersion?.stateMachineVersionArn === v.stateMachineVersionArn }]"
                    @click="loadVersionDefinition(v)">
                    <div class="sfnd-version-label">
                      <span class="mono-xs" style="font-size:10px">{{ v.stateMachineVersionArn?.split(':').pop() }}</span>
                    </div>
                    <div v-if="v.description" class="sfnd-version-desc text-dim">{{ v.description }}</div>
                    <div class="text-dim" style="font-size:10px">{{ fmtDate(v.creationDate) }}</div>
                  </div>
                </div>
              </div>
              <!-- Version definition -->
              <div style="flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;min-width:0">
                <div v-if="!selectedVersion" class="sfnd-empty" style="padding:24px">Selecciona una versión para ver su definición.</div>
                <template v-else>
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">
                    <span style="font-size:12px;color:#888">Versión: <span class="mono-xs" style="color:#ccc">{{ selectedVersion.stateMachineVersionArn?.split(':').pop() }}</span></span>
                    <div style="display:flex;gap:6px">
                      <button v-if="versionDef" class="copy-btn" style="font-size:11px;padding:2px 6px" @click.stop="copyField(versionDef,'vdef')">{{ copiedKey==='vdef' ? '✓ Copiado' : '⧉ Copiar' }}</button>
                    </div>
                  </div>
                  <div v-if="versionDefLoading" class="sfnd-spinner-wrap" style="padding:20px 0">
                    <div class="sfnd-spinner"></div>
                    <span>Cargando definición...</span>
                  </div>
                  <div v-else-if="versionDefError" class="sfnd-error">{{ versionDefError }}</div>
                  <pre v-else-if="versionDef" class="sfnd-json" style="flex:1;overflow:auto;margin:0">{{ fmtJson(versionDef) }}</pre>
                </template>
              </div>
            </div>

          </template>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, watch } from 'vue'
import { useAwsStore } from '../stores/useAwsStore'
import StepFnDiagram from './StepFnDiagram.vue'

const props = defineProps({
  open:      { type: Boolean, default: false },
  sm:        { type: Object,  default: null },
  profileId: { type: String,  default: '' },
})

defineEmits(['close'])

const awsStore = useAwsStore()

const TABS = [
  { id: 'details',    label: 'Detalles' },
  { id: 'diagram',    label: 'Diagrama' },
  { id: 'executions', label: 'Ejecuciones' },
  { id: 'events',     label: 'Eventos' },
  { id: 'versions',   label: 'Versiones' },
]

const activeTab        = ref('details')
const loading          = ref(false)
const loaded           = ref(false)
const error            = ref(null)
const data             = ref(null)
const copiedKey        = ref('')

const selectedExecution = ref(null)
const eventsLoading     = ref(false)
const eventsError       = ref(null)
const events            = ref([])

const versions          = ref([])
const versionsLoading   = ref(false)
const versionsError     = ref(null)
const selectedVersion   = ref(null)
const versionDef        = ref(null)
const versionDefLoading = ref(false)
const versionDefError   = ref(null)

function switchTab(id) {
  activeTab.value = id
  if (id === 'versions' && !versions.value.length && !versionsLoading.value) loadVersions()
}

async function loadVersions() {
  if (!props.sm?.arn) return
  versionsLoading.value = true; versionsError.value = null; selectedVersion.value = null; versionDef.value = null
  try {
    const res = await awsStore.fetchStepFnVersions(props.sm.arn)
    versions.value = res?.versions ?? []
  } catch (e) {
    versionsError.value = e?.message || 'Error cargando versiones'
  } finally {
    versionsLoading.value = false
  }
}

async function loadVersionDefinition(v) {
  selectedVersion.value = v; versionDef.value = null; versionDefError.value = null
  versionDefLoading.value = true
  try {
    const res = await awsStore.fetchStepFnVersionDefinition(v.stateMachineVersionArn)
    versionDef.value = res?.definition ?? null
    if (!versionDef.value) versionDefError.value = 'No se encontró la definición de esta versión.'
  } catch (e) {
    versionDefError.value = e?.message || 'Error cargando definición'
  } finally {
    versionDefLoading.value = false
  }
}

async function load() {
  if (!props.sm?.arn) return
  loading.value = true; error.value = null
  try {
    const res = await awsStore.fetchStepFnDiagram(props.sm.arn)
    if (!res) throw new Error('No se recibió respuesta de la API')
    const sm = res.stateMachine ?? {}
    data.value = {
      name:          sm.name         ?? props.sm.name,
      arn:           sm.stateMachineArn ?? props.sm.arn,
      type:          sm.type         ?? props.sm.type,
      status:        sm.status       ?? null,
      creationDate:  sm.creationDate ?? props.sm.creationDate,
      roleArn:       sm.roleArn      ?? null,
      definition:    sm.definition   ?? null,
      tracingEnabled: sm.tracingConfiguration?.enabled ?? false,
      loggingConfig: sm.loggingConfiguration ?? null,
      executions:    res.recentExecutions ?? [],
    }
    loaded.value = true
  } catch (e) {
    error.value = e?.message || 'Error cargando detalles'
  } finally {
    loading.value = false
  }
}

async function viewEvents(ex) {
  selectedExecution.value = ex
  activeTab.value = 'events'
  await loadEvents(ex)
}

async function selectExecution(ex) {
  selectedExecution.value = ex
}

async function loadEvents(ex) {
  eventsLoading.value = true; eventsError.value = null; events.value = []
  try {
    const res = await awsStore.fetchStepFnExecutionEvents(ex.executionArn)
    events.value = res?.events ?? []
  } catch (e) {
    eventsError.value = e?.message || 'Error cargando eventos'
  } finally {
    eventsLoading.value = false
  }
}

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d).toLocaleString() } catch { return String(d) }
}

function fmtJson(str) {
  if (!str) return ''
  try { return JSON.stringify(JSON.parse(str), null, 2) } catch { return str }
}

function calcDuration(start, end) {
  if (!start) return '—'
  const s = new Date(start), e = end ? new Date(end) : new Date()
  const ms = e - s
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

function execStatusClass(status) {
  const map = { RUNNING: 'status-ok', SUCCEEDED: 'sfnd-exec-success', FAILED: 'sfnd-exec-fail', TIMED_OUT: 'sfnd-exec-timeout', ABORTED: 'sfnd-exec-abort' }
  return map[status] || 'text-dim'
}

function evCategory(type) {
  if (!type) return 'other'
  const t = type.toLowerCase()
  if (t.includes('failed') || t.includes('fail')) return 'fail'
  if (t.includes('succeed') || t.includes('success') || t.includes('exited')) return 'success'
  if (t.includes('started') || t.includes('entered')) return 'start'
  return 'other'
}

function evDetails(ev) {
  const keys = Object.keys(ev).filter(k => !['id', 'type', 'timestamp', 'previousEventId'].includes(k))
  if (!keys.length) return null
  const obj = {}
  for (const k of keys) { if (ev[k] !== undefined && ev[k] !== null) obj[k] = ev[k] }
  return Object.keys(obj).length ? obj : null
}

function copyField(text, key) {
  if (!text) return
  navigator.clipboard?.writeText(text).catch(() => {})
  copiedKey.value = key
  setTimeout(() => { if (copiedKey.value === key) copiedKey.value = '' }, 1500)
}

// Auto-load when opened
watch(() => props.open, (val) => {
  if (val && !loaded.value) load()
  if (!val) {
    loaded.value = false; data.value = null; error.value = null
    selectedExecution.value = null; events.value = []; eventsError.value = null
    versions.value = []; versionsError.value = null; selectedVersion.value = null; versionDef.value = null
    activeTab.value = 'details'
  }
})

// Reset if SM changes
watch(() => props.sm?.arn, () => {
  loaded.value = false; data.value = null; error.value = null
  selectedExecution.value = null; events.value = []
  versions.value = []; versionsError.value = null; selectedVersion.value = null; versionDef.value = null
  if (props.open) load()
})
</script>

<style scoped>
/* ─── Backdrop ─────────────────────────────────────────────────────────────── */
.sfnd-backdrop {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,.72);
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}

/* ─── Modal ─────────────────────────────────────────────────────────────────── */
.sfnd-modal {
  background: #13131a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  width: min(960px, 96vw);
  height: min(760px, 92vh);
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,.6);
}

/* ─── Header ────────────────────────────────────────────────────────────────── */
.sfnd-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px; border-bottom: 1px solid #222; flex-shrink: 0;
}
.sfnd-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 600; color: #e0e0e0;
  overflow: hidden;
}
.sfnd-icon { font-size: 16px; flex-shrink: 0; }
.sfnd-title > span:nth-child(2) {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sfnd-type-badge {
  flex-shrink: 0; font-size: 10px; font-weight: 700; padding: 2px 7px;
  border-radius: 10px; letter-spacing: .5px;
}
.sfnd-type-badge.standard { background: rgba(34,197,94,.18); color: #4ade80; border: 1px solid #22c55e; }
.sfnd-type-badge.express  { background: rgba(251,146,60,.18); color: #fb923c;  border: 1px solid #f97316; }

.sfnd-close {
  background: none; border: none; color: #666; font-size: 16px;
  cursor: pointer; padding: 4px 8px; border-radius: 4px; flex-shrink: 0;
}
.sfnd-close:hover { background: #222; color: #ccc; }

/* ─── Tabs ──────────────────────────────────────────────────────────────────── */
.sfnd-tabs {
  display: flex; align-items: center; gap: 2px;
  padding: 0 12px; border-bottom: 1px solid #1e1e1e; flex-shrink: 0;
  background: #0f0f14;
}
.sfnd-tab {
  background: none; border: none; color: #666; font-size: 12px;
  padding: 9px 14px; cursor: pointer; border-bottom: 2px solid transparent;
  transition: color .15s, border-color .15s;
}
.sfnd-tab:hover { color: #aaa; }
.sfnd-tab.active { color: #60a5fa; border-bottom-color: #3b82f6; }
.sfnd-tabs-right { margin-left: auto; }

/* ─── Body ──────────────────────────────────────────────────────────────────── */
.sfnd-body {
  flex: 1; min-height: 0; overflow-y: auto; padding: 14px;
  display: flex; flex-direction: column;
}

/* ─── Loading / Error ───────────────────────────────────────────────────────── */
.sfnd-spinner-wrap {
  display: flex; flex-direction: column; align-items: center;
  gap: 10px; padding: 40px; color: #666; font-size: 12px;
}
.sfnd-spinner {
  width: 24px; height: 24px; border-radius: 50%;
  border: 2px solid #333; border-top-color: #60a5fa;
  animation: sfnd-spin 0.7s linear infinite;
}
@keyframes sfnd-spin { to { transform: rotate(360deg); } }
.sfnd-error {
  padding: 16px; background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3);
  border-radius: 6px; color: #f87171; font-size: 12px;
}
.sfnd-empty {
  text-align: center; padding: 40px; color: #555; font-size: 13px;
}

/* ─── Sections ──────────────────────────────────────────────────────────────── */
.sfnd-section { flex: 1; min-height: 0; }
.sfnd-diagram-wrap {
  display: flex; flex-direction: column; height: 100%;
}

/* ─── Cards grid ────────────────────────────────────────────────────────────── */
.sfnd-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.sfnd-card {
  background: #1a1a24; border: 1px solid #252525; border-radius: 6px; padding: 12px;
}
.sfnd-card-wide { grid-column: 1 / -1; }
.sfnd-card-title {
  font-size: 11px; font-weight: 600; color: #60a5fa;
  text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px;
}
dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
dt { font-size: 11px; color: #666; align-self: start; padding-top: 1px; white-space: nowrap; }
dd { font-size: 12px; color: #ccc; margin: 0; word-break: break-word; }

.mono    { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 11px; }
.mono-xs { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 10px; }
.wrap    { word-break: break-all; }
.text-dim { color: #666; }
.nowrap { white-space: nowrap; }

.copyable { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.copy-btn {
  background: none; border: 1px solid #333; border-radius: 3px;
  color: #666; cursor: pointer; padding: 1px 5px; font-size: 10px;
  flex-shrink: 0; line-height: 1.4;
}
.copy-btn:hover { background: #252525; color: #aaa; }

/* ─── Status ────────────────────────────────────────────────────────────────── */
.status-ok  { color: #4ade80; font-size: 11px; font-weight: 600; }
.status-warn { color: #fb923c; font-size: 11px; font-weight: 600; }
.sfnd-state.active   { color: #4ade80; }
.sfnd-state.deleting { color: #f87171; }

/* ─── Pre/JSON ──────────────────────────────────────────────────────────────── */
.sfnd-json {
  background: #0d0d12; border: 1px solid #222; border-radius: 4px;
  padding: 10px; font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px; color: #a5b4fc; overflow: auto; max-height: 340px;
  white-space: pre; margin: 0;
}
.sfnd-json-sm { font-size: 10px; max-height: 180px; color: #94a3b8; }

/* ─── Executions table ──────────────────────────────────────────────────────── */
.sfnd-table {
  width: 100%; border-collapse: collapse; font-size: 12px;
}
.sfnd-table th {
  text-align: left; padding: 6px 10px;
  font-size: 10px; font-weight: 600; color: #666; text-transform: uppercase;
  border-bottom: 1px solid #222; white-space: nowrap;
}
.sfnd-table td { padding: 7px 10px; border-bottom: 1px solid #1a1a1a; vertical-align: middle; }
.sfnd-exec-row { cursor: pointer; transition: background .1s; }
.sfnd-exec-row:hover { background: rgba(96,165,250,.06); }
.sfnd-exec-row.selected { background: rgba(96,165,250,.1); }

.sfnd-exec-success { color: #4ade80; font-size: 11px; font-weight: 600; }
.sfnd-exec-fail    { color: #f87171; font-size: 11px; font-weight: 600; }
.sfnd-exec-timeout { color: #fb923c; font-size: 11px; font-weight: 600; }
.sfnd-exec-abort   { color: #94a3b8; font-size: 11px; font-weight: 600; }

/* ─── Events ────────────────────────────────────────────────────────────────── */
.sfnd-events-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0 12px; flex-wrap: wrap; gap: 8px;
}
.sfnd-events-list {
  display: flex; flex-direction: column; gap: 4px;
}
.sfnd-event-item {
  background: #161620; border: 1px solid #222; border-radius: 5px; padding: 8px 10px;
  border-left-width: 3px;
}
.ev-type-fail    { border-left-color: #ef4444; }
.ev-type-success { border-left-color: #22c55e; }
.ev-type-start   { border-left-color: #3b82f6; }
.ev-type-other   { border-left-color: #334155; }

.sfnd-event-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.sfnd-event-id   { font-size: 10px; color: #444; font-family: monospace; }
.sfnd-event-type { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 8px; }
.ev-badge-fail    { background: rgba(239,68,68,.15);  color: #f87171; }
.ev-badge-success { background: rgba(34,197,94,.15);  color: #4ade80; }
.ev-badge-start   { background: rgba(59,130,246,.15); color: #60a5fa; }
.ev-badge-other   { background: rgba(100,116,139,.15); color: #94a3b8; }

.sfnd-event-ts   { font-size: 10px; }
.sfnd-event-prev { font-size: 10px; }
.sfnd-event-details { margin-top: 6px; }

/* ─── Versions ──────────────────────────────────────────────────────────────── */
.sfnd-version-item {
  padding: 10px 12px; border-bottom: 1px solid #1a1a1a;
  cursor: pointer; transition: background .1s;
}
.sfnd-version-item:hover { background: rgba(96,165,250,.06); }
.sfnd-version-item.selected { background: rgba(96,165,250,.1); }
.sfnd-version-label { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.sfnd-version-desc { font-size: 11px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
