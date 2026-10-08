<template>
  <BaseModal :show="show" wide @close="$emit('close')">
    <template #title>{{ data?.team ? t('teamSpace.title', { name: data.team.name }) : t('teamSpace.titleNone') }}</template>
    <div class="tsp" data-test="team-space">
      <p v-if="loading && !data" class="text-dim">{{ t('common.loading') }}</p>
      <p v-else-if="!data" class="text-dim">{{ error || t('teamSpace.none') }}</p>
      <template v-else>
        <div class="tsp-head">
          <span class="tsp-badge">{{ t(`teamSpace.role_${data.role}`) }}</span>
          <span class="text-dim">{{ t('teamSpace.published') }}</span>
          <button class="btn sm" :disabled="busy" data-test="team-refresh" @click="refresh">{{ t('teamSpace.refresh') }}</button>
        </div>

        <!-- Everyone: what is shared with this account -->
        <section>
          <h4>{{ t('teamSpace.shared') }}</h4>
          <p v-if="!data.canImport" class="acp-warn tsp-note">{{ t('teamSpace.cannotImport') }}</p>
          <p v-if="!shared.length" class="text-dim tsp-note" data-test="team-shared-empty">{{ t('teamSpace.sharedEmpty') }}</p>
          <ul v-else class="tsp-list" data-test="team-shared">
            <li v-for="item in shared" :key="item.id">
              <div class="tsp-item"><strong>{{ item.name }}</strong><small class="text-dim">{{ describe(item) }}</small></div>
              <span v-if="data.imported[item.id]" class="text-dim">{{ t('teamSpace.imported') }}</span>
              <button v-else-if="data.canImport" class="btn sm primary" :disabled="busy || !profileId" :data-test="`team-import-${item.id}`" @click="importItem(item)">{{ t('teamSpace.import') }}</button>
            </li>
          </ul>
        </section>

        <!-- Owner and admins: every member's applications -->
        <section v-if="manager">
          <h4>{{ t('teamSpace.members') }}</h4>
          <p class="text-dim tsp-note">{{ t('teamSpace.membersHint') }}</p>
          <div v-for="group in byOwner" :key="group.owner.id" class="tsp-group">
            <h5>{{ group.owner.email }} <small v-if="!group.active" class="acp-warn">{{ t('teamSpace.left') }}</small></h5>
            <ul class="tsp-list">
              <li v-for="item in group.items" :key="item.id" class="tsp-manage" :data-test="`team-item-${item.id}`">
                <div class="tsp-item"><strong>{{ item.name }}</strong><small class="text-dim">{{ describe(item) }}</small></div>
                <div class="tsp-controls">
                  <label class="tsp-check"><input type="checkbox" :checked="item.shared" :disabled="busy || !item.ownerActive" :data-test="`team-share-${item.id}`" @change="update(item, { shared: $event.target.checked })" /> {{ t('teamSpace.share') }}</label>
                  <select class="ctrl-select" :disabled="busy || !item.shared" :value="item.access.mode" :aria-label="t('teamSpace.access')" @change="setAccessMode(item, $event.target.value)">
                    <option value="all">{{ t('teamSpace.accessAll') }}</option>
                    <option value="only">{{ t('teamSpace.accessOnly') }}</option>
                  </select>
                  <select class="ctrl-select" :disabled="busy" :value="item.backup.frequency || ''" :aria-label="t('teamSpace.backup')" :data-test="`team-backup-${item.id}`" @change="update(item, { backup: { frequency: $event.target.value || null } })">
                    <option value="">{{ t('teamSpace.backupOff') }}</option>
                    <option value="hourly">{{ t('teamSpace.backupHourly') }}</option>
                    <option value="daily">{{ t('teamSpace.backupDaily') }}</option>
                    <option value="weekly">{{ t('teamSpace.backupWeekly') }}</option>
                  </select>
                  <button class="btn sm" :disabled="busy" @click="backupNow(item)">{{ t('teamSpace.backupNow') }}</button>
                  <button class="btn sm" :disabled="busy" @click="toggleBackups(item)">{{ t('teamSpace.backups', { n: item.backups }) }}</button>
                  <button v-if="!data.imported[item.id]" class="btn sm" :disabled="busy || !profileId" :data-test="`team-load-${item.id}`" @click="importItem(item)">{{ t('teamSpace.load') }}</button>
                </div>
                <!-- Who sees this one, when it is not everyone -->
                <div v-if="item.shared && item.access.mode === 'only'" class="tsp-members">
                  <label v-for="member in otherMembers(item)" :key="member.id" class="tsp-check">
                    <input type="checkbox" :checked="item.access.members.includes(member.id)" :disabled="busy" @change="toggleMember(item, member.id, $event.target.checked)" /> {{ member.email }}
                  </label>
                </div>
                <ul v-if="openBackups === item.id" class="tsp-list tsp-backups">
                  <li v-if="!backupItems.length" class="text-dim">{{ t('teamSpace.noBackups') }}</li>
                  <li v-for="backup in backupItems" :key="backup.id">
                    <span>{{ t('teamSpace.backupLine', { version: backup.version, when: when(backup.createdAt), reason: t(`teamSpace.reason_${backup.reason}`) }) }}</span>
                    <button class="btn sm" :disabled="busy || !profileId" @click="restore(item, backup)">{{ t('teamSpace.restore') }}</button>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
          <p v-if="!byOwner.length" class="text-dim tsp-note">{{ t('teamSpace.membersEmpty') }}</p>
        </section>

        <!-- Owner and admins: who may import shared applications -->
        <section v-if="manager && data.members.length > 1">
          <h4>{{ t('teamSpace.permissions') }}</h4>
          <ul class="tsp-list">
            <li v-for="member in data.members.filter(m => m.role !== 'owner' && m.role !== 'admin')" :key="member.id">
              <span>{{ member.email }} <small class="text-dim">{{ t(`teamSpace.role_${member.role}`) }}</small></span>
              <label class="tsp-check"><input type="checkbox" :checked="member.canImport !== false" :disabled="busy" :data-test="`team-can-import-${member.id}`" @change="setPermission(member, $event.target.checked)" /> {{ t('teamSpace.canImport') }}</label>
            </li>
          </ul>
        </section>
      </template>
      <p v-if="error && data" class="acp-warn tsp-note" data-test="team-error">{{ error }}</p>
    </div>
  </BaseModal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import BaseModal from '../BaseModal.vue'
import { useI18n } from '../../composables/useI18n'
import { useToast } from '../../composables/useToast'
import { settings } from '../../composables/useSettings'
import { useArchitectureStore } from '../../stores/useArchitectureStore'

const props = defineProps({
  show: { type: Boolean, default: false },
  profileId: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const { t } = useI18n()
const { toast } = useToast()
const store = useArchitectureStore()
const data = ref(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const openBackups = ref('')
const backupItems = ref([])

const manager = computed(() => data.value?.role === 'owner' || data.value?.role === 'admin')
// Shared with this account: shared items of active members (managers see the same list here).
const shared = computed(() => (data.value?.items || []).filter(item => item.shared && item.ownerActive))
const byOwner = computed(() => {
  const groups = new Map()
  for (const item of data.value?.items || []) {
    const group = groups.get(item.owner.id) || { owner: item.owner, active: item.ownerActive, items: [] }
    group.items.push(item)
    groups.set(item.owner.id, group)
  }
  return [...groups.values()]
})
const when = at => (at ? new Date(at).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) : '')
const describe = item => t('teamSpace.itemLine', { owner: item.owner.email, version: item.version, when: when(item.updatedAt), provider: item.provider || t('teamSpace.noProvider'), region: item.region || '' })
const otherMembers = item => (data.value?.members || []).filter(member => member.id !== item.owner.id && member.role !== 'owner' && member.role !== 'admin')

async function run(action, message) {
  busy.value = true
  error.value = ''
  try {
    const result = await action()
    if (message) toast(message, 'success')
    return result
  } catch (err) {
    error.value = err.message
    return null
  } finally { busy.value = false }
}

async function load() {
  loading.value = true
  error.value = ''
  try { data.value = await store.teamSpace() } catch (err) { data.value = null; error.value = err.details?.code === 'NO_TEAM' ? '' : err.message } finally { loading.value = false }
}
const refresh = async () => { await run(() => store.teamRefresh()); await load() }

async function importItem(item) {
  const result = await run(() => store.teamImport(item.id), t('teamSpace.importedToast', { name: item.name }))
  if (result) emit('close')
}
async function update(item, changes) {
  const updated = await run(() => store.teamUpdate(item.id, changes))
  if (updated) Object.assign(item, updated)
}
const setAccessMode = (item, mode) => update(item, { access: { mode, members: mode === 'only' ? item.access.members : [] } })
function toggleMember(item, memberId, on) {
  const members = new Set(item.access.members)
  if (on) members.add(memberId); else members.delete(memberId)
  update(item, { access: { mode: 'only', members: [...members] } })
}
async function backupNow(item) {
  if (await run(() => store.teamBackupNow(item.id), t('teamSpace.backedUp', { name: item.name }))) { item.backups = Math.min(10, (item.backups || 0) + 1); if (openBackups.value === item.id) await listBackups(item) }
}
async function listBackups(item) {
  const result = await run(() => store.teamBackups(item.id))
  backupItems.value = result?.items || []
}
async function toggleBackups(item) {
  if (openBackups.value === item.id) { openBackups.value = ''; return }
  openBackups.value = item.id
  await listBackups(item)
}
async function restore(item, backup) {
  const result = await run(() => store.teamRestore(item.id, backup.id), t('teamSpace.restored', { name: item.name }))
  if (result) emit('close')
}
async function setPermission(member, canImport) {
  if (await run(() => store.teamPermission(member.id, canImport))) member.canImport = canImport
}

watch(() => props.show, open => { if (open) { openBackups.value = ''; load() } }, { immediate: true })
</script>

<style scoped>
.tsp { display: flex; flex-direction: column; gap: 14px; min-width: min(760px, 100%); }
.tsp h4 { margin: 0 0 6px; font-size: 13px; }
.tsp h5 { margin: 8px 0 4px; font-size: 12px; }
.tsp-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.tsp-head .btn { margin-left: auto; }
.tsp-badge { border: 1px solid var(--accent); color: var(--accent); border-radius: 999px; padding: 0 8px; font-size: 11px; }
.tsp-note { margin: 0; font-size: 12px; }
.tsp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.tsp-list > li { display: flex; justify-content: space-between; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; flex-wrap: wrap; }
.tsp-manage { flex-direction: column; align-items: stretch !important; }
.tsp-item { display: flex; flex-direction: column; min-width: 0; }
.tsp-controls, .tsp-members { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tsp-check { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; }
.tsp-backups > li { font-size: 12px; }
.acp-warn { color: var(--warning, #d97706); }
</style>
