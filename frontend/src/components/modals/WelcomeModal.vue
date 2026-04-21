<template>
  <BaseModal :show="visible" @close="dismiss">
    <template #title>{{ t('welcome.title', { v: version }) }}</template>

    <div class="welcome-changelog">
      <div v-for="(release, idx) in changelog" :key="release.version" class="release-block">
        <h3 class="release-version" v-if="idx > 0">v{{ release.version }}</h3>
        <ul class="change-list">
          <li v-for="(item, i) in release.items" :key="i" class="change-item">
            <span :class="['change-tag', `tag-${item.type}`]">{{ tagLabel(item.type) }}</span>
            <span>{{ item.text }}</span>
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <button class="btn primary" @click="dismiss">{{ t('welcome.dismiss') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import BaseModal from '../BaseModal.vue'
import { useI18n } from '../../composables/useI18n.js'
import { CHANGELOG, CHANGELOG_VERSION } from '../../composables/useChangelog.js'

const { t } = useI18n()

const STORAGE_KEY = 'kuadashboard_last_seen_version'
const version = CHANGELOG_VERSION

const visible = ref(false)

// Show only entries from the current version and the two previous ones
const changelog = CHANGELOG.slice(0, 3)

function tagLabel(type) {
  if (type === 'new')    return t('welcome.tagNew')
  if (type === 'better') return t('welcome.tagBetter')
  if (type === 'fix')    return 'Fix'
  return type
}

function dismiss() {
  visible.value = false
  localStorage.setItem(STORAGE_KEY, version)
}

onMounted(() => {
  const lastSeen = localStorage.getItem(STORAGE_KEY)
  if (lastSeen !== version) {
    setTimeout(() => { visible.value = true }, 1200)
  }
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
</style>
