<template>
  <BaseModal :show="visible" @close="dismiss">
    <template #title>{{ variant === 'major' ? t('welcome.v2.title') : t('welcome.title', { v: version }) }}</template>

    <div v-if="variant === 'major'" class="welcome-v2" data-test="welcome-v2">
      <p class="welcome-lead">{{ t('welcome.v2.lead') }}</p>
      <ul class="highlight-list">
        <li v-for="h in HIGHLIGHTS" :key="h.key" class="highlight">
          <i :data-lucide="h.icon"></i>
          <div>
            <strong>{{ t(`welcome.v2.${h.key}.title`) }}</strong>
            <span>{{ t(`welcome.v2.${h.key}.text`) }}</span>
          </div>
        </li>
      </ul>
      <a href="#" class="welcome-link" data-test="welcome-changelog" @click.prevent="openChangelog">{{ t('welcome.v2.changelog') }}</a>
    </div>

    <div v-else class="welcome-changelog">
      <div v-for="(release, idx) in changelog" :key="release.version" class="release-block">
        <h3 class="release-version" v-if="idx > 0">v{{ release.version }}</h3>
        <ul class="change-list">
          <li v-for="(item, i) in release.items" :key="i" class="change-item">
            <span :class="['change-tag', `tag-${item.type}`]">{{ tagLabel(item.type) }}</span>
            <span>{{ localized(item.text, settings.lang) }}</span>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <button ref="primaryBtn" class="btn primary" data-test="welcome-dismiss" @click="dismiss">
        {{ variant === 'major' ? t('welcome.v2.start') : t('welcome.dismiss') }}
      </button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import BaseModal from '../BaseModal.vue'
import { useI18n } from '../../composables/useI18n.js'
import { settings } from '../../composables/useSettings.js'
import { CHANGELOG, CHANGELOG_VERSION, localized } from '../../composables/useChangelog.js'
import { openExternal } from '../../lib/openExternal.js'
import { WELCOME_STORAGE_KEY as STORAGE_KEY, CHANGELOG_URL, welcomeVariant } from '../../lib/welcome.js'

const { t } = useI18n()

const version = CHANGELOG_VERSION

const HIGHLIGHTS = [
  { key: 'plans',        icon: 'layers' },
  { key: 'kuapps',       icon: 'boxes' },
  { key: 'architecture', icon: 'network' },
  { key: 'advisor',      icon: 'shield-check' },
  { key: 'logs',         icon: 'scroll-text' },
]

const visible = ref(false)
const variant = ref(null)
const primaryBtn = ref(null)
let timer = null

// Show only entries from the current version and the two previous ones
const changelog = CHANGELOG.slice(0, 3)

function tagLabel(type) {
  if (type === 'new')    return t('welcome.tagNew')
  if (type === 'better') return t('welcome.tagBetter')
  if (type === 'fix')    return 'Fix'
  return type
}

function openChangelog() {
  openExternal(CHANGELOG_URL)
}

function dismiss() {
  visible.value = false
  localStorage.setItem(STORAGE_KEY, version)
}

function onKeydown(e) {
  if (e.key === 'Escape' && visible.value) dismiss()
}

// BaseModal does not trap focus: move it to the primary action when the welcome opens.
watch(visible, v => {
  if (v) nextTick(() => primaryBtn.value?.focus())
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  variant.value = welcomeVariant(localStorage.getItem(STORAGE_KEY), version)
  if (variant.value) timer = setTimeout(() => { visible.value = true }, 1200)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  clearTimeout(timer)
})
</script>
<style scoped>
.welcome-changelog {
  max-height: 400px;
  overflow-y: auto;
  padding-right: 4px;
}
.release-block { margin-bottom: 16px; }
.release-version {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.change-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.change-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  line-height: 1.5;
}
.change-tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .5px;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}
.tag-new    { background: rgba(78, 201, 176, .18); color: #4ec9b0; }
.tag-better { background: rgba(14, 157, 232, .18); color: #0e9de8; }
.tag-fix    { background: rgba(255, 152, 0, .18);  color: #ff9800; }
.welcome-lead { font-size: 14px; line-height: 1.5; margin: 0 0 14px; }
.highlight-list { list-style: none; padding: 0; margin: 0 0 14px; display: flex; flex-direction: column; gap: 12px; }
.highlight { display: flex; gap: 12px; align-items: flex-start; font-size: 13px; line-height: 1.5; }
.highlight i { width: 20px; height: 20px; flex-shrink: 0; color: var(--accent, #0e9de8); margin-top: 2px; }
.highlight strong { display: block; }
.highlight span { color: var(--text-dim); }
.welcome-link { font-size: 13px; }
@media (prefers-reduced-motion: reduce) {
  .welcome-v2 * { transition: none !important; animation: none !important; }
}</style>
