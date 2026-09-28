<template>
  <div class="aov">
    <div class="aov-toolbar">
      <div>
        <h2 class="resource-title">{{ t('awsOverview.title') }}</h2>
        <div class="aov-scope">
          {{ profileName || profileId }}
          <span v-if="data">· {{ t('overview.updated', { ago: updatedLabel }) }}</span>
        </div>
      </div>
      <button class="btn btn-icon" :class="{ refreshing: loading }" :disabled="loading" :title="t('action.refresh')" @click="load()">
        <i data-lucide="refresh-cw"></i>
      </button>
    </div>

    <div v-if="!data && loading" class="loading-state">{{ t('awsOverview.loading') }}</div>
    <div v-else-if="!data && error" class="error-state">
      <i data-lucide="alert-triangle"></i><span>{{ error }}</span>
      <button class="btn sm" @click="load()">{{ t('common.retry') }}</button>
    </div>

    <template v-else-if="data">
      <p v-if="error" class="aov-notice warn"><i data-lucide="alert-triangle"></i>{{ t('awsOverview.refreshFailed', { error }) }}</p>
      <p v-if="identity.type === 'root'" class="aov-notice critical">
        <i data-lucide="shield-alert"></i>{{ t('awsOverview.rootWarning') }}
      </p>

      <!-- Environment -->
      <section class="aov-card aov-env">
        <div class="aov-field">
          <span class="aov-label">{{ t('awsOverview.account') }}</span>
          <span class="aov-value">
            <strong>{{ identity.alias || identity.account }}</strong>
            <span v-if="identity.alias" class="aov-dim">{{ identity.account }}</span>
            <button class="aov-copy" :title="t('awsOverview.copy')" @click="copy(identity.account)"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="aov-field">
          <span class="aov-label">{{ t('awsOverview.identity') }}</span>
          <span class="aov-value">
            <span class="aov-tag">{{ identityTypeLabel }}</span>
            <strong>{{ identity.name }}</strong>
            <span v-if="identity.session" class="aov-dim">· {{ identity.session }}</span>
          </span>
        </div>
        <div class="aov-field aov-wide">
          <span class="aov-label">ARN</span>
          <span class="aov-value">
            <code class="aov-arn" :title="identity.arn">{{ identity.arn }}</code>
            <button class="aov-copy" :title="t('awsOverview.copy')" @click="copy(identity.arn)"><i data-lucide="copy"></i></button>
          </span>
        </div>
        <div class="aov-field">
          <span class="aov-label">{{ t('awsOverview.region') }}</span>
          <span class="aov-value"><span class="aov-tag accent">{{ data.region }}</span></span>
        </div>
        <div class="aov-field">
          <span class="aov-label">{{ t('awsOverview.enabledRegions') }}</span>
          <span class="aov-value">
            <template v-if="data.regions.available">
              <strong>{{ data.regions.items.length }}</strong>
              <button class="aov-link" @click="showRegions = !showRegions">{{ t(showRegions ? 'awsOverview.hideRegions' : 'awsOverview.showRegions') }}</button>
            </template>
            <span v-else class="aov-dim">{{ errorLabel(data.regions.error) }}</span>
          </span>
        </div>
        <div v-if="showRegions && data.regions.available" class="aov-regions aov-wide">
          <span v-for="r in data.regions.items" :key="r" :class="['aov-tag', { accent: r === data.region }]">{{ r }}</span>
        </div>
      </section>

      <!-- Summary -->
      <div class="aov-tiles">
        <div class="aov-tile">
          <span class="aov-tile-label">{{ t('awsOverview.activeServices') }}</span>
          <span class="aov-tile-value">{{ data.summary.active }}<span class="aov-dim">/{{ data.summary.total }}</span></span>
          <span class="aov-tile-sub">{{ t('awsOverview.activeCriterion') }}</span>
        </div>
        <div class="aov-tile">
          <span class="aov-tile-label">{{ t('awsOverview.resources') }}</span>
          <span class="aov-tile-value">{{ totalResources }}</span>
          <span class="aov-tile-sub">{{ t('awsOverview.resourcesSub') }}</span>
        </div>
        <div class="aov-tile" :class="{ warn: data.summary.unavailable }">
          <span class="aov-tile-label">{{ t('awsOverview.unavailable') }}</span>
          <span class="aov-tile-value">{{ data.summary.unavailable }}</span>
          <span class="aov-tile-sub">{{ t('awsOverview.unavailableSub') }}</span>
        </div>
      </div>

      <!-- Services -->
      <section class="aov-services">
        <button
          v-for="s in data.services" :key="s.id"
          :class="['aov-service', s.status]"
          :title="t('awsOverview.openService', { service: s.label })"
          @click="emit('open-tab', s.tab)"
        >
          <span class="aov-service-head">
            <span class="aov-service-name">{{ s.label }}</span>
            <span v-if="s.scope === 'global'" class="aov-tag">{{ t('awsOverview.global') }}</span>
          </span>
          <template v-if="s.status === 'unavailable'">
            <span class="aov-service-error"><i data-lucide="lock"></i>{{ errorLabel(s.error) }}</span>
            <code v-if="s.error.action" class="aov-action">{{ s.error.action }}</code>
            <span
              v-if="s.access" class="aov-request" role="button" tabindex="0"
              @click.stop="openAccess(s)" @keydown.enter.stop="openAccess(s)"
            ><i data-lucide="key-round"></i>{{ t('awsAccess.requestAccess') }}</span>
          </template>
          <template v-else>
            <span class="aov-service-count">{{ s.count }}{{ s.truncated ? '+' : '' }}</span>
            <span v-if="s.status === 'empty' || detailLabel(s)" class="aov-service-detail">{{ s.status === 'empty' ? t('awsOverview.noResources') : detailLabel(s) }}</span>
          </template>
        </button>
      </section>
      <p class="aov-note">{{ t('awsOverview.scopeNote', { region: data.region }) }}</p>
      <AwsAccessRequestModal
        :show="!!accessService"
        :access="accessService?.access || null"
        :message="accessService?.error?.message || ''"
        :identity="identity"
        @close="accessService = null"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { createIcons, icons } from 'lucide'
import { useAwsStore } from '../../stores/useAwsStore'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import AwsAccessRequestModal from './AwsAccessRequestModal.vue'

defineProps({
  profileId: { type: String, default: '' },
  profileName: { type: String, default: '' },
})
const emit = defineEmits(['open-tab'])

const awsStore = useAwsStore()
const { t } = useI18n()
const { toast } = useToast()

const loading = ref(false)
const error = ref(null)
const showRegions = ref(false)
const accessService = ref(null)

function openAccess(service) {
  accessService.value = service
}
const now = ref(Date.now())
let requestId = 0
let clock = null

const data = computed(() => awsStore.overview)
const identity = computed(() => data.value?.identity || {})
const totalResources = computed(() => (data.value?.services || []).reduce((sum, s) => sum + (s.count || 0), 0))

const IDENTITY_TYPES = { user: 'awsOverview.typeUser', role: 'awsOverview.typeRole', sso: 'awsOverview.typeSso', root: 'awsOverview.typeRoot', federated: 'awsOverview.typeFederated' }
const identityTypeLabel = computed(() => (IDENTITY_TYPES[identity.value.type] ? t(IDENTITY_TYPES[identity.value.type]) : identity.value.type))

const updatedLabel = computed(() => {
  const seconds = Math.max(0, Math.round((now.value - new Date(data.value.generatedAt)) / 1000))
  return seconds < 60 ? t('overview.agoSeconds', { n: seconds }) : t('overview.agoMinutes', { n: Math.round(seconds / 60) })
})

function detailLabel(service) {
  const d = service.detail || {}
  switch (service.id) {
    case 'ec2': return t('awsOverview.detailEc2', { running: d.running ?? 0, stopped: d.stopped ?? 0 })
    case 'ecs': return t('awsOverview.detailEcs', { services: d.services ?? 0 })
    case 'apigw': return t('awsOverview.detailApigw', { rest: d.rest ?? 0, http: d.http ?? 0 })
    case 'vpc': return t('awsOverview.detailVpc', { custom: d.custom ?? 0 })
    case 'rds': return t('awsOverview.detailRds', { available: d.available ?? 0 })
    case 'eventbridge': return t('awsOverview.detailEventbridge', { enabled: d.enabled ?? 0 })
    default: return ''
  }
}

function errorLabel(err) {
  if (!err) return ''
  const keys = { denied: 'awsOverview.errorDenied', expired: 'awsOverview.errorExpired', timeout: 'awsOverview.errorTimeout' }
  return keys[err.kind] ? t(keys[err.kind]) : err.message
}

async function copy(value) {
  try {
    await navigator.clipboard.writeText(value)
    toast(t('awsOverview.copied'), 'success')
  } catch {
    toast(t('awsOverview.copyFailed'), 'error')
  }
}

async function load() {
  const id = ++requestId
  loading.value = true
  try {
    await awsStore.fetchOverview()
    if (id === requestId) error.value = null
  } catch (e) {
    if (id === requestId) error.value = e.message
  } finally {
    if (id === requestId) loading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

onMounted(() => {
  clock = setInterval(() => { now.value = Date.now() }, 10000)
  nextTick(() => createIcons({ icons }))
})
onUnmounted(() => clearInterval(clock))

defineExpose({ load })
</script>

<style scoped>
.aov { display: flex; flex-direction: column; gap: 14px; padding: 14px 16px; overflow-y: auto; height: 100%; box-sizing: border-box; }
.aov-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.aov-scope { color: var(--text-dim); font-size: 12px; margin-top: 2px; }
.aov-dim { color: var(--text-dim); font-weight: 400; }

.aov-notice { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 12px; border-radius: 6px; font-size: 12px; border: 1px solid var(--border); }
.aov-notice svg { width: 14px; height: 14px; flex: none; }
.aov-notice.warn { border-color: color-mix(in srgb, var(--yellow) 45%, var(--border)); color: var(--yellow); }
.aov-notice.critical { border-color: color-mix(in srgb, var(--red) 55%, var(--border)); color: var(--red); background: color-mix(in srgb, var(--red) 8%, transparent); }

.aov-card { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); padding: 12px 14px; }
.aov-env { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 24px; }
.aov-wide { grid-column: 1 / -1; }
.aov-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.aov-label { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: .03em; }
.aov-value { display: flex; align-items: center; gap: 8px; font-size: 13px; min-width: 0; flex-wrap: wrap; }
.aov-arn { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; max-width: 100%; }
.aov-copy { border: none; background: transparent; color: var(--text-dim); cursor: pointer; padding: 2px; border-radius: 4px; display: inline-flex; }
.aov-copy:hover { color: var(--text); background: var(--bg-hover); }
.aov-copy svg { width: 13px; height: 13px; }
.aov-link { border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; font-size: 12px; padding: 0; }
.aov-tag { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; border: 1px solid var(--border); color: var(--text-dim); }
.aov-tag.accent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.aov-regions { display: flex; flex-wrap: wrap; gap: 6px; }

.aov-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.aov-tile { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-panel); }
.aov-tile.warn { border-color: color-mix(in srgb, var(--yellow) 45%, var(--border)); }
.aov-tile-label { font-size: 11px; font-weight: 600; color: var(--text-dim); text-transform: uppercase; letter-spacing: .03em; }
.aov-tile-value { font-size: 26px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.aov-tile-sub { font-size: 11px; color: var(--text-dim); }

.aov-services { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.aov-service {
  display: flex; flex-direction: column; gap: 4px; text-align: left; min-width: 0;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-panel); color: var(--text); cursor: pointer; font: inherit;
  transition: border-color .15s, background .15s;
}
.aov-service:hover { border-color: var(--accent); background: var(--bg-hover); }
.aov-service.empty { opacity: .65; }
.aov-service.unavailable { border-style: dashed; border-color: color-mix(in srgb, var(--yellow) 45%, var(--border)); }
.aov-service-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.aov-service-name { font-size: 12px; font-weight: 600; color: var(--text-dim); }
.aov-service-count { font-size: 24px; font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
.aov-service-detail { font-size: 11px; color: var(--text-dim); }
.aov-service-error { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--yellow); }
.aov-service-error svg { width: 12px; height: 12px; }
.aov-request { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 11px; color: var(--accent); }
.aov-request:hover { text-decoration: underline; }
.aov-request svg { width: 11px; height: 11px; }
.aov-action { font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aov-note { margin: 0; font-size: 11px; color: var(--text-dim); }

@media (max-width: 800px) {
  .aov-env { grid-template-columns: minmax(0, 1fr); }
}
</style>
