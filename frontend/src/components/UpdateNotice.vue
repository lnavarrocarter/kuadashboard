<template>
  <div v-if="updateReady" class="update-banner">
    <template v-if="!error">
      <span>
        <i data-lucide="download"></i>
        {{ t('updn.newVersion') }} <strong>{{ version }}</strong> {{ t('updn.ready') }}
      </span>
      <button class="btn sm primary" :disabled="installing" @click="install">
        {{ installing ? t('updn.installing') : t('updn.restart') }}
      </button>
      <button class="btn sm" @click="dismiss">{{ t('updn.later') }}</button>
    </template>
    <template v-else>
      <span style="flex:1">
        <i data-lucide="alert-triangle"></i>
        {{ t('updn.error', { error }) }}
      </span>
      <button class="btn sm primary" @click="openReleases">{{ t('updn.manual') }}</button>
      <button class="btn sm" @click="dismiss">{{ t('action.close') }}</button>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useUpdateStore } from '../stores/useUpdateStore'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const updateStore = useUpdateStore()
const updateReady = computed(() => updateStore.updateDownloaded)
const version     = computed(() => updateStore.newVersion)
const installing  = computed(() => updateStore.installing)
const error       = computed(() => updateStore.updateError)

function install() {
  updateStore.installUpdate()
}

function dismiss() {
  updateStore.updateDownloaded = false
  updateStore.updateError = null
}

function openReleases() {
  const url = 'https://github.com/lnavarrocarter/kuadashboard/releases/latest'
  if (window.kuaElectron?.openExternal) window.kuaElectron.openExternal(url)
  else window.open(url, '_blank')
}

watch(updateReady, val => {
  if (val) nextTick(() => createIcons({ icons }))
})
watch(error, val => {
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
