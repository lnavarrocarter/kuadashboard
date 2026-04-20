<template>
  <BaseModal :show="visible" @close="dismiss">
    <template #title>💛 Apoya KuaDashboard</template>

    <p style="margin-bottom: .8rem; line-height: 1.5;">
      KuaDashboard es un proyecto open-source construido con dedicación.
      Si te resulta útil, considera apoyar su desarrollo con un pequeño aporte.
    </p>
    <p style="margin-bottom: .4rem; color: var(--text-secondary); font-size: .85rem;">
      Tu contribución ayuda a mantener el proyecto activo, agregar nuevas funcionalidades
      y ofrecer soporte a la comunidad.
    </p>

    <template #footer>
      <button class="btn" @click="dismiss">Quizás después</button>
      <button class="btn primary" @click="openSponsor">
        <i data-lucide="heart"></i> Donar en GitHub
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'
import BaseModal from '../BaseModal.vue'

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
