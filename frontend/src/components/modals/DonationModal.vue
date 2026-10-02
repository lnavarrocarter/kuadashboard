<template>
  <BaseModal :show="visible" @close="dismiss">
    <template #title>{{ t('donate.title') }}</template>

    <p style="margin-bottom: .8rem; line-height: 1.5;">
      {{ t('donate.body') }}
    </p>
    <p style="margin-bottom: .4rem; color: var(--text-secondary); font-size: .85rem;">
      {{ t('donate.impact') }}
    </p>

    <template #footer>
      <button class="btn" @click="dismiss">{{ t('donate.later') }}</button>
      <button class="btn primary" @click="openSponsor">
        <i data-lucide="heart"></i> {{ t('donate.github') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from '../BaseModal.vue'
import { useI18n } from '../../composables/useI18n'

const { t } = useI18n()

const STORAGE_KEY = 'kuadashboard_donation_shown'
const SPONSOR_URL = 'https://github.com/sponsors/lnavarrocarter/'

const visible = ref(false)

function dismiss() {
  visible.value = false
  localStorage.setItem(STORAGE_KEY, 'true')
}

function openSponsor() {
  if (window.kuaElectron?.openExternal) {
    window.kuaElectron.openExternal(SPONSOR_URL)
  } else {
    window.open(SPONSOR_URL, '_blank')
  }
  dismiss()
}

onMounted(() => {
  if (!localStorage.getItem(STORAGE_KEY)) {
    // Show after a short delay so the app loads first
    setTimeout(() => {
      visible.value = true
      nextTick(() => createIcons({ icons }))
    }, 2000)
  }
})
</script>
