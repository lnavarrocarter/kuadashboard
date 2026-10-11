<template>
  <div v-if="visible" class="star-notice" role="status" data-test="star-notice">
    <i data-lucide="star"></i>
    <span>{{ t('starNotice.message') }}</span>
    <button class="btn sm primary" data-test="star-notice-star" @click="giveStar">{{ t('starNotice.action') }}</button>
    <button class="btn sm" data-test="star-notice-later" @click="later">{{ t('starNotice.later') }}</button>
    <button class="btn sm" data-test="star-notice-never" @click="never">{{ t('starNotice.never') }}</button>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../composables/useI18n'
import { settings } from '../composables/useSettings'
import { CHANGELOG_VERSION } from '../composables/useChangelog'
import { openExternal } from '../lib/openExternal'
import {
  STAR_REPO_URL, loadStarState, saveStarState, recordSession, shouldShowStarNotice,
  snoozeStarNotice, neverShowStarNotice, resetStarNotice,
} from '../lib/starNotice'

const WELCOME_SEEN_KEY = 'kuadashboard_last_seen_version'
const { t } = useI18n()
const visible = ref(false)
let welcomePending = false

function evaluate() {
  visible.value = settings.starNotice !== false && !welcomePending && shouldShowStarNotice(loadStarState())
}

function update(change) {
  saveStarState(change(loadStarState()))
}

function giveStar() {
  openExternal(STAR_REPO_URL)
  // A star is a one-way ask: do not ask again after the click.
  never()
}

function later() {
  update(snoozeStarNotice)
  visible.value = false
}

function never() {
  update(neverShowStarNotice)
  settings.starNotice = false
  visible.value = false
}

onMounted(() => {
  // The WelcomeModal opens for a new version; the notice never shares a session with it.
  try { welcomePending = localStorage.getItem(WELCOME_SEEN_KEY) !== CHANGELOG_VERSION } catch { welcomePending = false }
  update(recordSession)
  evaluate()
})

// Re-enabling in Options forgets earlier choices and may show it right away.
watch(() => settings.starNotice, (on, was) => {
  if (on && was === false) update(resetStarNotice)
  evaluate()
})

watch(visible, value => { if (value) nextTick(() => createIcons({ icons })) })
</script>

<style scoped>
.star-notice { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; padding: .45rem 1rem; border-bottom: 1px solid var(--border); font-size: 12px; }
.star-notice i { width: 16px; height: 16px; color: var(--yellow); flex-shrink: 0; }
.star-notice span { flex: 1; min-width: 240px; }
</style>
