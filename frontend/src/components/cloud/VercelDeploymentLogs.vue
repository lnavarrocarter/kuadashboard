<template>
  <Teleport to="body">
    <div class="logs-overlay" @mousedown.self="$emit('close')">
      <div class="logs-panel">
        <div class="logs-header">
          <div>
            <span class="logs-title">{{ t('vercel.logs.title') }}</span>
            <span class="text-dim mono-xs" style="margin-left:8px">{{ deployment.id }}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span v-if="streaming" class="streaming-dot" title="Streaming">●</span>
            <button class="btn sm" @click="clearLogs">{{ t('vercel.logs.clear') }}</button>
            <button class="btn sm" @click="$emit('close')">✕</button>
          </div>
        </div>

        <div class="logs-body" ref="logsBodyRef">
          <div v-if="!entries.length && !error" class="logs-empty">
            {{ streaming ? t('vercel.logs.waiting') : t('vercel.logs.noLogs') }}
          </div>
          <div v-if="error" class="logs-error">{{ error }}</div>
          <div
            v-for="(entry, i) in entries"
            :key="i"
            :class="['log-line', logLineClass(entry)]"
          >
            <span class="log-ts">{{ formatTs(entry.created) }}</span>
            <span class="log-text">{{ entry.text || entry.payload?.text || JSON.stringify(entry.payload || entry) }}</span>
          </div>
        </div>

        <div class="logs-footer">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer">
            <input type="checkbox" v-model="autoScroll" />
            {{ t('vercel.logs.autoScroll') }}
          </label>
          <span class="text-dim" style="font-size:11px">{{ entries.length }} {{ t('vercel.logs.lines') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { useI18n } from '../../composables/useI18n.js'

const props = defineProps({
  deployment: { type: Object, required: true },
  profileId:  { type: String, required: true },
})
const emit = defineEmits(['close'])

const { t }      = useI18n()
const entries    = ref([])
const streaming  = ref(false)
const error      = ref(null)
const autoScroll = ref(true)
const logsBodyRef = ref(null)

let eventSource = null

function startStream() {
  if (eventSource) { eventSource.close(); eventSource = null }
  streaming.value = true
  error.value     = null
  entries.value   = []

  const url = `/api/cloud/vercel/deployments/${encodeURIComponent(props.deployment.id)}/logs`
  const es  = new EventSource(url + `?profileId=${encodeURIComponent(props.profileId)}`)
  eventSource = es

  es.onmessage = (evt) => {
    try {
      const data = JSON.parse(evt.data)
      // Vercel SSE events: { type, created, payload } or { type, text, created }
      if (data.type === 'stdout' || data.type === 'stderr' || data.type === 'command' || data.type === 'deployment-state') {
        entries.value.push(data)
        if (autoScroll.value) scrollToBottom()
      }
    } catch {
      // raw text line
      entries.value.push({ text: evt.data, created: Date.now() })
      if (autoScroll.value) scrollToBottom()
    }
  }

  es.onerror = () => {
    streaming.value = false
    if (eventSource) { eventSource.close(); eventSource = null }
  }
}

// The SSE endpoint requires the profile in the header, but EventSource does not
// support custom headers. We proxy via the backend using a query param as fallback.
// The backend reads X-Profile-Id from the header; here we use a workaround with
// a custom fetch-based SSE approach when EventSource is not sufficient.
// For now, the backend should also accept ?profileId= as a fallback for SSE:
watch(
  () => [props.deployment?.id, props.profileId],
  () => { if (props.deployment?.id && props.profileId) startStream() },
  { immediate: true }
)

onUnmounted(() => {
  if (eventSource) { eventSource.close(); eventSource = null }
})

function clearLogs() { entries.value = [] }

async function scrollToBottom() {
  await nextTick()
  if (logsBodyRef.value) {
    logsBodyRef.value.scrollTop = logsBodyRef.value.scrollHeight
  }
}

function formatTs(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString()
}

function logLineClass(entry) {
  const type = entry.type || ''
  if (type === 'stderr') return 'line-error'
  if (type === 'command') return 'line-command'
  if (type === 'deployment-state') return 'line-state'
  return ''
}
</script>

<style scoped>
.logs-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .55);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 9999;
  padding: 0 16px 16px;
}

.logs-panel {
  width: 100%;
  max-width: 900px;
  height: 55vh;
  background: var(--bg, #13131f);
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border, #333);
  background: var(--bg-alt, #1a1a2e);
}

.logs-title { font-weight: 600; font-size: 14px; }

.streaming-dot {
  color: #4ade80;
  font-size: 12px;
  animation: blink 1.2s infinite;
}
@keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0.2 } }

.logs-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.6;
  background: var(--bg, #13131f);
}

.logs-empty { color: var(--text-dim, #888); padding: 10px 0; }
.logs-error { color: #f87171; padding: 6px 0; }

.log-line { display: flex; gap: 10px; }
.log-ts   { color: var(--text-dim, #555); white-space: nowrap; font-size: 11px; flex-shrink: 0; }
.log-text { color: var(--text, #ddd); white-space: pre-wrap; word-break: break-all; }

.line-error   .log-text { color: #f87171; }
.line-command .log-text { color: #60a5fa; }
.line-state   .log-text { color: #fbbf24; font-weight: 600; }

.logs-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  border-top: 1px solid var(--border, #333);
  background: var(--bg-alt, #1a1a2e);
}
</style>
