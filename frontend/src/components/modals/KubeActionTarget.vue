<template>
  <dl :class="['kube-action-target', { compact }]" data-test="kube-action-target">
    <dt>{{ t('kubeAction.environment') }}</dt>
    <dd><span :class="['kube-env-badge', `env-${environment || 'unknown'}`]" data-test="kube-action-env">{{ t(`kubeAction.env.${environment || 'unknown'}`) }}</span></dd>
    <dt>{{ t('kubeAction.cluster') }}</dt>
    <dd><strong>{{ shortContextName(context) }}</strong></dd>
    <dt>{{ t('kubeAction.context') }}</dt>
    <dd class="kube-action-full" data-test="kube-action-context">{{ context }}</dd>
    <template v-if="namespace">
      <dt>{{ t('kubeAction.namespace') }}</dt>
      <dd data-test="kube-action-namespace">{{ namespace }}</dd>
    </template>
    <template v-if="resource">
      <dt>{{ t('kubeAction.resource') }}</dt>
      <dd class="kube-action-full" data-test="kube-action-resource">{{ resource }}</dd>
    </template>
  </dl>
  <p v-if="environment === 'production' && !compact" class="kube-action-warning" role="alert">
    <i data-lucide="triangle-alert"></i> {{ t('kubeAction.productionWarning') }}
  </p>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { contextEnvironment, shortContextName } from '../../lib/kubeContext'

const props = defineProps({
  context: { type: String, default: '' },
  namespace: { type: String, default: '' },
  resource: { type: String, default: '' },
  // One-line strip for editors, where the full warning would take the space.
  compact: Boolean,
})

const { t } = useI18n()
const environment = computed(() => contextEnvironment(props.context))
</script>

<style scoped>
.kube-action-target {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 6px 14px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.kube-action-target dt { color: var(--text-dim); }
.kube-action-target dd { margin: 0; min-width: 0; }
.kube-action-target.compact {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 6px 10px;
  font-size: 12px;
}
.kube-action-target.compact dt::after { content: ':'; }
.kube-action-full { overflow-wrap: anywhere; font-family: var(--mono, monospace); font-size: 12px; }
.kube-action-warning { display: flex; gap: 6px; align-items: center; margin: 0 0 12px; color: var(--red); font-weight: 600; }
</style>
