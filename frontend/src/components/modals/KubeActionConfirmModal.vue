<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title><i :data-lucide="spec.icon"></i> {{ t(spec.title) }}</template>
    <div v-if="action" class="kube-action-confirm" data-test="kube-action-confirm">
      <p class="kube-action-question">{{ question }}</p>
      <KubeActionTarget :context="action.context" :namespace="namespace" :resource="resource" />
      <ul v-if="items.length > 1" class="kube-action-items" data-test="kube-action-items">
        <li v-for="item in visibleItems" :key="`${item.namespace}/${item.name}`">{{ item.namespace ? `${item.namespace}/` : '' }}{{ item.name }}</li>
        <li v-if="items.length > visibleItems.length">{{ t('kubeAction.moreItems', { n: items.length - visibleItems.length }) }}</li>
      </ul>
      <p class="kube-action-impact"><strong>{{ t('kubeAction.impact') }}</strong> {{ t(spec.impact) }}</p>
    </div>
    <template #footer>
      <button :class="['btn', spec.danger ? 'danger' : 'primary']" data-test="kube-action-submit" @click="$emit('confirm')">
        {{ t(spec.confirm, { kind: kindLabel, n: items.length }) }}
      </button>
      <button class="btn" @click="$emit('close')">{{ t('action.cancel') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed } from 'vue'
import BaseModal from '../BaseModal.vue'
import KubeActionTarget from './KubeActionTarget.vue'
import { useI18n } from '../../composables/useI18n'
import { kubeKindLabel } from '../../lib/kubeContext'

const props = defineProps({
  show: Boolean,
  // { kind: 'restart'|'cordon'|'uncordon'|'drain'|'delete', type, namespace, name, context, items? }
  // `items` ([{ namespace, name }]) is set for a bulk delete.
  action: { type: Object, default: null },
})
defineEmits(['confirm', 'close'])

const { t } = useI18n()

const SPECS = {
  restart:  { icon: 'rotate-ccw', title: 'kubeAction.restartTitle',  question: 'kubeAction.restartQuestion',  impact: 'kubeAction.restartImpact',  confirm: 'kubeAction.restartConfirm',  danger: false },
  cordon:   { icon: 'lock',       title: 'kubeAction.cordonTitle',   question: 'kubeAction.cordonQuestion',   impact: 'kubeAction.cordonImpact',   confirm: 'kubeAction.cordonConfirm',   danger: false },
  uncordon: { icon: 'unlock',     title: 'kubeAction.uncordonTitle', question: 'kubeAction.uncordonQuestion', impact: 'kubeAction.uncordonImpact', confirm: 'kubeAction.uncordonConfirm', danger: false },
  drain:    { icon: 'arrow-down-to-line', title: 'kubeAction.drainTitle', question: 'kubeAction.drainQuestion', impact: 'kubeAction.drainImpact', confirm: 'kubeAction.drainConfirm', danger: true },
  delete:   { icon: 'trash-2',    title: 'kubeAction.deleteTitle',   question: 'kubeAction.deleteQuestion',   impact: 'kubeAction.deleteImpact',   confirm: 'kubeAction.deleteConfirm',   danger: true },
  deleteMany: { icon: 'trash-2',  title: 'kubeAction.deleteTitle',   question: 'kubeAction.deleteManyQuestion', impact: 'kubeAction.deleteImpact', confirm: 'kubeAction.deleteManyConfirm', danger: true },
}

const items = computed(() => props.action?.items || (props.action ? [{ namespace: props.action.namespace, name: props.action.name }] : []))
const visibleItems = computed(() => items.value.slice(0, 5))
const bulk = computed(() => props.action?.kind === 'delete' && items.value.length > 1)
const spec = computed(() => (bulk.value ? SPECS.deleteMany : SPECS[props.action?.kind]) || SPECS.restart)
const kindLabel = computed(() => kubeKindLabel(props.action?.type, { plural: bulk.value }))
const question = computed(() => t(spec.value.question, { kind: kindLabel.value, name: props.action?.name, n: items.value.length }))

// A bulk delete can span namespaces; the list below shows each one.
const namespace = computed(() => {
  const namespaces = [...new Set(items.value.map(item => item.namespace).filter(Boolean))]
  if (namespaces.length > 1) return t('kubeAction.severalNamespaces', { n: namespaces.length })
  return namespaces[0] || ''
})
const resource = computed(() => (bulk.value
  ? `${items.value.length} ${kindLabel.value}`
  : `${kindLabel.value} / ${props.action?.name || ''}`))
</script>

<style scoped>
.kube-action-question { margin: 0 0 12px; }
.kube-action-items { margin: 0 0 12px; padding-left: 18px; font-family: var(--mono, monospace); font-size: 12px; overflow-wrap: anywhere; }
.kube-action-impact { margin: 0; }
</style>
