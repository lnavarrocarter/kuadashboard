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
        <input v-model="ai.model" class="ctrl-input" placeholder="model e.g. llama3.1:8b" />
        <select v-if="ai.provider !== 'ollama'" v-model="ai.profileId" class="ctrl-select">
          <option value="">No API key profile</option>
          <option v-for="p in ai.providerProfiles" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
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

watch(() => props.visible, v => {
  if (v) nextTick(() => createIcons({ icons }))
})

watch(() => ai.messages.length, () => nextTick(() => createIcons({ icons })))

onMounted(async () => {
  await Promise.allSettled([ai.refreshStatus(), ai.refreshModels()])
  nextTick(() => createIcons({ icons }))
})

function onProviderChange() {
  if (ai.provider === 'ollama' && !ai.model) ai.model = 'llama3.1:8b'
  if (ai.provider === 'openai') ai.model = ai.model || 'gpt-4o-mini'
  if (ai.provider === 'anthropic') ai.model = ai.model || 'claude-3-5-haiku-latest'
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
.ai-config input, .ai-config select:last-child {
  grid-column: span 2;
}
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
