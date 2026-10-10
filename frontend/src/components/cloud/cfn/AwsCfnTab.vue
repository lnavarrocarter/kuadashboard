<template>
  <div class="cfn">
    <div class="cfn-views" role="tablist">
      <button class="btn sm" :class="{ primary: view === 'stacks' }" role="tab" :aria-selected="view === 'stacks'" @click="view = 'stacks'">{{ t('cfn.view_stacks') }}</button>
      <button class="btn sm" :class="{ primary: view === 'exports' }" role="tab" :aria-selected="view === 'exports'" @click="view = 'exports'">{{ t('cfn.view_exports') }}</button>
    </div>
    <CfnExports v-if="view === 'exports'" :profile-id="profileId" @loaded="exportsData = $event" @open-stack="openFromExports" />
    <template v-else>
    <div class="cfn-head">
      <input v-model="search" class="ctrl-input cfn-search" :placeholder="t('cfn.search')" />
      <div class="cfn-chips">
        <button v-for="g in GROUPS" :key="g" class="btn sm" :class="{ accent: group === g }" @click="group = g">
          {{ t(`cfn.group_${g}`) }} <span class="text-dim">{{ g === 'all' ? stacks.length : g === 'drifted' ? driftedCount : (data?.counts?.[g] || 0) }}</span>
        </button>
      </div>
      <label class="cfn-check"><input v-model="showNested" type="checkbox" /> {{ t('cfn.showNested') }}</label>
      <button class="btn sm" :disabled="loading" :title="t('awsLogs.refresh')" @click="load">↻</button>
    </div>
    <div class="cfn-hint">{{ t('cfn.costHint') }}</div>
    <div v-if="notice" class="activity-notice">
      <span>{{ notice.text }}</span>
      <button v-if="notice.access" class="btn sm" @click="emit('request-access', notice)">{{ t('awsAccess.requestAccess') }}</button>
    </div>
    <div v-if="data?.truncated" class="activity-notice">{{ t('cfn.truncated') }}</div>

    <div v-if="loading && !data" class="empty-row">{{ t('common.loading') }}</div>
    <div v-else-if="!rows.length" class="empty-row">{{ search || group !== 'all' ? t('cfn.noMatches') : t('cfn.empty') }}</div>
    <table v-else class="cloud-table">
      <thead><tr>
        <th :class="thClass('name')" :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortBy('name')">{{ t('cfn.colStack') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('name') }}</span></button></th>
        <th :class="thClass('status')" :aria-sort="ariaSort('status')"><button type="button" class="th-sort" @click="sortBy('status')">{{ t('cfn.colStatus') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('status') }}</span></button></th>
        <th>{{ t('cfn.colDrift') }}</th>
        <th :class="thClass('lastChange')" :aria-sort="ariaSort('lastChange')"><button type="button" class="th-sort" @click="sortBy('lastChange')">{{ t('cfn.colUpdated') }} <span class="sort-icon" aria-hidden="true">{{ sortIcon('lastChange') }}</span></button></th>
        <th></th>
      </tr></thead>
      <tbody>
        <template v-for="s in sortRows(rows)" :key="s.id">
          <tr :class="{ 'msg-selected': selected === s.id }">
            <td class="cfn-name">
              <span :class="{ 'cfn-nested': s.parentId }">{{ s.name }}</span>
              <span v-if="s.parentId" class="msg-chip">{{ t('cfn.nested') }}</span>
              <span v-if="s.isAgentCore" class="msg-chip">AgentCore</span>
              <span v-if="s.terminationProtection" class="msg-chip ok" :title="t('cfn.protectedHint')">{{ t('cfn.protected') }}</span>
              <div v-if="s.description" class="text-dim cfn-desc">{{ s.description }}</div>
            </td>
            <td>
              <span class="msg-chip" :class="chipClass(s.statusGroup)">{{ s.status }}</span>
              <div v-if="s.statusReason && s.statusGroup !== 'ok'" class="text-dim cfn-desc" :title="s.statusReason">{{ s.statusReason }}</div>
            </td>
            <td><span class="msg-chip" :class="driftClass(s.drift.status)" :title="s.drift.checkedAt ? formatTime(s.drift.checkedAt, settings.lang) : ''">{{ t(`cfn.drift_${s.drift.status}`) }}</span></td>
            <td class="text-dim cfn-time">{{ formatTime(s.lastChange, settings.lang) }}</td>
            <td><button class="btn sm" :aria-expanded="selected === s.id" @click="toggle(s)">{{ selected === s.id ? t('awsMsg.hide') : t('awsMsg.details') }}</button></td>
          </tr>
          <tr v-if="selected === s.id" class="msg-detail-row">
            <td colspan="5">
              <div class="cfn-detail">
                <div class="cfn-tabs" role="tablist">
                  <button v-for="tab in DETAIL_TABS" :key="tab" class="btn sm" :class="{ accent: detailTab === tab }" role="tab" :aria-selected="detailTab === tab" @click="openTab(s, tab)">
                    {{ t(`cfn.tab_${tab}`) }}<span v-if="tab === 'resources' && detail" class="text-dim"> {{ detail.resources.length }}</span>
                  </button>
                </div>
                <div v-if="detailLoading" class="empty-row">{{ t('common.loading') }}</div>

                <!-- Overview -->
                <template v-else-if="detailTab === 'overview' && detail">
                  <dl class="msg-facts">
                    <div><dt>{{ t('cfn.colStatus') }}</dt><dd>{{ detail.stack.status }}</dd></div>
                    <div v-if="detail.stack.statusReason"><dt>{{ t('cfn.reason') }}</dt><dd>{{ detail.stack.statusReason }}</dd></div>
                    <div><dt>{{ t('cfn.created') }}</dt><dd>{{ formatTime(detail.stack.createdTime, settings.lang) }}</dd></div>
                    <div><dt>{{ t('cfn.colUpdated') }}</dt><dd>{{ formatTime(detail.stack.updatedTime, settings.lang) }}</dd></div>
                    <div><dt>{{ t('cfn.protected') }}</dt><dd>{{ detail.stack.terminationProtection ? t('cfn.yes') : t('cfn.no') }}</dd></div>
                    <div v-if="detail.stack.roleArn"><dt>{{ t('cfn.role') }}</dt><dd>{{ detail.stack.roleArn }}</dd></div>
                    <div v-if="detail.stack.capabilities.length"><dt>{{ t('cfn.capabilities') }}</dt><dd>{{ detail.stack.capabilities.join(', ') }}</dd></div>
                    <div v-if="detail.stack.parentId"><dt>{{ t('cfn.parent') }}</dt><dd><button class="cfn-link" @click="selectById(detail.stack.parentId)">{{ nameFromId(detail.stack.parentId) }}</button></dd></div>
                    <div><dt>{{ t('cfn.resourceTypes') }}</dt><dd>{{ Object.keys(detail.byType).length }} · {{ detail.resources.length }} {{ t('cfn.resourcesLower') }}</dd></div>
                  </dl>
                  <CfnApplications :stack-name="detail.stack.name" :region="data?.region || ''" :profile-id="profileId" @open-application="openApplication" />
                  <div class="msg-columns">
                    <section class="msg-section">
                      <h5>{{ t('cfn.parameters') }}</h5>
                      <div v-if="!detail.stack.parameters.length" class="text-dim">—</div>
                      <table v-else class="msg-subtable"><tbody>
                        <tr v-for="p in detail.stack.parameters" :key="p.key"><td><code>{{ p.key }}</code></td><td>{{ p.value }}<div v-if="p.resolvedFrom" class="text-dim cfn-desc">{{ t('cfn.resolvedFrom', { source: p.resolvedFrom }) }}</div></td></tr>
                      </tbody></table>
                    </section>
                    <section class="msg-section">
                      <h5>{{ t('cfn.outputs') }}</h5>
                      <div v-if="!detail.stack.outputs.length" class="text-dim">—</div>
                      <table v-else class="msg-subtable"><tbody>
                        <tr v-for="o in detail.stack.outputs" :key="o.key">
                          <td><code>{{ o.key }}</code><div v-if="o.exportName" class="text-dim cfn-desc">{{ t('cfn.export', { name: o.exportName }) }}<template v-if="importsOf(o.exportName)"> · {{ importsOf(o.exportName) }}</template></div></td>
                          <td class="cfn-break">{{ o.value }}<div v-if="o.description" class="text-dim cfn-desc">{{ o.description }}</div></td>
                        </tr>
                      </tbody></table>
                    </section>
                    <section v-if="Object.keys(detail.stack.tags).length" class="msg-section">
                      <h5>{{ t('cfn.tags') }}</h5>
                      <table class="msg-subtable"><tbody><tr v-for="(v, k) in detail.stack.tags" :key="k"><td><code>{{ k }}</code></td><td>{{ v }}</td></tr></tbody></table>
                    </section>
                  </div>
                </template>

                <!-- Resources -->
                <template v-else-if="detailTab === 'resources' && detail">
                  <div class="cfn-toolbar">
                    <input v-model="resourceSearch" class="ctrl-input cfn-search" :placeholder="t('cfn.resourceSearch')" />
                    <label class="cfn-check"><input v-model="driftedOnly" type="checkbox" /> {{ t('cfn.driftedOnly') }}</label>
                  </div>
                  <div v-if="detail.resourcesTruncated" class="activity-notice">{{ t('cfn.truncated') }}</div>
                  <table class="msg-subtable cfn-resources">
                    <thead><tr><th>{{ t('cfn.colType') }}</th><th>{{ t('cfn.colLogical') }}</th><th>{{ t('cfn.colPhysical') }}</th><th>{{ t('cfn.colStatus') }}</th><th>{{ t('cfn.colDrift') }}</th><th></th></tr></thead>
                    <tbody>
                      <tr v-for="r in resourceRows" :key="r.logicalId">
                        <td><code>{{ r.type }}</code></td>
                        <td>{{ r.logicalId }}</td>
                        <td class="cfn-break text-dim">{{ r.physicalId || '—' }}</td>
                        <td><span class="msg-chip" :class="chipClass(r.statusGroup)" :title="r.statusReason || ''">{{ r.status }}</span></td>
                        <td><span class="msg-chip" :class="driftClass(r.drift)">{{ t(`cfn.drift_${r.drift}`) }}</span></td>
                        <td>
                          <button v-if="r.kuaTab === 'cloudformation' && r.physicalId" class="btn sm" @click="selectById(r.physicalId)">{{ t('cfn.openStack') }}</button>
                          <button v-else-if="r.kuaTab" class="btn sm" @click="emit('open-resource', { tab: r.kuaTab, name: r.kuaName })">{{ t('cfn.openInKua') }}</button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </template>

                <!-- Events -->
                <template v-else-if="detailTab === 'events' && events">
                  <div v-if="events.rootCause" class="cfn-root">
                    <strong>{{ t('cfn.rootCause') }}</strong>
                    <span>{{ events.rootCause.logicalId }} <span class="text-dim">({{ events.rootCause.type }})</span> · {{ events.rootCause.status }} · {{ formatTime(events.rootCause.timestamp, settings.lang) }}</span>
                    <p>{{ events.rootCause.reason }}</p>
                  </div>
                  <div class="cfn-toolbar"><label class="cfn-check"><input v-model="failuresOnly" type="checkbox" /> {{ t('cfn.failuresOnly') }}</label></div>
                  <table class="msg-subtable">
                    <thead><tr><th>{{ t('awsLogs.chart.time') }}</th><th>{{ t('cfn.colLogical') }}</th><th>{{ t('cfn.colStatus') }}</th><th>{{ t('cfn.reason') }}</th></tr></thead>
                    <tbody>
                      <tr v-for="e in eventRows" :key="e.id" :class="{ 'cfn-root-row': events.rootCause && e.id === events.rootCause.id }">
                        <td class="cfn-time text-dim">{{ formatTime(e.timestamp, settings.lang) }}</td>
                        <td>{{ e.logicalId }}<div class="text-dim cfn-desc">{{ e.type }}</div></td>
                        <td><span class="msg-chip" :class="chipClass(e.statusGroup)">{{ e.status }}</span></td>
                        <td class="cfn-break">{{ e.reason || '' }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-if="events.truncated" class="text-dim cfn-desc">{{ t('cfn.eventsTruncated') }}</div>
                </template>

                <!-- Template -->
                <template v-else-if="detailTab === 'template' && template">
                  <div class="cfn-toolbar">
                    <span class="text-dim">{{ template.format.toUpperCase() }} · {{ formatBytes(template.bytes) }}</span>
                    <button class="btn sm" @click="copy(template.body)">{{ t('awsLogs.q.copy') }}</button>
                  </div>
                  <pre class="cfn-template"><code>{{ template.body }}</code></pre>
                </template>

                <!-- Change sets -->
                <CfnChangeSets
                  v-else-if="detailTab === 'changesets'"
                  :stack-id="s.id" :stack-name="s.name" :profile-id="profileId" :focus="focusChangeSet"
                  @changed="afterChange(s)" @request-access="emit('request-access', $event)"
                />

                <!-- Operations -->
                <CfnOperations
                  v-else-if="detailTab === 'operations' && detail"
                  :stack="detail.stack" :profile-id="profileId"
                  @changed="afterChange(s)" @change-set-created="openCreatedChangeSet" @request-access="emit('request-access', $event)"
                />

                <!-- Drift -->
                <template v-else-if="detailTab === 'drift'">
                  <div class="cfn-toolbar">
                    <span>{{ t('cfn.lastDrift') }} <span class="msg-chip" :class="driftClass(s.drift.status)">{{ t(`cfn.drift_${s.drift.status}`) }}</span>
                      <span v-if="s.drift.checkedAt" class="text-dim"> · {{ formatTime(s.drift.checkedAt, settings.lang) }}</span></span>
                    <button class="btn sm primary" :disabled="drift.running" @click="detectDrift(s)">{{ drift.running ? t('cfn.detecting') : t('cfn.detectDrift') }}</button>
                  </div>
                  <div class="cfn-hint">{{ t('cfn.driftHint') }}</div>
                  <template v-if="drift.result">
                    <div class="text-dim">{{ t('cfn.driftSummary', { status: drift.result.stackDriftStatus || drift.result.detectionStatus, n: drift.result.driftedResources ?? 0 }) }}</div>
                    <div v-if="drift.result.detectionStatusReason" class="activity-notice">{{ drift.result.detectionStatusReason }}</div>
                    <article v-for="r in drift.result.resources" :key="r.logicalId" class="cfn-drift">
                      <header><span class="msg-chip warn">{{ t(`cfn.drift_${r.status}`) }}</span> <strong>{{ r.logicalId }}</strong> <code class="text-dim">{{ r.type }}</code></header>
                      <table v-if="r.differences.length" class="msg-subtable">
                        <thead><tr><th>{{ t('cfn.property') }}</th><th>{{ t('cfn.expected') }}</th><th>{{ t('cfn.actual') }}</th></tr></thead>
                        <tbody><tr v-for="d in r.differences" :key="d.path"><td><code>{{ d.path }}</code></td><td class="cfn-break">{{ d.expected ?? '—' }}</td><td class="cfn-break">{{ d.actual ?? '—' }}</td></tr></tbody>
                      </table>
                    </article>
                  </template>
                </template>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useSortable } from '../../../composables/useSortable'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { formatBytes, formatTime } from '../../../lib/awsLogs'
import CfnApplications from './CfnApplications.vue'
import CfnChangeSets from './CfnChangeSets.vue'
import CfnExports from './CfnExports.vue'
import CfnOperations from './CfnOperations.vue'

const props = defineProps({ profileId: { type: String, default: '' }, initialSearch: { type: String, default: '' } })
const emit = defineEmits(['request-access', 'open-resource', 'open-application'])
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const { sortBy, sortRows, sortIcon, thClass, ariaSort } = useSortable()

const GROUPS = ['all', 'ok', 'progress', 'failed', 'rollback', 'review', 'drifted']
const DETAIL_TABS = ['overview', 'resources', 'events', 'template', 'drift', 'changesets', 'operations']
const BASE = '/api/cloud/aws/cloudformation'

const data = ref(null)
const loading = ref(false)
const notice = ref(null)
const search = ref(props.initialSearch)
const group = ref('all')
const showNested = ref(false)
const selected = ref(null)
const detailTab = ref('overview')
const detail = ref(null)
const detailLoading = ref(false)
const events = ref(null)
const template = ref(null)
const resourceSearch = ref('')
const driftedOnly = ref(false)
const failuresOnly = ref(false)
const drift = reactive({ running: false, result: null })
const view = ref('stacks')
const exportsData = ref(null)
const focusChangeSet = ref('')

function importsOf(exportName) {
  const item = exportsData.value?.exports.find(e => e.name === exportName)
  if (!item) return ''
  return item.importedBy.length ? t('cfn.exports.importedByList', { stacks: item.importedBy.join(', ') }) : t('cfn.exports.unused')
}

async function loadExports() {
  if (exportsData.value) return
  try { exportsData.value = await apiFetch(`${BASE}/exports`, { headers: headers() }) } catch { /* outputs still show without imports */ }
}

function openFromExports(stackRef) {
  view.value = 'stacks'
  selectById(stackRef)
}

function openApplication(app) {
  emit('open-application', { id: app.applicationId, name: app.name, environment: app.environment, region: app.region, provider: 'aws', profileId: props.profileId })
}

// A parameter preview created a change set: review it in the change sets tab.
function openCreatedChangeSet(id) {
  focusChangeSet.value = id
  detailTab.value = 'changesets'
}

// After an operation, refresh the list and the open stack.
function afterChange(stack) {
  load()
  loadDetail(stack)
}
let driftTimer = null

const stacks = computed(() => (data.value?.stacks || []).map(s => ({ ...s, lastChange: s.updatedTime || s.createdTime })))
const driftedCount = computed(() => stacks.value.filter(s => s.drift.status === 'DRIFTED').length)
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return stacks.value.filter(s =>
    (showNested.value || !s.parentId || q) &&
    (group.value === 'all' || (group.value === 'drifted' ? s.drift.status === 'DRIFTED' : s.statusGroup === group.value)) &&
    (!q || s.name.toLowerCase().includes(q) || (s.description || '').toLowerCase().includes(q)))
})
const resourceRows = computed(() => {
  const q = resourceSearch.value.trim().toLowerCase()
  return (detail.value?.resources || []).filter(r =>
    (!driftedOnly.value || ['MODIFIED', 'DELETED'].includes(r.drift)) &&
    (!q || `${r.type} ${r.logicalId} ${r.physicalId || ''}`.toLowerCase().includes(q)))
})
const eventRows = computed(() => (events.value?.events || []).filter(e => !failuresOnly.value || /FAILED$/.test(e.status)))

function chipClass(groupName) {
  return { ok: 'ok', failed: 'err', rollback: 'err', progress: 'warn', review: 'warn' }[groupName] || ''
}
function driftClass(status) {
  return { IN_SYNC: 'ok', DRIFTED: 'warn', MODIFIED: 'warn', DELETED: 'err' }[status] || ''
}
function nameFromId(id) {
  return String(id || '').split('/')[1] || id
}

function headers(json = false) {
  return { 'X-Profile-Id': props.profileId, ...(json ? { 'Content-Type': 'application/json' } : {}) }
}
function fail(err) {
  notice.value = { text: err.message, access: err.details?.access || null }
}

async function load() {
  if (!props.profileId) return
  loading.value = true
  notice.value = null
  try { data.value = await apiFetch(`${BASE}/stack-list`, { headers: headers() }) } catch (err) { fail(err) } finally { loading.value = false }
}

async function loadDetail(stack) {
  detailLoading.value = true
  try { detail.value = await apiFetch(`${BASE}/stack?stack=${encodeURIComponent(stack.id)}`, { headers: headers() }) } catch (err) { fail(err) } finally { detailLoading.value = false }
}

async function openTab(stack, tab) {
  detailTab.value = tab
  if (tab === 'events' && !events.value) {
    detailLoading.value = true
    try { events.value = await apiFetch(`${BASE}/stack/events?stack=${encodeURIComponent(stack.id)}&name=${encodeURIComponent(stack.name)}`, { headers: headers() }) } catch (err) { fail(err) } finally { detailLoading.value = false }
  }
  if (tab === 'template' && !template.value) {
    detailLoading.value = true
    try { template.value = await apiFetch(`${BASE}/stack/template?stack=${encodeURIComponent(stack.id)}`, { headers: headers() }) } catch (err) { fail(err) } finally { detailLoading.value = false }
  }
}

function toggle(stack) {
  clearTimeout(driftTimer)
  if (selected.value === stack.id) { selected.value = null; return }
  selected.value = stack.id
  Object.assign(drift, { running: false, result: null })
  detail.value = null
  events.value = null
  template.value = null
  resourceSearch.value = ''
  // A failed stack opens on its events, where the root cause is.
  const failed = ['failed', 'rollback'].includes(stack.statusGroup)
  detailTab.value = failed ? 'events' : 'overview'
  focusChangeSet.value = ''
  loadDetail(stack)
  if (stack.outputs?.some(o => o.exportName)) loadExports()
  if (failed) openTab(stack, 'events')
}

function selectById(id) {
  const stack = stacks.value.find(s => s.id === id || s.name === id || s.name === nameFromId(id))
  if (!stack) return
  showNested.value = true
  search.value = ''
  group.value = 'all'
  if (selected.value !== stack.id) toggle(stack)
}

async function detectDrift(stack) {
  drift.running = true
  drift.result = null
  try {
    const { detectionId } = await apiFetch(`${BASE}/stack/drift`, { method: 'POST', headers: headers(true), body: JSON.stringify({ stack: stack.id }) })
    await pollDrift(stack, detectionId, 0)
  } catch (err) { fail(err); drift.running = false }
}

async function pollDrift(stack, detectionId, attempt) {
  try {
    const result = await apiFetch(`${BASE}/stack/drift?stack=${encodeURIComponent(stack.id)}&detectionId=${detectionId}`, { headers: headers() })
    drift.result = result
    if (result.detectionStatus === 'DETECTION_IN_PROGRESS' && attempt < 90) {
      driftTimer = setTimeout(() => pollDrift(stack, detectionId, attempt + 1), 2000)
      return
    }
    drift.running = false
    // Refresh the list (drift status) and the resources (per-resource drift).
    load()
    loadDetail(stack)
  } catch (err) { fail(err); drift.running = false }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(t('awsLogs.intel.copied'), 'success') } catch { /* clipboard unavailable */ }
}

defineExpose({ load, selectById })
onMounted(load)
onBeforeUnmount(() => clearTimeout(driftTimer))
</script>

<style scoped>
.cfn { display: flex; flex-direction: column; gap: 8px; }
.cfn-views { display: flex; gap: 4px; }
.cfn-head, .cfn-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cfn-search { min-width: 220px; flex: 1 1 220px; max-width: 420px; }
.cfn-chips, .cfn-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.cfn-check { display: flex; gap: 4px; align-items: center; font-size: 12px; }
.cfn-hint { font-size: 11px; color: var(--text-dim); }
.cfn-name { white-space: normal; }
.cfn-nested { padding-left: 10px; border-left: 2px solid var(--border); }
.cfn-desc { font-size: 11px; white-space: normal; overflow-wrap: anywhere; }
.cfn-time { white-space: nowrap; font-size: 11px; }
.cfn-detail { display: flex; flex-direction: column; gap: 10px; padding: 6px 2px; white-space: normal; }
.cfn-break { overflow-wrap: anywhere; white-space: normal; }
.cfn-link { background: none; border: 0; padding: 0; color: var(--accent); cursor: pointer; font: inherit; }
.cfn-root { border: 1px solid color-mix(in srgb, var(--red) 50%, var(--border)); border-left-width: 3px; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.cfn-root strong { color: var(--red); }
.cfn-root p { margin: 0; overflow-wrap: anywhere; }
.cfn-root-row td { background: color-mix(in srgb, var(--red) 8%, transparent); }
.cfn-template { max-height: 480px; overflow: auto; margin: 0; padding: 10px; font-size: 11px; background: var(--bg-row); border: 1px solid var(--border); border-radius: 4px; }
.cfn-drift { border: 1px solid var(--border); border-radius: 6px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.cfn-drift header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; }
</style>
