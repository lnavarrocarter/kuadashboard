<template>
  <div class="ai-main-card">
    <header class="ai-main-header">
      <div>
        <h2>Modelos IA</h2>
        <p>Gestiona modelos locales de Ollama y perfiles externos.</p>
      </div>
      <button class="btn" @click="refresh">↻ Refresh</button>
    </header>

    <section class="ai-status">
      <strong>Ollama</strong>
      <span :class="statusClass">{{ statusText }}</span>
      <button v-if="canStart" class="btn sm primary" @click="startOllama">Start Ollama</button>
    </section>

    <section class="ai-pull">
      <input v-model="pullName" class="ctrl-input" placeholder="llama3.1:8b, qwen2.5-coder:7b..." />
      <button class="btn primary" :disabled="!pullName.trim() || pulling" @click="pull">
        {{ pulling ? 'Descargando…' : 'Pull model' }}
      </button>
    </section>

    <section class="model-grid">
      <article v-for="m in ai.models" :key="`${m.provider}:${m.name}`" class="model-card">
        <strong>{{ m.name }}</strong>
        <span>{{ m.provider }}</span>
        <small v-if="m.size">{{ formatSize(m.size) }}</small>
      </article>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useAiStore } from '../stores/useAiStore'

const ai = useAiStore()
const pullName = ref('llama3.1:8b')
const pulling = ref(false)

const status = computed(() => ai.ollamaStatus?.ollama)
const statusText = computed(() => {
  if (!status.value) return 'checking...'
  if (status.value.running) return `running (${status.value.version || 'unknown'})`
  return status.value.error || 'stopped'
})
const statusClass = computed(() => status.value?.running ? 'ok' : 'warn')
const canStart = computed(() => status.value?.installed && !status.value?.running && window.kuaElectron?.startOllama)

onMounted(refresh)

async function refresh() {
  await Promise.allSettled([ai.refreshStatus(), ai.refreshModels()])
}

async function startOllama() {
  await window.kuaElectron?.startOllama?.()
  await refresh()
}

async function pull() {
  pulling.value = true
  try { await ai.pullModel(pullName.value.trim()) }
  finally { pulling.value = false }
}

function formatSize(bytes) {
  const gb = Number(bytes) / 1024 / 1024 / 1024
  return `${gb.toFixed(1)} GB`
}
</script>

<style scoped>
.ai-main-card {
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ai-main-header, .ai-status, .ai-pull {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ai-main-header h2 { margin: 0 0 4px; }
.ai-main-header p { margin: 0; color: var(--text-dim); }
.ai-status, .ai-pull, .model-card {
  border: 1px solid var(--border);
  background: var(--bg-alt);
  border-radius: 10px;
  padding: 12px;
}
.ai-pull input { flex: 1; }
.ok { color: var(--green, #4ade80); }
.warn { color: var(--yellow, #facc15); }
.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.model-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.model-card span, .model-card small { color: var(--text-dim); }
</style>
