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
        <!-- Sync between this account's computers -->
        <section v-if="data.enabled || syncInfo?.applications?.length" class="cbk-sync" data-test="cloud-sync">
          <h4>{{ t('cloudSync.title') }}</h4>
          <template v-if="applicationId">
            <div v-if="current?.conflict" class="cbk-conflict" data-test="cloud-sync-conflict">
              <p>{{ t('cloudSync.conflict', { version: current.conflict.remote?.version, device: current.conflict.remote?.signedBy?.device || '?' }) }}</p>
              <span class="cbk-actions">
                <button class="btn sm" :disabled="busy" data-test="cloud-sync-mine" @click="resolve('mine')">{{ t('cloudSync.keepMine') }}</button>
                <button class="btn sm" :disabled="busy" data-test="cloud-sync-theirs" @click="resolve('theirs')">{{ t('cloudSync.takeTheirs') }}</button>
              </span>
              <p class="text-dim cbk-note">{{ t('cloudSync.conflictHint') }}</p>
            </div>
            <div v-else-if="current" class="cbk-usage" data-test="cloud-sync-state">
              <span>{{ t(current.changedHere ? 'cloudSync.pending' : 'cloudSync.synced', { version: current.version, when: when(current.syncedAt) }) }}</span>
              <span class="cbk-actions">
                <button class="btn sm" :disabled="busy" data-test="cloud-sync-now" @click="runSync">{{ t('cloudSync.now') }}</button>
                <button class="btn sm" :disabled="busy" @click="stopSync(false)">{{ t('cloudSync.stopHere') }}</button>
                <button class="btn sm danger" :disabled="busy" @click="stopSync(true)">{{ t('cloudSync.stopEverywhere') }}</button>
              </span>
            </div>
            <div v-else-if="data.enabled" class="cbk-usage">
              <span class="text-dim">{{ t('cloudSync.offHint') }}</span>
              <button class="btn sm primary" :disabled="busy" data-test="cloud-sync-enable" @click="enableSync">{{ t('cloudSync.enable', { name: applicationName }) }}</button>
            </div>
          </template>
          <template v-if="syncInfo?.available?.length">
            <p class="text-dim cbk-note">{{ t('cloudSync.available') }}</p>
            <ul class="cbk-list" data-test="cloud-sync-available">
              <li v-for="item in syncInfo.available" :key="item.syncId">
                <div class="cbk-item">
                  <strong>{{ item.name }}</strong>
                  <small class="text-dim">{{ t('cloudSync.remote', { version: item.version, device: item.signedBy?.device || '?', when: when(item.updatedAt) }) }}</small>
                </div>
                <button class="btn sm" :disabled="busy || !profileId" :data-test="`cloud-sync-add-${item.syncId}`" @click="addSynced(item)">{{ t('cloudSync.add') }}</button>
              </li>
            </ul>
          </template>
        </section>

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
              <small class="text-dim">{{ [item.applicationName, item.provider, item.region, size(item.sizeBytes), when(item.createdAt)].filter(Boolean).join(' · ') }}</small>
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
const syncInfo = ref(null)
const current = computed(() => syncInfo.value?.applications?.find(item => item.applicationId === props.applicationId) || null)

const blocked = computed(() => blockedBy.value || (data.value && !data.value.enabled && !data.value.items.length ? 'plan' : ''))
const size = bytes => formatBytes(bytes || 0)
const when = at => (at ? new Date(at).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')

async function loadSync() {
  try { syncInfo.value = await store.syncStatus() } catch { syncInfo.value = null }
}
async function syncAction(action, message) {
  const result = await run(action)
  if (result) { if (message) toast(message, 'success'); syncInfo.value = result.applications ? result : await store.syncStatus().catch(() => null) }
}
const enableSync = () => syncAction(() => store.enableSync(props.applicationId), t('cloudSync.enabled', { name: props.applicationName }))
const runSync = () => syncAction(() => store.syncNow())
const stopSync = everywhere => syncAction(() => store.disableSync(props.applicationId, everywhere))
const resolve = choice => syncAction(() => store.resolveSync(props.applicationId, choice), t('cloudSync.resolved'))
async function addSynced(item) {
  const result = await run(() => store.addSynced(item.syncId))
  if (result) { toast(t('cloudSync.added', { name: item.name }), 'success'); emit('close') }
}

async function load() {
  loadSync()
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
.cbk-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.cbk-sync { display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
.cbk-sync h4 { margin: 0; font-size: 13px; }
.cbk-conflict { border: 1px solid var(--warning, #d97706); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.cbk-conflict p { margin: 0; }
.acp-warn { color: var(--warning, #d97706); }
</style>
