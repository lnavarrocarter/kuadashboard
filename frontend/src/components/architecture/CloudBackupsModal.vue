<template>
  <BaseModal :show="show" @close="$emit('close')">
    <template #title>{{ t('cloudBackups.title') }}</template>
    <div class="cbk" data-test="cloud-backups">
      <p class="text-dim cbk-note">{{ t('cloudBackups.hint') }}</p>

      <p v-if="loading && !data" class="text-dim">{{ t('common.loading') }}</p>
      <!-- Not signed in or on the Free plan: say what unlocks backups -->
      <div v-else-if="blocked" class="cbk-locked" data-test="cloud-backups-locked">
        <p>{{ t(blocked === 'signedOut' ? 'cloudBackups.signedOut' : 'cloudBackups.planRequired') }}</p>
        <button class="btn sm primary" @click="openAccount">{{ t(blocked === 'signedOut' ? 'cloudBackups.signIn' : 'cloudBackups.seePlans') }}</button>
      </div>
      <template v-else-if="data">
        <div class="cbk-usage" data-test="cloud-backups-usage">
          <span>{{ t('cloudBackups.usage', { count: data.usage.count, maxCount: data.limits.count, size: size(data.usage.bytes), maxSize: size(data.limits.bytes) }) }}</span>
          <button v-if="applicationId && data.enabled" class="btn sm primary" :disabled="busy" data-test="cloud-backup-now" @click="backupNow">
            <i data-lucide="cloud-upload"></i> {{ t('cloudBackups.backupNow', { name: applicationName }) }}
          </button>
        </div>
        <p v-if="!data.enabled" class="acp-warn cbk-note">{{ t('cloudBackups.readOnly') }}</p>

        <p v-if="!data.items.length" class="text-dim" data-test="cloud-backups-empty">{{ t('cloudBackups.empty') }}</p>
        <ul v-else class="cbk-list" data-test="cloud-backups-list">
          <li v-for="item in data.items" :key="item.id">
            <div class="cbk-item">
              <strong>{{ item.name }}</strong>
              <small class="text-dim">{{ item.applicationName }} · {{ item.provider }} · {{ item.region }} · {{ size(item.sizeBytes) }} · {{ when(item.createdAt) }}</small>
            </div>
            <span class="cbk-actions">
              <button class="btn sm" :disabled="busy || !profileId" :data-test="`cloud-backup-restore-${item.id}`" @click="restore(item)">{{ t('cloudBackups.restore') }}</button>
              <button v-if="confirming !== item.id" class="btn sm danger" :disabled="busy" :data-test="`cloud-backup-delete-${item.id}`" @click="confirming = item.id">{{ t('cloudBackups.delete') }}</button>
              <button v-else class="btn sm danger" :disabled="busy" :data-test="`cloud-backup-confirm-${item.id}`" @click="remove(item)">{{ t('cloudBackups.confirmDelete') }}</button>
            </span>
          </li>
        </ul>
      </template>
      <p v-if="error" class="acp-warn cbk-note" data-test="cloud-backups-error">{{ error }}</p>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import { api } from '../../composables/useApi'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { settings } from '../../composables/useSettings'
import { formatBytes } from '../../lib/awsLogs'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

const props = defineProps({
  show: { type: Boolean, default: false },
  profileId: { type: String, default: '' },
  // Application to back up (the one open in KUApps); restore works without it.
  applicationId: { type: String, default: '' },
  applicationName: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { toast } = useToast()
const store = useArchitectureStore()
const data = ref(null)
const error = ref('')
const loading = ref(false)
const busy = ref(false)
const confirming = ref('')
const blockedBy = ref('')

const blocked = computed(() => blockedBy.value || (data.value && !data.value.enabled && !data.value.items.length ? 'plan' : ''))
const size = bytes => formatBytes(bytes || 0)
const when = at => (at ? new Date(at).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')

async function load() {
  loading.value = true
  error.value = ''
  blockedBy.value = ''
  try {
    const result = await api('GET', '/api/account/backups')
    data.value = result && Array.isArray(result.items) ? result : null
  } catch (err) {
    data.value = null
    if (err.details?.code === 'SIGNED_OUT' || err.status === 401) blockedBy.value = 'signedOut'
    else error.value = err.message
  } finally { loading.value = false }
}

async function run(action) {
  busy.value = true
  error.value = ''
  try { return await action() } catch (err) {
    // Plan and signature answers have their own words; the rest keeps the service message.
    const known = { PLAN_REQUIRED: 'planRequired', BACKUP_TAMPERED: 'tampered', UNSIGNED_BACKUP: 'unsigned', DEVICE_KEY_SET: 'keyConflict', DEVICE_KEY_MISSING: 'keyConflict' }[err.details?.code]
    error.value = known ? t(`cloudBackups.${known}`) : err.message
    return null
  } finally { busy.value = false }
}

async function backupNow() {
  const backup = await run(() => store.backupKuaAppToCloud(props.applicationId))
  if (backup) { toast(t('cloudBackups.saved', { name: backup.name || props.applicationName }), 'success'); await load() }
}

async function restore(item) {
  const result = await run(() => store.restoreCloudBackup(item.id))
  if (result) { toast(t('cloudBackups.restored', { name: result.application.name }), 'success'); emit('close') }
}

async function remove(item) {
  const done = await run(async () => { await api('DELETE', `/api/account/backups/${encodeURIComponent(item.id)}`); return true })
  confirming.value = ''
  if (done) await load()
}

function openAccount() {
  emit('close')
  window.dispatchEvent(new CustomEvent('kua:open-help', { detail: { tab: 'account' } }))
}

watch(() => props.show, open => { if (open) { confirming.value = ''; load() } }, { immediate: true })
</script>

<style scoped>
.cbk { display: flex; flex-direction: column; gap: 10px; min-width: min(560px, 100%); }
.cbk-note { margin: 0; font-size: 12px; }
.cbk-locked { display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.cbk-locked p { margin: 0; }
.cbk-usage { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
.cbk-usage .btn svg { width: 14px; height: 14px; margin-right: 4px; vertical-align: -2px; }
.cbk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cbk-list li { display: flex; justify-content: space-between; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; flex-wrap: wrap; }
.cbk-item { display: flex; flex-direction: column; min-width: 0; }
.cbk-item strong { overflow-wrap: anywhere; }
.cbk-actions { display: flex; gap: 6px; }
.acp-warn { color: var(--warning, #d97706); }
</style>
