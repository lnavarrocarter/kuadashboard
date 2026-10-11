<template>
  <!-- Free users are told of the plan change during the 30-day notice of the terms (§11). -->
  <div v-if="visible" class="plan-change-banner" role="status" data-test="plan-change-notice">
    <i data-lucide="calendar-clock"></i>
    <span>{{ t('planChange.message', { date: effectiveDate, limit: transition.limits.kuaApps }) }}</span>
    <a href="#" data-test="plan-change-terms" @click.prevent="openTerms">{{ t('planChange.terms') }}</a>
    <button class="btn sm" data-test="plan-change-plans" @click="seePlans">{{ t('blocked.seePlans') }}</button>
    <button class="btn sm" data-test="plan-change-dismiss" :aria-label="t('action.close')" @click="dismiss">{{ t('planChange.dismiss') }}</button>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../composables/useI18n'
import { usePlan } from '../composables/usePlan'
import { settings } from '../composables/useSettings'
import { openExternal } from '../lib/openExternal'

const LEGAL_SITE = 'https://kuadashboard.navarrocarter.com'
const { t } = useI18n()
const { plan } = usePlan()

const transition = computed(() => plan.value?.transition || null)
// Dismissed once per change: a later change with another date shows again.
const storageKey = computed(() => `kua:planChangeDismissed:${transition.value?.effectiveAt || ''}`)
const dismissed = ref(false)
watch(storageKey, key => {
  try { dismissed.value = localStorage.getItem(key) === '1' } catch { dismissed.value = false }
}, { immediate: true })

const visible = computed(() => !!transition.value && !dismissed.value)
const effectiveDate = computed(() => transition.value
  ? new Date(transition.value.effectiveAt).toLocaleDateString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'long', timeZone: 'UTC' })
  : '')

function dismiss() {
  dismissed.value = true
  try { localStorage.setItem(storageKey.value, '1') } catch { /* private mode */ }
}

function openTerms() {
  openExternal(`${LEGAL_SITE}${settings.lang === 'es' ? '/es' : ''}/terms.html`)
}

function seePlans() {
  window.dispatchEvent(new CustomEvent('kua:open-help', { detail: { tab: 'account' } }))
}

watch(visible, value => { if (value) nextTick(() => createIcons({ icons })) }, { immediate: true })
</script>

<style scoped>
.plan-change-banner { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; padding: .45rem 1rem; border-bottom: 1px solid var(--yellow); font-size: 12px; }
.plan-change-banner i { width: 16px; height: 16px; color: var(--yellow); flex-shrink: 0; }
.plan-change-banner span { flex: 1; min-width: 240px; }
</style>
