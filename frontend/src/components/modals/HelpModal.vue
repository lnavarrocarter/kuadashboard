<template>
  <BaseModal :show="show" :wide="true" @close="$emit('close')">
    <template #title><i data-lucide="info"></i> KUA ÔÇö Know Unified Administration ┬À v{{ VERSION }}</template>

    <div class="help-layout">

      <!-- ÔöÇÔöÇ Columna izquierda: navegaci├│n ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ -->
      <nav class="help-nav">
        <button v-for="tab in TABS" :key="tab.id"
          :class="['help-nav-item', { active: activeTab === tab.id }]"
          @click="activeTab = tab.id">
          <i :data-lucide="tab.icon"></i>
          {{ tab.label }}
        </button>
      </nav>

      <!-- ÔöÇÔöÇ Contenido ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ -->
      <div class="help-content">

        <!-- About -->
        <div v-show="activeTab === 'about'" class="help-section">
          <div class="about-hero">
            <svg width="36" height="36" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="border-radius:6px;flex-shrink:0">
              <rect width="32" height="32" rx="6" fill="#252526"/>
              <path fill="#0e9de8" d="M7,5 L12,5 L12,13.5 L25,5 L28.5,5 L15.5,16.5 L28.5,27 L25,27 L12,18.5 L12,27 L7,27 Z"/>
            </svg>
            <div>
              <div class="about-title">KUA <span style="font-weight:400;font-size:13px;color:var(--text-dim)">ÔÇö Know Unified Administration</span></div>
              <div class="about-subtitle">{{ t('help.subtitle', { v: VERSION }) }}</div>
            </div>
          </div>

          <!-- Aviso de actualizaci├│n -->
          <div v-if="updateDownloaded" class="update-card update-ready">
            <i data-lucide="download"></i>
            <div class="update-card-body">
              <div class="update-card-title">{{ t('help.updateReady', { v: newVersion }) }}</div>
              <div class="update-card-sub">{{ t('help.updateReadySub') }}</div>
            </div>
            <button class="btn primary sm" @click="installUpdate">
              <i data-lucide="refresh-cw"></i> {{ t('help.restartUpdate') }}
            </button>
          </div>
          <div v-else-if="updateStore.updateError" class="update-card update-error">
            <i data-lucide="alert-triangle"></i>
            <div class="update-card-body">
              <div class="update-card-title">Error al descargar actualizaci├│n</div>
              <div class="update-card-sub">{{ updateStore.updateError }}</div>
            </div>
          </div>
          <div v-else-if="updateAvailable" class="update-card update-pending">
            <i data-lucide="cloud-download"></i>
            <div class="update-card-body">
              <div class="update-card-title">{{ t('help.updatePending', { v: newVersion }) }}</div>
              <div class="update-card-sub">{{ t('help.updatePendingSub') }}</div>
            </div>
          </div>

          <p class="help-p">{{ t('help.description') }}</p>

          <!-- Pillars K / U / A -->
          <div class="about-pillars">
            <div class="about-pillar">
              <div class="pillar-letter" style="color:#0e9de8">K</div>
              <div class="pillar-label">Know</div>
              <div class="pillar-desc">{{ t('help.pillarKDesc') }}</div>
            </div>
            <div class="about-pillar">
              <div class="pillar-letter" style="color:#4ec9b0">U</div>
              <div class="pillar-label">Unified</div>
              <div class="pillar-desc">{{ t('help.pillarUDesc') }}</div>
            </div>
            <div class="about-pillar">
              <div class="pillar-letter" style="color:#ff9800">A</div>
              <div class="pillar-label">Administration</div>
              <div class="pillar-desc">{{ t('help.pillarADesc') }}</div>
            </div>
          </div>

          <div class="about-links">
            <a class="btn" @click="open('https://github.com/lnavarrocarter/kuadashboard')">
              <i data-lucide="github"></i> GitHub
            </a>
            <a class="btn" @click="open('https://github.com/lnavarrocarter/kuadashboard/blob/main/CHANGELOG.md')">
              <i data-lucide="file-text"></i> CHANGELOG
            </a>
            <a class="btn" @click="open('https://github.com/lnavarrocarter/kuadashboard/releases')">
              <i data-lucide="tag"></i> Releases
            </a>
          </div>

          <div class="donate-card">
            <i data-lucide="heart" class="donate-icon"></i>
            <div>
              <div class="donate-title">{{ t('help.donateTitle') }}</div>
              <div class="donate-sub">{{ t('help.donateSub') }}</div>
            </div>
            <button class="btn primary" @click="open('https://github.com/sponsors/lnavarrocarter/')">
              <i data-lucide="heart"></i> Sponsor
            </button>
          </div>
        </div>

        <!-- Releases / Changelog -->
        <div v-show="activeTab === 'releases'" class="help-section">
          <div class="help-section-header">
            <i data-lucide="tag"></i>
            <h3>{{ t('help.releasesTitle') }}</h3>
          </div>
          <div class="release-list">
            <div v-for="rel in CHANGELOG" :key="rel.version" class="release-block">
              <div class="release-head">
                <span class="release-ver">v{{ rel.version }}</span>
                <span v-if="rel.version === VERSION" class="release-current">{{ t('help.current') }}</span>
                <span class="release-date text-dim">{{ rel.date }}</span>
              </div>
              <ul class="change-list">
                <li v-for="(item, i) in rel.items" :key="i" class="change-item">
                  <span :class="['change-tag', `tag-${item.type}`]">{{ tagLabel(item.type) }}</span>
                  <span>{{ item.text }}</span>
                </li>
              </ul>
            </div>
          </div>
          <div class="help-footer-link">
            <a class="btn sm" @click="open('https://github.com/lnavarrocarter/kuadashboard/releases')">
              <i data-lucide="external-link"></i> {{ t('help.allReleases') }}
            </a>
          </div>
        </div>

        <!-- Opciones / Settings -->
        <div v-show="activeTab === 'options'" class="help-section">
          <div class="help-section-header">
            <i data-lucide="settings"></i>
            <h3>{{ t('help.optionsTitle') }}</h3>
          </div>

          <!-- Apariencia -->
          <div class="opts-group">
            <div class="opts-group-title">{{ t('help.appearance') }}</div>

            <div class="opts-row">
              <div class="opts-label">
                <i data-lucide="sun-moon"></i>
                <span>{{ t('help.themeLabel') }}</span>
                <span class="opts-desc">{{ t('help.themeDesc') }}</span>
              </div>
              <div class="btn-toggle-group">
                <button :class="['btn','sm', settings.theme === 'dark' ? 'active' : '']" @click="settings.theme = 'dark'">
                  <i data-lucide="moon"></i> {{ t('help.themeDark') }}
                </button>
                <button :class="['btn','sm', settings.theme === 'light' ? 'active' : '']" @click="settings.theme = 'light'">
                  <i data-lucide="sun"></i> {{ t('help.themeLight') }}
                </button>
              </div>
            </div>

            <div class="opts-row">
              <div class="opts-label">
                <i data-lucide="type"></i>
                <span>{{ t('help.fontSizeLabel') }}</span>
                <span class="opts-desc">{{ t('help.fontSizeDesc') }}</span>
              </div>
              <div class="btn-toggle-group">
                <button :class="['btn','sm', settings.fontSize === 'small' ? 'active' : '']" @click="settings.fontSize = 'small'">{{ t('help.fontSmall') }}</button>
                <button :class="['btn','sm', settings.fontSize === 'normal' ? 'active' : '']" @click="settings.fontSize = 'normal'">{{ t('help.fontNormal') }}</button>
                <button :class="['btn','sm', settings.fontSize === 'large' ? 'active' : '']" @click="settings.fontSize = 'large'">{{ t('help.fontLarge') }}</button>
              </div>
            </div>

            <div class="opts-row">
              <div class="opts-label">
                <i data-lucide="palette"></i>
                <span>{{ t('help.accentLabel') }}</span>
                <span class="opts-desc">{{ t('help.accentDesc') }}</span>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button v-for="c in ACCENT_OPTIONS" :key="c.id"
                  :title="c.label"
                  :style="{ width:'22px', height:'22px', borderRadius:'50%', border: settings.accentColor === c.id ? '2px solid var(--text)' : '2px solid transparent', background: c.color, cursor: 'pointer', flexShrink: 0 }"
                  @click="settings.accentColor = c.id" />
              </div>
            </div>

            <div class="opts-row">
              <div class="opts-label">
                <i data-lucide="rows-3"></i>
                <span>{{ t('help.compactLabel') }}</span>
                <span class="opts-desc">{{ t('help.compactDesc') }}</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="settings.compactMode" />
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>

          <!-- Interfaz -->
          <div class="opts-group">
            <div class="opts-group-title">{{ t('help.interfaceGroup') }}</div>

            <div class="opts-row">
              <div class="opts-label">
                <i data-lucide="clock"></i>
                <span>{{ t('help.clockLabel') }}</span>
                <span class="opts-desc">{{ t('help.clockDesc') }}</span>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" v-model="settings.showClock" />
                <span class="toggle-track"></span>
              </label>
            </div>

            <div class="opts-row">
              <div class="opts-label">
                <i data-lucide="refresh-cw"></i>
                <span>{{ t('help.autoRefreshLabel') }}</span>
                <span class="opts-desc">{{ t('help.autoRefreshDesc') }}</span>
              </div>
              <select v-model.number="settings.autoRefresh" class="ctrl-select" style="width:130px;font-size:12px">
                <option :value="0">{{ t('help.autoRefreshOff') }}</option>
                <option :value="30">{{ t('help.autoRefresh30s') }}</option>
                <option :value="60">{{ t('help.autoRefresh1m') }}</option>
                <option :value="120">{{ t('help.autoRefresh2m') }}</option>
                <option :value="300">{{ t('help.autoRefresh5m') }}</option>
              </select>
            </div>

            <div class="opts-row">
              <div class="opts-label">
                <i data-lucide="languages"></i>
                <span>{{ t('help.langLabel') }}</span>
                <span class="opts-desc">{{ t('help.langDesc') }}</span>
              </div>
              <div class="btn-toggle-group">
                <button :class="['btn','sm', settings.lang === 'es' ? 'active' : '']" @click="settings.lang = 'es'">­ƒç¬­ƒç© Espa├▒ol</button>
                <button :class="['btn','sm', settings.lang === 'en' ? 'active' : '']" @click="settings.lang = 'en'">­ƒç║­ƒç© English</button>
              </div>
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
            <button class="btn sm" @click="resetSettings">{{ t('help.resetSettings') }}</button>
          </div>
        </div>

        <!-- Reportar issue / sugerencia -->
        <div v-show="activeTab === 'feedback'" class="help-section">
          <div class="help-section-header">
            <i data-lucide="message-square"></i>
            <h3>{{ t('help.feedbackTitle') }}</h3>
          </div>
          <p class="help-p">{{ t('help.feedbackDesc') }}</p>

          <div class="feedback-cards">
            <div class="feedback-card" @click="open('https://github.com/lnavarrocarter/kuadashboard/issues/new?template=bug_report.md')">
              <i data-lucide="bug" class="feedback-icon red"></i>
              <div>
                <div class="feedback-title">{{ t('help.reportBug') }}</div>
                <div class="feedback-sub">{{ t('help.reportBugSub') }}</div>
              </div>
              <i data-lucide="chevron-right" class="feedback-arrow"></i>
            </div>
            <div class="feedback-card" @click="open('https://github.com/lnavarrocarter/kuadashboard/issues/new?template=feature_request.md')">
              <i data-lucide="lightbulb" class="feedback-icon yellow"></i>
              <div>
                <div class="feedback-title">{{ t('help.suggestFeature') }}</div>
                <div class="feedback-sub">{{ t('help.suggestFeatureSub') }}</div>
              </div>
              <i data-lucide="chevron-right" class="feedback-arrow"></i>
            </div>
            <div class="feedback-card" @click="open('https://github.com/lnavarrocarter/kuadashboard/discussions')">
              <i data-lucide="message-circle" class="feedback-icon blue"></i>
              <div>
                <div class="feedback-title">{{ t('help.discussions') }}</div>
                <div class="feedback-sub">{{ t('help.discussionsSub') }}</div>
              </div>
              <i data-lucide="chevron-right" class="feedback-arrow"></i>
            </div>
          </div>

          <div class="donate-card" style="margin-top:20px">
            <i data-lucide="heart" class="donate-icon"></i>
            <div>
              <div class="donate-title">{{ t('help.supportDev') }}</div>
              <div class="donate-sub">{{ t('help.supportDevSub') }}</div>
            </div>
            <button class="btn primary" @click="open('https://github.com/sponsors/lnavarrocarter/')">
              <i data-lucide="heart"></i> Sponsor
            </button>
          </div>
        </div>

      </div>
    </div>

    <template #footer>
      <span class="text-dim" style="font-size:11px">{{ t('help.footer', { v: VERSION }) }}</span>
      <button class="btn primary" @click="$emit('close')">{{ t('help.closeBtn') }}</button>
    </template>
  </BaseModal>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import BaseModal from '../BaseModal.vue'
import { settings, applySettings } from '../../composables/useSettings.js'
import { useI18n } from '../../composables/useI18n.js'
import { useUpdateStore } from '../../stores/useUpdateStore.js'
import { CHANGELOG, CHANGELOG_VERSION } from '../../composables/useChangelog.js'

const { t } = useI18n()
const updateStore     = useUpdateStore()
const updateAvailable  = computed(() => updateStore.updateAvailable)
const updateDownloaded = computed(() => updateStore.updateDownloaded)
const newVersion       = computed(() => updateStore.newVersion)

const ACCENT_OPTIONS = [
  { id: 'blue',   label: 'Azul',    color: '#0e9de8' },
  { id: 'teal',   label: 'Verde',   color: '#4ec9b0' },
  { id: 'purple', label: 'Morado',  color: '#a371f7' },
  { id: 'orange', label: 'Naranja', color: '#ff9800' },
]

function resetSettings() {
  Object.assign(settings, {
    theme: 'dark', lang: 'es', fontSize: 'normal',
    compactMode: false, showClock: true, autoRefresh: 0, accentColor: 'blue',
  })
}

function installUpdate() {
  updateStore.installUpdate()
}

const VERSION = window.kuaElectron?.getVersion?.() || CHANGELOG_VERSION

defineProps({ show: Boolean })
defineEmits(['close'])

const activeTab = ref('about')

const TABS = computed(() => [
  { id: 'about',    label: t('help.tabAbout'),    icon: 'info' },
  { id: 'releases', label: t('help.tabReleases'), icon: 'tag' },
  { id: 'options',  label: t('help.tabOptions'),  icon: 'settings' },
  { id: 'feedback', label: t('help.tabFeedback'), icon: 'message-square' },
])

// CHANGELOG imported from useChangelog.js

function tagLabel(t_) {
  return { new: t('welcome.tagNew'), better: t('welcome.tagBetter'), fix: 'Fix' }[t_] ?? t_
}

function open(url) {
  if (window.kuaElectron?.openExternal) window.kuaElectron.openExternal(url)
  else window.open(url, '_blank')
}
</script>

<style scoped>
.help-layout {
  display: flex;
  gap: 0;
  min-height: 380px;
}

/* Nav */
.help-nav {
  width: 140px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px 4px 0;
}
.help-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: background .12s, color .12s;
}
.help-nav-item i, .help-nav-item svg { width: 13px; height: 13px; flex-shrink: 0; }
.help-nav-item:hover { background: var(--bg-hover); color: var(--text); }
.help-nav-item.active { background: var(--bg-sel); color: #fff; }

/* Content */
.help-content {
  flex: 1;
  padding: 0 0 0 20px;
  overflow-y: auto;
}
.help-section { display: flex; flex-direction: column; gap: 14px; }
.help-section-header {
  display: flex; align-items: center; gap: 8px;
  color: var(--text);
}
.help-section-header i, .help-section-header svg { width: 14px; height: 14px; color: var(--accent); }
.help-section-header h3 { font-size: 14px; font-weight: 600; }

.help-p { font-size: 13px; color: var(--text-dim); line-height: 1.6; }

/* About */
.about-hero {
  display: flex; align-items: center; gap: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.about-logo-icon { width: 32px !important; height: 32px !important; color: var(--accent); }
.about-title { font-size: 16px; font-weight: 700; color: var(--text); }
.about-subtitle { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.about-links { display: flex; gap: 8px; flex-wrap: wrap; }
.about-links .btn { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.about-links .btn i, .about-links .btn svg { width: 12px; height: 12px; }

/* Pillars K/U/A */
.about-pillars {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;
}
.about-pillar {
  background: var(--bg-row); border: 1px solid var(--border); border-radius: 7px;
  padding: 12px 14px; display: flex; flex-direction: column; gap: 3px;
}
.pillar-letter { font-size: 26px; font-weight: 900; line-height: 1; }
.pillar-label  { font-size: 12px; font-weight: 700; color: var(--text); }
.pillar-desc   { font-size: 11px; color: var(--text-dim); line-height: 1.5; margin-top: 2px; }

/* Donate card */
.donate-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: rgba(255,64,129,.08);
  border: 1px solid rgba(255,64,129,.25);
  border-radius: 6px;
  padding: 14px;
}
.donate-icon { width: 20px !important; height: 20px !important; color: #ff4081; flex-shrink: 0; }
.donate-title { font-size: 13px; font-weight: 600; color: var(--text); }
.donate-sub { font-size: 12px; color: var(--text-dim); margin-top: 2px; line-height: 1.5; }
.donate-card .btn { flex-shrink: 0; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.donate-card .btn i, .donate-card .btn svg { width: 12px; height: 12px; }

/* Update card */
.update-card {
  display: flex;
  align-items: center;
  gap: 12px;
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 12px;
}
.update-card > i, .update-card > svg { width: 18px; height: 18px; flex-shrink: 0; }
.update-ready  { background: rgba(14,157,232,.1); border: 1px solid rgba(14,157,232,.3); }
.update-ready > i, .update-ready > svg { color: var(--accent); }
.update-pending { background: rgba(234,179,8,.08); border: 1px solid rgba(234,179,8,.3); }
.update-pending > i, .update-pending > svg { color: #eab308; }
.update-error { background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.3); }
.update-error > i, .update-error > svg { color: #ef4444; }
.update-card-body { flex: 1; }
.update-card-title { font-weight: 600; color: var(--text); }
.update-card-sub   { color: var(--text-dim); margin-top: 2px; }
.update-card .btn  { flex-shrink: 0; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.update-card .btn i, .update-card .btn svg { width: 11px; height: 11px; }

/* Releases */
.release-list { display: flex; flex-direction: column; gap: 16px; max-height: 340px; overflow-y: auto; padding-right: 4px; }
.release-head {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.release-ver { font-size: 13px; font-weight: 700; color: var(--accent); }
.release-current {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  background: rgba(14,157,232,.2); color: var(--accent);
  padding: 1px 6px; border-radius: 3px;
}
.release-date { font-size: 11px; }
.change-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 5px; }
.change-item { display: flex; align-items: baseline; gap: 8px; font-size: 12px; line-height: 1.5; }
.change-tag {
  display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; padding: 1px 5px; border-radius: 3px; flex-shrink: 0;
}
.tag-new    { background: rgba(78,201,176,.18); color: #4ec9b0; }
.tag-better { background: rgba(14,157,232,.18); color: #0e9de8; }
.tag-fix    { background: rgba(255,152,0,.18);  color: #ff9800; }

.help-footer-link { display: flex; justify-content: flex-end; }
.help-footer-link .btn { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.help-footer-link .btn i, .help-footer-link .btn svg { width: 12px; height: 12px; }

/* Feedback */
.feedback-cards { display: flex; flex-direction: column; gap: 8px; }
.feedback-card {
  display: flex; align-items: center; gap: 14px;
  background: var(--bg-row);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.feedback-card:hover { border-color: var(--accent); background: var(--bg-hover); }
.feedback-icon { width: 18px !important; height: 18px !important; flex-shrink: 0; }
.feedback-icon.red    { color: var(--red); }
.feedback-icon.yellow { color: var(--yellow); }
.feedback-icon.blue   { color: var(--accent); }
.feedback-title { font-size: 13px; font-weight: 600; color: var(--text); }
.feedback-sub { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
.feedback-arrow { width: 14px !important; height: 14px !important; color: var(--text-dim); margin-left: auto; flex-shrink: 0; }

.text-dim { color: var(--text-dim); }

/* Options tab */
.opts-group {
  background: var(--bg-row);
  border: 1px solid var(--border);
  border-radius: 7px;
  overflow: hidden;
}
.opts-group-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .6px; color: var(--text-dim);
  padding: 7px 14px 5px;
  border-bottom: 1px solid var(--border);
}
.opts-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.opts-row:last-child { border-bottom: none; }
.opts-label {
  display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
}
.opts-label > i, .opts-label > svg { width: 14px; height: 14px; color: var(--accent); flex-shrink: 0; }
.opts-label > span:first-of-type { font-size: 12px; font-weight: 600; color: var(--text); white-space: nowrap; }
.opts-desc { font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Toggle switch */
.toggle-switch { position: relative; display: inline-flex; align-items: center; cursor: pointer; flex-shrink: 0; }
.toggle-switch input { opacity: 0; width: 0; height: 0; position: absolute; }
.toggle-track {
  width: 36px; height: 20px; border-radius: 10px;
  background: var(--border); transition: background .2s;
  position: relative;
}
.toggle-track::after {
  content: ''; position: absolute;
  top: 3px; left: 3px;
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--text-dim); transition: transform .2s, background .2s;
}
.toggle-switch input:checked + .toggle-track { background: var(--accent); }
.toggle-switch input:checked + .toggle-track::after { transform: translateX(16px); background: #fff; }

.btn-toggle-group { display: flex; flex-shrink: 0; }
.btn-toggle-group .btn { border-radius: 0; border-right-width: 0; display: flex; align-items: center; gap: 5px; }
.btn-toggle-group .btn:first-child { border-radius: 4px 0 0 4px; }
.btn-toggle-group .btn:last-child  { border-radius: 0 4px 4px 0; border-right-width: 1px; }
.btn-toggle-group .btn i, .btn-toggle-group .btn svg { width: 11px; height: 11px; }
.btn-toggle-group .btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
