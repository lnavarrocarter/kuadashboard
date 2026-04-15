<template>
  <div v-if="pfStore.list.length || visible" class="pf-panel" :style="{ display: visible ? 'flex' : 'none' }">
    <div class="pf-panel-header">
      <span class="pf-panel-title">
        <i data-lucide="cable" style="width:14px;height:14px"></i> Port Forwards
      </span>
      <div class="pf-panel-actions">
        <button class="btn sm primary" @click="emit('add')">
          <i data-lucide="plus"></i> Add
        </button>
        <button class="btn sm" @click="emit('close')"><i data-lucide="x"></i></button>
      </div>
    </div>

    <div class="pf-panel-body">
      <p v-if="!pfStore.list.length" class="pf-empty">No active port-forwards</p>
      <div v-for="pf in pfStore.list" :key="pf.localPort" class="pf-item">
        <div class="pf-item-info">
          <span class="pf-item-ns">{{ pf.namespace }}</span>
          <span class="pf-item-name">{{ pf.name }}</span>
          <span class="pf-item-ports">
            <a :href="`http://localhost:${pf.localPort}`" target="_blank" class="pf-open-link">
              localhost:{{ pf.localPort }}
            </a>
            &rarr; {{ pf.remotePort }}
          </span>
        </div>
        <button class="btn sm danger pf-stop-btn" title="Stop" @click="stop(pf.localPort)">
          <i data-lucide="x"></i>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, nextTick, watch } from 'vue'
import { usePortForwardStore } from '../stores/usePortForwardStore'
import { useToast } from '../composables/useToast'
import { createIcons, icons } from 'lucide'

const props = defineProps({ visible: Boolean })
const emit  = defineEmits(['close', 'add'])

const pfStore = usePortForwardStore()
const { toast } = useToast()

async function stop(localPort) {
  try {
    await pfStore.stop(localPort)
    toast(`Port-forward :${localPort} detenido`, 'info')
  } catch (e) {
    toast(e.message, 'error')
  }
}

watch(() => pfStore.list.length, () => nextTick(() => createIcons({ icons })))
onMounted(() => nextTick(() => createIcons({ icons })))
</script>
