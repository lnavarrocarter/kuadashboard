<template>
  <div class="cop">
    <div class="cop-hint">{{ t('cfn.ops.hint') }}</div>
    <div v-if="error" class="activity-notice">{{ error }}</div>

    <!-- Update parameters (preview = change set) -->
    <section class="cop-section">
      <h5>{{ t('cfn.ops.paramsTitle') }}</h5>
      <div v-if="!stack.parameters.length" class="text-dim">{{ t('cfn.ops.noParams') }}</div>
      <template v-else>
        <div class="cop-params">
          <label v-for="p in stack.parameters" :key="p.key" class="cop-param">
            <span><code>{{ p.key }}</code><span v-if="edits[p.key] !== undefined && edits[p.key] !== p.value" class="msg-chip warn">{{ t('cfn.ops.changed') }}</span></span>
            <input :value="edits[p.key] ?? p.value" class="ctrl-input" :disabled="p.value === '****'" :title="p.value === '****' ? t('cfn.ops.noEcho') : ''" @input="edits[p.key] = $event.target.value" />
          </label>
        </div>
        <div class="cop-row">
          <button class="btn sm primary" :disabled="!changedParams.length || busy.params" @click="previewParams">{{ busy.params ? '…' : t('cfn.ops.previewParams', { n: changedParams.length }) }}</button>
          <button v-if="changedParams.length" class="btn sm" @click="resetEdits">{{ t('cfn.ops.reset') }}</button>
        </div>
      </template>
    </section>

    <!-- Termination protection -->
    <section class="cop-section">
      <h5>{{ t('cfn.protected') }}</h5>
      <div class="cop-row">
        <span class="msg-chip" :class="stack.terminationProtection ? 'ok' : 'warn'">{{ stack.terminationProtection ? t('cfn.ops.protectionOn') : t('cfn.ops.protectionOff') }}</span>
        <button v-if="!stack.terminationProtection" class="btn sm" :disabled="busy.protection" @click="setProtection(true, {})">{{ t('cfn.ops.enableProtection') }}</button>
        <button v-else-if="!confirmProtection" class="btn sm" @click="confirmProtection = true">{{ t('cfn.ops.disableProtection') }}</button>
      </div>
      <CfnConfirm
        v-if="confirmProtection" :stack-name="stack.name" level="medium" :busy="busy.protection"
        :message="t('cfn.ops.disableProtectionMessage')" :action-label="t('cfn.ops.disableProtection')"
        @confirm="setProtection(false, $event)" @cancel="confirmProtection = false"
      />
    </section>

    <!-- Guarded delete -->
    <section class="cop-section">
      <h5>{{ t('cfn.ops.deleteTitle') }}</h5>
      <div class="cop-row">
        <button class="btn sm" :disabled="busy.preview" @click="loadDeletePreview">{{ busy.preview ? '…' : t('cfn.ops.deletePreview') }}</button>
      </div>
      <template v-if="deletePreview">
        <div class="cop-row">
          <span class="msg-chip" :class="{ high: 'err', medium: 'warn', low: 'ok' }[deletePreview.risk]">{{ t(`cfn.cs.risk_${deletePreview.risk}`) }}</span>
          <span class="text-dim">{{ t('cfn.ops.deleteSummary', { removed: deletePreview.summary.removed, retained: deletePreview.summary.retained, nested: deletePreview.summary.nestedStacks }) }}</span>
        </div>
        <div v-if="deletePreview.summary.dataBearingRemoved.length" class="activity-notice">{{ t('cfn.ops.dataBearingRemoved', { list: deletePreview.summary.dataBearingRemoved.join(', ') }) }}</div>
        <div v-for="b in deletePreview.blockers" :key="b" class="activity-notice">{{ t(`cfn.ops.blocker_${b}`) }}</div>
        <div v-for="i in deletePreview.blockingImports.filter(x => x.importedBy?.length)" :key="i.exportName" class="activity-notice">
          {{ t('cfn.ops.importedBy', { name: i.exportName, stacks: i.importedBy.join(', ') }) }}
        </div>
        <div v-if="deletePreview.templateError" class="text-dim">{{ t('cfn.ops.templateError') }}</div>
        <table class="msg-subtable">
          <thead><tr><th>{{ t('cfn.colLogical') }}</th><th>{{ t('cfn.colType') }}</th><th>{{ t('cfn.ops.onDelete') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in deletePreview.resources" :key="r.logicalId">
              <td>{{ r.logicalId }}</td>
              <td><code>{{ r.type }}</code><span v-if="r.dataBearing" class="msg-chip warn">{{ t('cfn.cs.data') }}</span></td>
              <td><span class="msg-chip" :class="r.deletionPolicy === 'Delete' ? (r.dataBearing ? 'err' : 'warn') : 'ok'">{{ t(`cfn.ops.policy_${r.deletionPolicy}`) }}</span></td>
            </tr>
          </tbody>
        </table>
        <CfnConfirm
          v-if="!deletePreview.blockers.length" :stack-name="stack.name" level="high" require-reason :busy="busy.delete"
          :message="t('cfn.ops.deleteMessage', { n: deletePreview.summary.removed })" :action-label="t('cfn.ops.deleteStack')"
          @confirm="deleteStack" @cancel="deletePreview = null"
        />
      </template>
    </section>

    <!-- History -->
    <section class="cop-section">
      <h5>{{ t('cfn.ops.history') }}</h5>
      <div v-if="!history.length" class="text-dim">{{ t('cfn.ops.noHistory') }}</div>
      <ul v-else class="cop-history">
        <li v-for="e in history" :key="e.id" :class="e.level">
          <span class="text-dim cfn-time">{{ formatTime(e.timestamp, settings.lang) }}</span>
          <span>{{ e.action }}</span>
          <span v-if="e.details?.changeSet" class="text-dim">· {{ e.details.changeSet }}</span>
          <span v-if="e.details?.reason" class="text-dim">· "{{ e.details.reason }}"</span>
          <span v-if="e.details?.risk?.level" class="msg-chip" :class="{ high: 'err', medium: 'warn', low: 'ok' }[e.details.risk.level]">{{ t(`cfn.cs.risk_${e.details.risk.level}`) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { formatTime } from '../../../lib/awsLogs'
import CfnConfirm from './CfnConfirm.vue'

const props = defineProps({ stack: { type: Object, required: true }, profileId: { type: String, default: '' } })
const emit = defineEmits(['changed', 'change-set-created', 'request-access'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const BASE = '/api/cloud/aws/cloudformation'

const edits = reactive({})
const busy = reactive({ params: false, protection: false, preview: false, delete: false })
const error = ref(null)
const confirmProtection = ref(false)
const deletePreview = ref(null)
const history = ref([])

const changedParams = computed(() => props.stack.parameters.filter(p => edits[p.key] !== undefined && edits[p.key] !== p.value).map(p => p.key))

function headers(json = false) {
  return { 'X-Profile-Id': props.profileId, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}
function fail(err) {
  error.value = err.message
  if (err.details?.access) emit('request-access', { text: err.message, access: err.details.access })
}
function resetEdits() { for (const key of Object.keys(edits)) delete edits[key] }

async function loadHistory() {
  try { history.value = (await apiFetch(`${BASE}/stack/history?name=${encodeURIComponent(props.stack.name)}`, { headers: headers() })).entries } catch { /* history is optional */ }
}

async function previewParams() {
  busy.params = true
  error.value = null
  try {
    const parameters = Object.fromEntries(changedParams.value.map(key => [key, edits[key]]))
    const result = await apiFetch(`${BASE}/stack/parameter-change-set`, { method: 'POST', headers: headers(true), body: JSON.stringify({ stack: props.stack.id, parameters }) })
    toast(t('cfn.ops.changeSetCreated', { name: result.changeSetName }), 'success')
    resetEdits()
    emit('change-set-created', result.changeSetId)
    loadHistory()
  } catch (err) { fail(err) } finally { busy.params = false }
}

async function setProtection(enabled, { confirm = '' }) {
  busy.protection = true
  error.value = null
  try {
    await apiFetch(`${BASE}/stack/termination-protection`, { method: 'POST', headers: headers(true), body: JSON.stringify({ stack: props.stack.id, enabled, confirm }) })
    confirmProtection.value = false
    emit('changed')
    loadHistory()
  } catch (err) { fail(err) } finally { busy.protection = false }
}

async function loadDeletePreview() {
  busy.preview = true
  error.value = null
  try { deletePreview.value = await apiFetch(`${BASE}/stack/delete-preview?stack=${encodeURIComponent(props.stack.id)}`, { headers: headers() }) } catch (err) { fail(err) } finally { busy.preview = false }
}

async function deleteStack({ confirm, reason }) {
  busy.delete = true
  error.value = null
  try {
    await apiFetch(`${BASE}/stack/delete`, { method: 'POST', headers: headers(true), body: JSON.stringify({ stack: props.stack.id, confirm, reason }) })
    toast(t('cfn.ops.deleting', { name: props.stack.name }), 'success')
    deletePreview.value = null
    emit('changed')
    loadHistory()
  } catch (err) { fail(err) } finally { busy.delete = false }
}

onMounted(loadHistory)
defineExpose({ loadHistory })
</script>

<style scoped>
.cop { display: flex; flex-direction: column; gap: 12px; }
.cop-hint { font-size: 11px; color: var(--text-dim); }
.cop-section { display: flex; flex-direction: column; gap: 6px; }
.cop-section h5 { margin: 0; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-dim); }
.cop-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.cop-params { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
.cop-param { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.cop-history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.cop-history li { display: flex; gap: 6px; flex-wrap: wrap; align-items: baseline; }
.cop-history li.warning { color: var(--yellow); }
.cfn-time { white-space: nowrap; font-size: 11px; }
</style>
