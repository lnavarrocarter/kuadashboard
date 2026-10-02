<template>
  <div class="ccs">
    <div class="cfn-toolbar">
      <span class="text-dim">{{ t('cfn.cs.hint') }}</span>
      <button class="btn sm" :disabled="loading" :title="t('awsLogs.refresh')" @click="load">↻</button>
    </div>
    <div v-if="error" class="activity-notice">{{ error }}</div>
    <div v-if="loading && !list" class="empty-row">{{ t('common.loading') }}</div>
    <div v-else-if="list && !list.length" class="text-dim">{{ t('cfn.cs.empty') }}</div>
    <table v-else-if="list" class="msg-subtable">
      <thead><tr><th>{{ t('cfn.cs.name') }}</th><th>{{ t('cfn.colStatus') }}</th><th>{{ t('cfn.cs.execution') }}</th><th>{{ t('cfn.created') }}</th><th></th></tr></thead>
      <tbody>
        <tr v-for="cs in list" :key="cs.id" :class="{ 'msg-selected': open?.id === cs.id }">
          <td>{{ cs.name }}<div v-if="cs.description" class="text-dim cfn-desc">{{ cs.description }}</div></td>
          <td><span class="msg-chip" :class="cs.status === 'CREATE_COMPLETE' ? 'ok' : cs.status === 'FAILED' ? 'err' : 'warn'" :title="cs.statusReason || ''">{{ cs.status }}</span></td>
          <td class="text-dim">{{ cs.executionStatus }}</td>
          <td class="text-dim cfn-time">{{ formatTime(cs.createdTime, settings.lang) }}</td>
          <td><button class="btn sm" @click="openChangeSet(cs.id)">{{ open?.id === cs.id ? t('awsMsg.hide') : t('cfn.cs.review') }}</button></td>
        </tr>
      </tbody>
    </table>

    <section v-if="open" class="ccs-detail">
      <header class="cfn-toolbar">
        <strong>{{ open.name }}</strong>
        <span class="msg-chip" :class="riskClass(open.risk.level)">{{ t(`cfn.cs.risk_${open.risk.level}`) }}</span>
        <span class="text-dim">{{ t('cfn.cs.counts', { add: open.risk.counts.Add || 0, modify: open.risk.counts.Modify || 0, remove: open.risk.counts.Remove || 0, replace: open.risk.replacements, conditional: open.risk.conditionalReplacements }) }}</span>
      </header>
      <div v-if="open.statusReason" class="activity-notice">{{ open.statusReason }}</div>
      <div v-if="open.risk.dataBearing.length" class="activity-notice">{{ t('cfn.cs.dataBearing', { list: open.risk.dataBearing.join(', ') }) }}</div>
      <table v-if="open.changes.length" class="msg-subtable">
        <thead><tr><th>{{ t('cfn.cs.action') }}</th><th>{{ t('cfn.colLogical') }}</th><th>{{ t('cfn.colType') }}</th><th>{{ t('cfn.cs.replacement') }}</th><th>{{ t('cfn.cs.why') }}</th></tr></thead>
        <tbody>
          <tr v-for="c in open.changes" :key="c.logicalId + c.action">
            <td><span class="msg-chip" :class="c.action === 'Remove' ? 'err' : c.action === 'Add' ? 'ok' : ''">{{ t(`cfn.cs.action_${c.action}`) }}</span></td>
            <td>{{ c.logicalId }}<div v-if="c.physicalId" class="text-dim cfn-desc">{{ c.physicalId }}</div></td>
            <td><code>{{ c.type }}</code><span v-if="c.dataBearing" class="msg-chip warn">{{ t('cfn.cs.data') }}</span></td>
            <td><span v-if="c.replacement" class="msg-chip" :class="c.replacement === 'True' ? 'err' : c.replacement === 'Conditional' ? 'warn' : ''">{{ t(`cfn.cs.replace_${c.replacement}`) }}</span></td>
            <td class="cfn-break cfn-desc">{{ c.details.map(d => [d.attribute, d.name].filter(Boolean).join(' ') + (d.requiresRecreation && d.requiresRecreation !== 'Never' ? ` (${d.requiresRecreation})` : '')).join(', ') }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="text-dim">{{ t('cfn.cs.noChanges') }}</div>

      <div v-if="executable" class="cfn-toolbar">
        <template v-if="open.risk.level === 'low' && !confirming">
          <button class="btn sm primary" :disabled="busy" @click="execute({})">{{ busy ? '…' : t('cfn.cs.execute') }}</button>
        </template>
        <button v-else-if="!confirming" class="btn sm" :class="open.risk.level === 'high' ? 'danger' : 'primary'" @click="confirming = true">{{ t('cfn.cs.execute') }}</button>
        <button class="btn sm danger" :disabled="busy" @click="remove">{{ t('cfn.cs.delete') }}</button>
      </div>
      <CfnConfirm
        v-if="confirming"
        :stack-name="stackName" :level="open.risk.level" :busy="busy"
        :message="t('cfn.cs.confirmMessage', { removals: open.risk.removals, replacements: open.risk.replacements + open.risk.conditionalReplacements })"
        :action-label="t('cfn.cs.execute')"
        @confirm="execute" @cancel="confirming = false"
      />
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { formatTime } from '../../../lib/awsLogs'
import CfnConfirm from './CfnConfirm.vue'

const props = defineProps({
  stackId: { type: String, required: true },
  stackName: { type: String, required: true },
  profileId: { type: String, default: '' },
  focus: { type: String, default: '' }, // change set to open (e.g. just created)
})
const emit = defineEmits(['changed', 'request-access'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const BASE = '/api/cloud/aws/cloudformation'

const list = ref(null)
const open = ref(null)
const loading = ref(false)
const busy = ref(false)
const confirming = ref(false)
const error = ref(null)
let pollTimer = null

const executable = computed(() => open.value?.status === 'CREATE_COMPLETE' && open.value?.executionStatus === 'AVAILABLE')

function headers(json = false) {
  return { 'X-Profile-Id': props.profileId, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}
function riskClass(level) { return { high: 'err', medium: 'warn', low: 'ok' }[level] }
function fail(err) {
  error.value = err.message
  if (err.details?.access) emit('request-access', { text: err.message, access: err.details.access })
}

async function load() {
  loading.value = true
  error.value = null
  try { list.value = (await apiFetch(`${BASE}/stack/change-sets?stack=${encodeURIComponent(props.stackId)}`, { headers: headers() })).changeSets } catch (err) { fail(err) } finally { loading.value = false }
}

// A change set being created is polled until CloudFormation finishes computing it.
async function openChangeSet(id, attempt = 0) {
  clearTimeout(pollTimer)
  if (open.value?.id === id && attempt === 0) { open.value = null; return }
  confirming.value = false
  try {
    const detail = await apiFetch(`${BASE}/change-set?stack=${encodeURIComponent(props.stackId)}&changeSet=${encodeURIComponent(id)}`, { headers: headers() })
    open.value = detail
    if (['CREATE_PENDING', 'CREATE_IN_PROGRESS'].includes(detail.status) && attempt < 60) pollTimer = setTimeout(() => openChangeSet(id, attempt + 1), 2000)
    else if (attempt) load()
  } catch (err) { fail(err) }
}

async function execute({ confirm = '', reason = '' }) {
  busy.value = true
  try {
    await apiFetch(`${BASE}/change-set/execute`, { method: 'POST', headers: headers(true), body: JSON.stringify({ stack: props.stackId, changeSet: open.value.id, confirm, reason }) })
    toast(t('cfn.cs.executed', { name: open.value.name }), 'success')
    open.value = null
    confirming.value = false
    emit('changed')
    load()
  } catch (err) { fail(err) } finally { busy.value = false }
}

async function remove() {
  busy.value = true
  try {
    await apiFetch(`${BASE}/change-set?stack=${encodeURIComponent(props.stackId)}&changeSet=${encodeURIComponent(open.value.id)}`, { method: 'DELETE', headers: headers() })
    toast(t('cfn.cs.deleted'), 'success')
    open.value = null
    load()
  } catch (err) { fail(err) } finally { busy.value = false }
}

watch(() => props.focus, id => { if (id) { load(); openChangeSet(id, 1) } })
onMounted(() => { load(); if (props.focus) openChangeSet(props.focus, 1) })
defineExpose({ load, openChangeSet })
</script>

<style scoped>
.ccs { display: flex; flex-direction: column; gap: 8px; }
.ccs-detail { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border); border-radius: 6px; padding: 10px; }
.cfn-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.cfn-desc { font-size: 11px; white-space: normal; overflow-wrap: anywhere; }
.cfn-time { white-space: nowrap; font-size: 11px; }
.cfn-break { overflow-wrap: anywhere; white-space: normal; }
</style>
