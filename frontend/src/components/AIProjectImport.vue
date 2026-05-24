<template>
  <div class="ai-main-card">
    <header>
      <h2>Project Bootstrap</h2>
      <p>Importa un repo GitHub o una carpeta local y pide al agente que genere configuración de arranque.</p>
    </header>

    <section class="import-box">
      <label class="field-label">
        GitHub / Git URL
        <input v-model="gitUrl" class="ctrl-input" placeholder="https://github.com/org/repo.git" />
      </label>
      <div class="actions">
        <button class="btn" @click="pickFolder">Seleccionar carpeta local</button>
        <button class="btn primary" @click="askBootstrap" :disabled="!gitUrl.trim() && !localPath">Analizar con IA</button>
      </div>
      <span v-if="localPath" class="text-dim">Local: {{ localPath }}</span>
    </section>

    <pre v-if="result" class="bootstrap-result">{{ result }}</pre>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useAiStore } from '../stores/useAiStore'

const ai = useAiStore()
const gitUrl = ref('')
const localPath = ref('')
const result = ref('')

async function pickFolder() {
  const path = await window.kuaElectron?.openFileDialog?.({
    title: 'Selecciona carpeta de proyecto',
    properties: ['openDirectory'],
  })
  if (path) localPath.value = path
}

async function askBootstrap() {
  ai.agent = 'bootstrap'
  const target = gitUrl.value.trim() || localPath.value
  await ai.sendMessage(`Analiza este proyecto y genera Dockerfile, docker-compose, manifiestos Kubernetes y CI si aplica: ${target}`, {
    project: { gitUrl: gitUrl.value.trim(), localPath: localPath.value },
  })
  result.value = ai.messages.at(-1)?.content || ''
}
</script>

<style scoped>
.ai-main-card {
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
h2, p { margin: 0; }
p { color: var(--text-dim); }
.import-box {
  border: 1px solid var(--border);
  background: var(--bg-alt);
  border-radius: 10px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.actions { display: flex; gap: 8px; }
.bootstrap-result {
  white-space: pre-wrap;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  background: #111827;
  color: #d1d5db;
  overflow: auto;
}
</style>
