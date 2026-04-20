<template>
  <!-- Shown only when there are missing tools and the user hasn't dismissed -->
  <div v-if="visible && missing.length" class="cli-notice">
    <div class="cli-notice-header">
      <span class="cli-notice-icon">⚠</span>
      <strong>Missing CLI tools detected</strong>
      <span class="cli-notice-sub text-dim">
        Some features may not work correctly until these tools are installed.
      </span>
      <button class="btn-close cli-dismiss" @click="dismissAll" title="Dismiss">✕</button>
    </div>

    <div class="cli-tools-list">
      <div v-for="tool in missing" :key="tool.id" class="cli-tool-row">
        <div class="cli-tool-info">
          <span class="cli-tool-name">{{ tool.name }}</span>
          <span class="cli-tool-desc text-dim">{{ tool.description }}</span>
        </div>
        <div class="cli-tool-actions">
          <!-- In Electron: uses shell.openExternal via preload bridge -->
          <!-- In browser: normal anchor tag -->
          <a
            v-if="isElectron"
            class="btn sm primary"
            @click.prevent="openExternal(tool.downloadUrl)"
          >Download</a>
          <a
            v-else
            :href="tool.downloadUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn sm primary"
          >Download</a>
          <button class="btn sm" @click="dismiss(tool.id)">Dismiss</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

// Detect if running inside Electron (preload bridge exposes window.kuaElectron)
const isElectron = typeof window !== 'undefined' && !!window.kuaElectron

const tools      = ref([])
const dismissed  = ref(new Set(JSON.parse(localStorage.getItem('cli-dismissed') || '[]')))
const visible    = ref(true)

const missing = computed(() =>
  tools.value.filter(t => !t.installed && !dismissed.value.has(t.id))
)

onMounted(async () => {
  try {
    const res = await fetch('/api/system/tools')
    if (res.ok) tools.value = await res.json()
  } catch {
    // Silently ignore — the notice is best-effort
  }
})

function dismiss(id) {
  dismissed.value.add(id)
  persist()
}

function dismissAll() {
  visible.value = false
}

function persist() {
  localStorage.setItem('cli-dismissed', JSON.stringify([...dismissed.value]))
}

function openExternal(url) {
  // Desktop mode: delegate to Electron's shell.openExternal via preload bridge
  if (window.kuaElectron?.openExternal) {
    window.kuaElectron.openExternal(url)
  }
}
</script>
