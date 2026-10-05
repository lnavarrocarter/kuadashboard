<template>
  <div v-if="state.enabled" ref="root" class="ab" data-test="alerts-bell">
    <button
      class="btn btn-icon ab-button" :class="{ primary: open }" :title="t('advisorAlerts.title')"
      :aria-expanded="open" data-test="alerts-bell-button" @click="toggle"
    >
      <i data-lucide="bell"></i>
      <span v-if="state.unread" class="ab-badge" data-test="alerts-bell-unread">{{ state.unread > 99 ? '99+' : state.unread }}</span>
    </button>
    <div v-if="open" class="ab-panel" role="dialog" :aria-label="t('advisorAlerts.title')">
      <header class="ab-head">
        <strong>{{ t('advisorAlerts.title') }}</strong>
        <button v-if="state.unread" class="btn sm" data-test="alerts-read-all" @click="markRead({ all: true })">{{ t('advisorAlerts.readAll') }}</button>
      </header>
      <p v-if="!state.alerts.length" class="ab-empty">{{ t('advisorAlerts.empty') }}</p>
      <ul v-else class="ab-list">
        <li v-for="alert in state.alerts" :key="alert.id">
          <button :class="['ab-item', alert.severity, { unread: !alert.read }]" :data-test="`alert-${alert.id}`" @click="choose(alert)">
            <i :data-lucide="ALERT_ICONS[alert.type] || 'bell'"></i>
            <span class="ab-text">
              <span class="ab-title">{{ alertTitle(alert, { t, lang: settings.lang }) }}</span>
              <span class="ab-meta">{{ scopeLabel(alert, { t, profileName }) }} · {{ ago(alert.createdAt) }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p class="ab-foot">{{ t('advisorAlerts.foot') }}</p>
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'
import { createIcons, icons } from 'lucide'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import { useAdvisorAlerts } from '../../composables/useAdvisorAlerts'
import { ALERT_ICONS, alertTitle, scopeLabel } from '../../lib/advisorAlerts'

const props = defineProps({
  // Profile id → name, so "AWS · prod" instead of an id.
  profileName: { type: Function, default: id => id },
})

const { t } = useI18n()
const { state, markRead, open: openAlert } = useAdvisorAlerts()
const open = ref(false)
const root = ref(null)
const profileName = id => props.profileName(id)

function toggle() { open.value = !open.value }

function choose(alert) {
  open.value = false
  openAlert(alert)
}

function ago(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (minutes < 1) return t('advisorAlerts.now')
  if (minutes < 60) return t('advisorAlerts.minutesAgo', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('advisorAlerts.hoursAgo', { n: hours })
  return t('advisorAlerts.daysAgo', { n: Math.round(hours / 24) })
}

function onDocumentClick(event) {
  if (open.value && root.value && !root.value.contains(event.target)) open.value = false
}

const refreshIcons = () => nextTick(() => createIcons({ icons }))
onMounted(() => { document.addEventListener('pointerdown', onDocumentClick); refreshIcons() })
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentClick))
onUpdated(refreshIcons)
</script>

<style scoped>
.ab { position: relative; }
.ab-button { position: relative; }
.ab-badge { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--red); color: #fff; font-size: 10px; line-height: 16px; text-align: center; font-weight: 600; }
.ab-panel { position: absolute; top: calc(100% + 6px); right: 0; width: min(380px, calc(100vw - 32px)); max-height: 70vh; display: flex; flex-direction: column; background: var(--bg-panel, var(--bg)); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, .35); z-index: 300; }
.ab-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
.ab-empty { margin: 0; padding: 16px 12px; font-size: 12px; color: var(--text-dim); }
.ab-list { list-style: none; margin: 0; padding: 4px; overflow-y: auto; }
.ab-item { width: 100%; display: flex; gap: 8px; align-items: flex-start; padding: 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; font-size: 12px; }
.ab-item:hover { background: var(--bg-hover); }
.ab-item > svg { width: 15px; height: 15px; flex: none; margin-top: 1px; color: var(--text-dim); }
.ab-item.high > svg { color: var(--red); }
.ab-item.medium > svg { color: var(--yellow); }
.ab-item.info > svg { color: var(--green); }
.ab-item:not(.unread) { opacity: .7; }
.ab-item.unread .ab-title { font-weight: 600; }
.ab-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ab-title { overflow-wrap: anywhere; line-height: 1.4; }
.ab-meta { color: var(--text-dim); font-size: 11px; }
.ab-foot { margin: 0; padding: 8px 12px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-dim); }
</style>
