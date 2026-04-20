<template>
  <div v-if="updateReady" class="update-banner">
    <span>
      <i data-lucide="download"></i>
      Nueva versión <strong>{{ version }}</strong> lista para instalar.
    </span>
    <button class="btn sm primary" @click="install">Reiniciar y actualizar</button>
    <button class="btn sm" @click="updateReady = false">Después</button>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'

const updateReady = ref(false)
const version     = ref('')
let handler       = null

function install() {
  if (window.kuaElectron?.installUpdate) {
    window.kuaElectron.installUpdate()
  }
}

onMounted(() => {
  if (window.kuaElectron?.onUpdateDownloaded) {
    handler = window.kuaElectron.onUpdateDownloaded(info => {
      version.value = info.version
      updateReady.value = true
      nextTick(() => createIcons({ icons }))
    })
  }
})

onUnmounted(() => {
  if (handler && window.kuaElectron?.removeListener) {
    window.kuaElectron.removeListener('update:downloaded', handler)
  }
})
</script>

<style scoped>
.update-banner {
  display: flex;
  align-items: center;
  gap: .75rem;
  padding: .5rem 1rem;
  background: var(--accent, #2563eb);
  color: #fff;
  font-size: .85rem;
  z-index: 1000;
}
.update-banner i {
  width: 16px;
  height: 16px;
  vertical-align: middle;
  margin-right: .25rem;
}
.update-banner .btn {
  font-size: .8rem;
  padding: .25rem .6rem;
}
</style>
