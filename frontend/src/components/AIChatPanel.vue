<template>
  <Transition name="ai-slide">
    <aside v-if="visible" class="ai-panel">
      <header class="ai-header">
        <div>
          <strong>AI Agent</strong>
          <span class="text-dim">{{ subtitle }}</span>
        </div>
        <button class="btn btn-icon" @click="$emit('close')"><i data-lucide="x"></i></button>
      </header>

      <section class="ai-config">
        <select v-model="ai.agent" class="ctrl-select">
          <option value="devops">DevOps</option>
          <option value="bootstrap">Project Bootstrap</option>
          <option value="codeReview">Code Review</option>
          <option value="general">General</option>
        </select>
        <select v-model="ai.provider" class="ctrl-select" @change="onProviderChange">
          <option value="ollama">Ollama local</option>
          <option value="openai">OpenAI / GPT</option>
          <option value="anthropic">Anthropic / Claude</option>
        </select>

        <select v-if="ai.provider !== 'ollama'" v-model="ai.profileId" class="ctrl-select" @change="onProfileChange">
          <option value="">Sin perfil API</option>
          <option v-for="p in ai.providerProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>

        <div class="model-select-wrap" :class="{ 'full-width': ai.provider === 'ollama' }">
          <select v-model="ai.model" class="ctrl-select" :disabled="ai.modelsLoading">
            <option v-if="ai.modelsLoading" value="">Cargando modelos…</option>
            <option v-for="m in ai.models" :key="m.name" :value="m.name">
              {{ m.name }}{{ m.size ? ' (' + formatSize(m.size) + ')' : '' }}
            </option>
            <option v-if="!ai.modelsLoading && !ai.models.length" :value="ai.model">{{ ai.model || '— sin modelos —' }}</option>
          </select>
          <button class="btn btn-icon refresh-btn" :disabled="ai.modelsLoading" @click="reloadModels" title="Recargar modelos">
            <i data-lucide="refresh-cw"></i>
          </button>
        </div>

        <div v-if="ai.provider === 'ollama' && ollamaIndicator" class="ollama-status" :class="ollamaIndicator.cls">
          <i :data-lucide="ollamaIndicator.icon"></i> {{ ollamaIndicator.label }}
        </div>
      </section>

      <main class="ai-messages">
        <div v-if="!ai.messages.length" class="ai-empty">
          <i data-lucide="sparkles"></i>
          <strong>Pregunta sobre tus recursos o comandos</strong>
          <span>Ej: “¿por qué crashea este pod?” o “genera el comando para ver logs de Lambda”.</span>
        </div>
        <article
          v-for="(m, i) in ai.messages"
          :key="i"
          :class="['ai-msg', m.role]"
        >
          <div class="ai-role">{{ m.role === 'user' ? 'Tú' : 'Agente' }}</div>
          <pre>{{ m.content }}</pre>
          <div v-if="m.role === 'assistant'" class="ai-command-list">
            <button
              v-for="cmd in commandsFrom(m.content)"
              :key="cmd"
              class="btn sm"
              @click="$emit('execute-command', cmd)"
            >▶ Ejecutar: {{ cmd }}</button>
          </div>
        </article>
      </main>

      <footer class="ai-input">
        <textarea
          v-model="input"
          class="ctrl-input"
          rows="3"
          placeholder="Escribe una instrucción para el agente..."
          @keydown.ctrl.enter.prevent="send"
        />
        <div class="ai-actions">
          <span v-if="ai.error" class="text-red">{{ ai.error }}</span>
          <button class="btn sm" @click="ai.clearMessages" :disabled="ai.streaming">Limpiar</button>
          <button class="btn primary" @click="send" :disabled="!input.trim() || ai.streaming">
            {{ ai.streaming ? 'Pensando…' : 'Enviar' }}
          </button>
        </div>
      </footer>
    </aside>
  </Transition>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useAiStore } from '../stores/useAiStore'

const props = defineProps({
  visible: { type: Boolean, default: false },
  context: { type: Object, default: () => ({}) },
})
defineEmits(['close', 'execute-command'])

const ai = useAiStore()
const input = ref('')
const subtitle = computed(() => `${ai.agent} · ${ai.provider}:${ai.model}`)

const ollamaIndicator = computed(() => {
  const s = ai.ollamaStatus?.ollama
  if (!s) return null
  if (s.running) return { cls: 'ok', icon: 'circle-check', label: `Ollama ${s.version || 'running'}` }
  return { cls: 'err', icon: 'circle-x', label: 'Ollama no disponible' }
})

watch(() => props.visible, v => {
  if (v) nextTick(() => createIcons({ icons }))
})

watch(() => ai.messages.length, () => nextTick(() => createIcons({ icons })))

onMounted(async () => {
  await Promise.allSettled([ai.refreshStatus(), ai.refreshModels()])
  // Set default model to first in list if current model not found
  if (ai.models.length && !ai.models.find(m => m.name === ai.model)) {
    ai.model = ai.models[0].name
  }
  nextTick(() => createIcons({ icons }))
})

async function onProviderChange() {
  ai.model = ''
  await ai.refreshModels(ai.provider, ai.provider !== 'ollama' ? ai.profileId : undefined)
  if (ai.models.length) ai.model = ai.models[0].name
  nextTick(() => createIcons({ icons }))
}

async function onProfileChange() {
  if (ai.provider === 'ollama') return
  await ai.refreshModels(ai.provider, ai.profileId)
  if (ai.models.length && !ai.models.find(m => m.name === ai.model)) {
    ai.model = ai.models[0].name
  }
  nextTick(() => createIcons({ icons }))
}

async function reloadModels() {
  await ai.refreshModels(ai.provider, ai.provider !== 'ollama' ? ai.profileId : undefined)
  if (ai.models.length && !ai.models.find(m => m.name === ai.model)) {
    ai.model = ai.models[0].name
  }
  nextTick(() => createIcons({ icons }))
}

function formatSize(bytes) {
  if (!bytes) return ''
  const gb = bytes / 1e9
  return gb >= 1 ? `${gb.toFixed(1)}GB` : `${(bytes / 1e6).toFixed(0)}MB`
}

async function send() {
  const text = input.value
  input.value = ''
  await ai.sendMessage(text, props.context)
  nextTick(() => createIcons({ icons }))
}

function commandsFrom(text) {
  const commands = []
  const regex = /```(?:bash|sh|shell|powershell|ps1)?\n([\s\S]*?)```/gi
  let match
  while ((match = regex.exec(text))) {
    for (const line of match[1].split('\n')) {
      const cmd = line.trim()
      if (cmd && !cmd.startsWith('#')) commands.push(cmd)
    }
  }
  return commands.slice(0, 5)
}
</script>

<style scoped>
.ai-panel {
  position: fixed;
  top: 48px;
  right: 12px;
  bottom: 28px;
  z-index: 60;
  width: min(520px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  background: var(--bg, #1e1e1e);
  border: 1px solid var(--border, #333);
  border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0,0,0,.45);
  overflow: hidden;
}
.ai-header, .ai-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}
.ai-header {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border, #333);
}
.ai-header > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ai-config {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border, #333);
}
.model-select-wrap {
  display: flex;
  gap: 4px;
  align-items: center;
}
.model-select-wrap select { flex: 1; }
.model-select-wrap.full-width { grid-column: span 2; }
.refresh-btn { padding: 4px 6px; flex-shrink: 0; }
.ollama-status {
  grid-column: span 2;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 6px;
}
.ollama-status.ok { color: #4ade80; background: rgba(74,222,128,.08); }
.ollama-status.err { color: #f87171; background: rgba(248,113,113,.08); }
.ai-messages {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ai-empty {
  margin: auto;
  text-align: center;
  color: var(--text-dim, #aaa);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ai-msg {
  border: 1px solid var(--border, #333);
  border-radius: 10px;
  padding: 10px;
  background: var(--bg-alt, #252526);
}
.ai-msg.user {
  border-color: rgba(14, 157, 232, .35);
}
.ai-role {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--text-dim, #aaa);
  margin-bottom: 6px;
}
.ai-msg pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  line-height: 1.45;
}
.ai-command-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  margin-top: 10px;
}
.ai-input {
  padding: 12px 14px;
  border-top: 1px solid var(--border, #333);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ai-slide-enter-active, .ai-slide-leave-active { transition: transform .18s ease, opacity .18s ease; }
.ai-slide-enter-from, .ai-slide-leave-to { transform: translateX(24px); opacity: 0; }
</style>
