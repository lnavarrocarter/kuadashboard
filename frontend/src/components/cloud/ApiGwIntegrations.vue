<template>
  <Teleport to="body">
    <div v-if="open" class="apigw-backdrop" @mousedown.self="$emit('close')">
      <div class="apigw-modal">

        <div class="apigw-header">
          <div class="apigw-title">
            <span>Routes &amp; Integrations &mdash; {{ apiName }}</span>
            <span v-if="apiType" class="apigw-badge">{{ apiType }}</span>
          </div>
          <button class="apigw-close" @click="$emit('close')">&#x2715;</button>
        </div>

        <div class="apigw-body">
          <div v-if="loading" class="apigw-empty">Loading integrations...</div>
          <div v-else-if="error" class="apigw-error">{{ error }}</div>
          <div v-else-if="!integrations.length" class="apigw-empty">No integrations found.</div>

          <table v-else class="apigw-table">
            <thead>
              <tr>
                <th>Route / Path</th>
                <th>Method</th>
                <th>Type</th>
                <th>Lambda / URI</th>
                <th>Payload</th>
                <th>Timeout</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in integrations" :key="i" class="apigw-row">
                <!-- REST: path + method; HTTP/WS: routeKey -->
                <td class="apigw-path">
                  <span class="mono-sm">{{ row.path || routePath(row.routeKey) }}</span>
                </td>
                <td>
                  <span :class="methodClass(row.method || routeMethod(row.routeKey))">
                    {{ row.method || routeMethod(row.routeKey) || 'ANY' }}
                  </span>
                </td>
                <td>
                  <span v-if="row.type" class="apigw-type">{{ row.type }}</span>
                  <span v-else class="text-dim">-</span>
                </td>
                <td style="max-width:280px">
                  <div v-if="row.lambdaName" class="apigw-lambda">
                    <span class="lambda-icon">&#x03BB;</span>
                    <span class="mono-sm">{{ row.lambdaName }}</span>
                  </div>
                  <div v-else-if="row.uri" class="text-dim mono-xs" style="word-break:break-all">{{ row.uri }}</div>
                  <span v-else class="text-dim">-</span>
                </td>
                <td>
                  <span v-if="row.payloadFormatVersion" class="apigw-badge">v{{ row.payloadFormatVersion }}</span>
                  <span v-else-if="row.passthroughBehavior" class="text-dim" style="font-size:11px">{{ row.passthroughBehavior }}</span>
                  <span v-else class="text-dim">-</span>
                </td>
                <td class="text-dim">
                  {{ row.timeoutMs ? `${row.timeoutMs} ms` : '-' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </div>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  open:         { type: Boolean, default: false },
  apiName:      { type: String,  default: '' },
  apiType:      { type: String,  default: 'REST' },
  loading:      { type: Boolean, default: false },
  error:        { type: String,  default: null },
  integrations: { type: Array,   default: () => [] },
})
defineEmits(['close'])

function routeMethod(routeKey) {
  if (!routeKey) return ''
  const parts = routeKey.split(' ')
  return parts.length >= 2 ? parts[0] : ''
}
function routePath(routeKey) {
  if (!routeKey) return ''
  const parts = routeKey.split(' ')
  return parts.length >= 2 ? parts.slice(1).join(' ') : routeKey
}

const METHOD_COLORS = {
  GET:     '#3fb950',
  POST:    '#58a6ff',
  PUT:     '#d29922',
  PATCH:   '#a371f7',
  DELETE:  '#f85149',
  HEAD:    '#8b949e',
  OPTIONS: '#484f58',
  ANY:     '#8b949e',
}
function methodClass(m) {
  return `method-badge method-${(m || 'ANY').toUpperCase()}`
}
</script>

<style scoped>
.apigw-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,.65);
  display: flex; align-items: center; justify-content: center;
  z-index: 900;
}
.apigw-modal {
  background: #0d1117; border: 1px solid #30363d; border-radius: 10px;
  width: min(96vw, 1000px); max-height: 85vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 24px 60px rgba(0,0,0,.7);
}
.apigw-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px; background: #161b22; border-bottom: 1px solid #21262d;
}
.apigw-title {
  display: flex; align-items: center; gap: 10px;
  font-weight: 600; font-size: .95rem; color: #e6edf3;
}
.apigw-badge {
  background: rgba(88,166,255,.15); color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3); border-radius: 4px;
  padding: 1px 8px; font-size: .75rem;
}
.apigw-close {
  background: none; border: none; color: #8b949e; cursor: pointer;
  font-size: 1rem; padding: 2px 4px; border-radius: 4px;
}
.apigw-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

.apigw-body {
  overflow-y: auto; flex: 1; padding: 14px;
}
.apigw-empty { color: #8b949e; text-align: center; padding: 32px; font-size: .9rem; }
.apigw-error { color: #f85149; padding: 16px; font-size: .87rem; }

.apigw-table {
  width: 100%; border-collapse: collapse; font-size: .83rem;
}
.apigw-table thead th {
  text-align: left; padding: 7px 10px;
  color: #8b949e; border-bottom: 1px solid #21262d;
  white-space: nowrap; font-weight: 500;
}
.apigw-table tbody tr {
  border-bottom: 1px solid #161b22;
  transition: background .1s;
}
.apigw-table tbody tr:hover { background: rgba(255,255,255,.03); }
.apigw-table td { padding: 7px 10px; vertical-align: top; }

.apigw-path .mono-sm { color: #e6edf3; font-family: monospace; }
.apigw-type {
  background: rgba(163,113,247,.15); color: #a371f7;
  border: 1px solid rgba(163,113,247,.3); border-radius: 4px;
  padding: 1px 6px; font-size: .75rem;
}
.apigw-lambda {
  display: flex; align-items: center; gap: 5px;
}
.lambda-icon { color: #f8a131; font-size: .95rem; }

/* method badges */
:deep(.method-badge) {
  display: inline-block; border-radius: 4px; padding: 1px 7px;
  font-size: .73rem; font-weight: 700; font-family: monospace;
}
:deep(.method-GET)     { background: rgba(63,185,80,.18);  color: #3fb950; }
:deep(.method-POST)    { background: rgba(88,166,255,.18); color: #58a6ff; }
:deep(.method-PUT)     { background: rgba(210,153,34,.18); color: #d29922; }
:deep(.method-PATCH)   { background: rgba(163,113,247,.18);color: #a371f7; }
:deep(.method-DELETE)  { background: rgba(248,81,73,.18);  color: #f85149; }
:deep(.method-HEAD)    { background: rgba(139,148,158,.18);color: #8b949e; }
:deep(.method-OPTIONS) { background: rgba(72,79,88,.25);   color: #484f58; }
:deep(.method-ANY)     { background: rgba(139,148,158,.18);color: #8b949e; }
.text-dim  { color: #8b949e; }
.mono-sm   { font-family: monospace; font-size: .82rem; }
.mono-xs   { font-family: monospace; font-size: .75rem; }
</style>
