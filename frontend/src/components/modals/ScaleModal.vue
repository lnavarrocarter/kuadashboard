<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title><i data-lucide="layers"></i> {{ t('kubeAction.scaleTitle', { name }) }}</template>
    <KubeActionTarget :context="context" :namespace="namespace" :resource="`${kubeKindLabel(type)} / ${name}`" />
    <label class="form-label" for="kube-scale-replicas">{{ t('kubeAction.replicas') }}</label>
    <input id="kube-scale-replicas" type="number" class="input" v-model.number="replicas" min="0" max="50" data-test="kube-scale-input" />
    <p class="kube-scale-change" data-test="kube-scale-change">{{ t('kubeAction.scaleChange', { from: current ?? 0, to: replicas }) }}</p>
    <p v-if="replicas === 0" class="kube-scale-zero" role="alert" data-test="kube-scale-zero">
      <i data-lucide="triangle-alert"></i> {{ t('kubeAction.scaleZero') }}
    </p>
    <template #footer>
      <button class="btn primary" data-test="kube-scale-submit" :disabled="!validReplicas" @click="$emit('confirm', replicas)">{{ t('kubeAction.scaleConfirm', { n: replicas }) }}</button>
      <button class="btn" @click="$emit('close')">{{ t('action.cancel') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import KubeActionTarget from './KubeActionTarget.vue'
import { useI18n } from '../../composables/useI18n'
import { kubeKindLabel } from '../../lib/kubeContext'

const props = defineProps({
  show: Boolean,
  name: String,
  current: Number,
  context: { type: String, default: '' },
  namespace: { type: String, default: '' },
  type: { type: String, default: '' },
})
defineEmits(['confirm', 'close'])

const { t } = useI18n()
const replicas = ref(props.current ?? 1)
watch(() => [props.show, props.current], () => { replicas.value = props.current ?? 1 })
const validReplicas = computed(() => Number.isInteger(replicas.value) && replicas.value >= 0)
</script>

<style scoped>
.kube-scale-change { margin: 8px 0 0; color: var(--text-dim); }
.kube-scale-zero { display: flex; gap: 6px; align-items: center; margin: 8px 0 0; color: var(--red); font-weight: 600; }
</style>
