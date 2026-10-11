<template>
  <BaseModal :show="blockedNotice.open" @close="closeBlockedNotice">
    <template #title>
      <i :data-lucide="isReadOnly ? 'lock' : 'sparkles'"></i>
      {{ t(isReadOnly ? 'blocked.readOnlyTitle' : 'blocked.planTitle') }}
    </template>
    <div class="blocked-notice" data-test="blocked-notice" :data-kind="blockedNotice.kind">
      <p>{{ body }}</p>
      <p v-if="isReadOnly && readOnlyState.forced" class="text-dim">{{ t('readOnly.forced') }}</p>
      <p v-else-if="isReadOnly" class="text-dim">{{ t('blocked.readOnlyThen') }}</p>
      <p v-else class="text-dim">{{ t('blocked.planThen', { plan: planName }) }}</p>
    </div>
    <template #footer>
      <button class="btn" @click="closeBlockedNotice">{{ t('action.close') }}</button>
      <button v-if="isReadOnly && !readOnlyState.forced" class="btn primary" data-test="blocked-disable-read-only" :disabled="busy" @click="turnOffReadOnly">
        <i data-lucide="lock-open"></i> {{ t('readOnly.disableConfirm') }}
      </button>
      <button v-else-if="!isReadOnly" class="btn primary" data-test="blocked-see-plans" @click="seePlans">
        <i data-lucide="sparkles"></i> {{ t('blocked.seePlans') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from './BaseModal.vue'
import { useI18n } from '../composables/useI18n'
import { useToast } from '../composables/useToast'
import { blockedNotice, closeBlockedNotice } from '../composables/useBlockedNotice'
import { readOnlyState, setReadOnly } from '../composables/useReadOnly'

const { t } = useI18n()
const { toast } = useToast()
const busy = ref(false)

const AREAS = { aws: 'AWS', gcp: 'GCP', vercel: 'Vercel', helm: 'Helm', kubernetes: 'Kubernetes' }
// Features with their own explanation; anything else uses the server message.
const PLAN_FEATURES = new Set(['agents', 'scheduledTasks', 'kuaApps', 'advisor', 'logAutoRefresh', 'auditForwarding'])

const isReadOnly = computed(() => blockedNotice.kind === 'readOnly')
const planName = computed(() => t(`plan.name_${blockedNotice.required || 'pro'}`))
const body = computed(() => {
  if (isReadOnly.value) {
    return blockedNotice.area === 'console'
      ? t('readOnly.refusedTerminal')
      : t('blocked.readOnlyBody', { area: AREAS[blockedNotice.area] || blockedNotice.area })
  }
  if (PLAN_FEATURES.has(blockedNotice.feature)) return t(`blocked.plan.${blockedNotice.feature}`, { limit: blockedNotice.limit ?? 3, plan: planName.value })
  return blockedNotice.message || t('blocked.planGeneric', { plan: planName.value })
})

async function turnOffReadOnly() {
  busy.value = true
  try {
    await setReadOnly(false)
    closeBlockedNotice()
    toast(t('blocked.readOnlyOff'), 'warn')
  } catch (err) {
    toast(err.message, 'error')
  } finally {
    busy.value = false
  }
}

function seePlans() {
  closeBlockedNotice()
  window.dispatchEvent(new CustomEvent('kua:open-help', { detail: { tab: 'account' } }))
}

watch(() => blockedNotice.open, open => { if (open) nextTick(() => createIcons({ icons })) })
</script>

<style scoped>
.blocked-notice p { margin: 0 0 8px; line-height: 1.5; }
</style>
