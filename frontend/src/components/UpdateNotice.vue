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
import { computed, nextTick, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useUpdateStore } from '../stores/useUpdateStore'

const updateStore = useUpdateStore()
const updateReady = computed(() => updateStore.updateDownloaded)
const version     = computed(() => updateStore.newVersion)

function install() {
  updateStore.installUpdate()
}

watch(updateReady, val => {
  if (val) nextTick(() => createIcons({ icons }))
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
