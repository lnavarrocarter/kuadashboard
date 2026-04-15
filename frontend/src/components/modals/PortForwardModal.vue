<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title><i data-lucide="cable"></i> Port Forward — {{ label }}</template>

    <!-- Manual mode: shown when opened from pfPanel -->
    <div v-if="manualMode" style="display:flex;gap:8px;margin-bottom:8px">
      <input class="input" v-model="form.namespace" placeholder="namespace" style="flex:1" />
      <input class="input" v-model="form.service"   placeholder="service"   style="flex:2" />
    </div>

    <div style="display:flex;gap:8px;margin-bottom:8px">
      <div style="flex:1">
        <label class="form-label">Remote port</label>
        <input class="input" type="number" v-model.number="form.remotePort" />
      </div>
      <div style="flex:1">
        <label class="form-label">Local port</label>
        <input class="input" type="number" v-model.number="form.localPort" />
      </div>
    </div>

    <p v-if="error" class="kubeconfig-error">{{ error }}</p>

    <template #footer>
      <button class="btn primary" @click="confirm">Forward</button>
      <button class="btn"         @click="$emit('close')">Cancel</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import { usePortForwardStore } from '../../stores/usePortForwardStore'
import { useToast } from '../../composables/useToast'
import { useKubeStore } from '../../stores/useKubeStore'

const props = defineProps({
  show: Boolean,
  namespace: String,
  service: String,
  ports: Array,
  label: String,
  manualMode: Boolean,
})
const emit  = defineEmits(['close', 'started'])

const pfStore   = usePortForwardStore()
const kubeStore = useKubeStore()
const { toast } = useToast()

const error = ref('')
const form  = ref({ namespace: '', service: '', remotePort: '', localPort: '' })

watch(() => props.show, v => {
  if (!v) return
  error.value = ''
  const firstPort = props.ports?.length
    ? (typeof props.ports[0] === 'object' ? props.ports[0].port : props.ports[0])
    : ''
  form.value = {
    namespace:  props.namespace || kubeStore.namespace,
    service:    props.service   || '',
    remotePort: firstPort || '',
    localPort:  firstPort || '',
  }
})

async function confirm() {
  error.value = ''
  const ns  = form.value.namespace
  const svc = form.value.service
  const lp  = parseInt(form.value.localPort,  10)
  const rp  = parseInt(form.value.remotePort, 10)
  if (!ns || !svc) { error.value = 'Namespace y servicio son requeridos.'; return }
  if (!lp || !rp)  { error.value = 'Ambos puertos son requeridos.'; return }
  try {
    const r = await pfStore.start(ns, svc, lp, rp)
    toast(`Port-forward activo: localhost:${r.localPort} → ${r.remotePort}`, 'success')
    emit('close')
    emit('started')
  } catch (e) {
    error.value = e.message
  }
}
</script>
