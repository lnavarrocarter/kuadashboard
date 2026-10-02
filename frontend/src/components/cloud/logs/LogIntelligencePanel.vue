<template>
  <div class="li">
    <div v-if="loading" class="empty-row">{{ t('common.loading') }}</div>
    <div v-else-if="error" class="activity-notice">{{ error }}</div>
    <template v-else-if="data">
      <div class="li-stats">
        <div class="li-stat"><b>{{ data.last24h.events }}</b><span>{{ t('awsLogs.intel.events24h') }}</span></div>
        <div class="li-stat" :class="{ bad: (data.last24h.errorRatePercent || 0) >= 5 }">
          <b>{{ data.last24h.errorRatePercent == null ? '—' : `${data.last24h.errorRatePercent}%` }}</b>
          <span>{{ t('awsLogs.intel.errorRate24h', { n: data.last24h.errors }) }}</span>
        </div>
        <div class="li-stat"><b>{{ data.last24h.warnings }}</b><span>{{ t('awsLogs.intel.warnings24h') }}</span></div>
        <div class="li-stat">
          <b>{{ data.last7d.errorRatePercent == null ? '—' : `${data.last7d.errorRatePercent}%` }}</b>
          <span>{{ t('awsLogs.intel.errorRate7d', { n: data.last7d.events }) }}</span>
        </div>
        <div class="li-stat" :class="{ bad: sensitiveTotal > 0 }"><b>{{ sensitiveTotal }}</b><span>{{ t('awsLogs.intel.sensitive7d') }}</span></div>
      </div>

      <!-- Activity over time -->
      <LogActivityChart ref="chart" :group="group" :profile-id="profileId" :category="filter.category" :level="filter.level" @range="onRange" />

      <!-- Recommendations -->
      <section v-if="data.recommendations?.length" class="msg-section">
        <h5>{{ t('awsLogs.intel.recommendations') }}</h5>
        <article v-for="rec in data.recommendations" :key="rec.id" class="li-rec" :class="rec.severity">
          <header>
            <span class="msg-chip" :class="rec.severity === 'high' ? 'err' : rec.severity === 'medium' ? 'warn' : ''">{{ t(`awsLogs.intel.severity_${rec.severity}`) }}</span>
            <span class="msg-chip">{{ t(`awsLogs.intel.kind_${rec.kind}`) }}</span>
            <strong>{{ t(`awsLogs.rec.${rec.id}.title`, rec.params) }}</strong>
            <span class="text-dim li-confidence">{{ t('apm.confidence', { confidence: Math.round(rec.confidence * 100) }) }}</span>
          </header>
          <p>{{ t(`awsLogs.rec.${rec.id}.body`, rec.params) }}</p>
          <div v-if="rec.evidence?.signatures?.length" class="li-evidence">
            <span class="text-dim">{{ t('awsLogs.intel.evidence') }}</span>
            <code v-for="s in rec.evidence.signatures" :key="s.signature" :title="s.sample">{{ s.signature }} × {{ s.occurrences }}</code>
          </div>
          <div v-if="rec.evidence?.sensitive7d" class="li-evidence">
            <span class="text-dim">{{ t('awsLogs.intel.evidence') }}</span>
            <span v-for="(count, type) in rec.evidence.sensitive7d" :key="type" class="msg-chip warn">{{ t(`awsLogs.sens.${type}`) }} × {{ count }}</span>
          </div>
          <div class="li-actions">
            <template v-for="(action, i) in rec.actions" :key="i">
              <button v-if="action.type === 'filter'" class="btn sm" @click="applyFilter({ category: action.category })">{{ t('awsLogs.intel.viewEvents') }}</button>
              <button v-else-if="action.type === 'query'" class="btn sm" @click="copy(action.query)">{{ t('awsLogs.intel.copyQuery') }}</button>
              <button v-else-if="action.type === 'snippet'" class="btn sm" :class="{ accent: openSnippet === `${rec.id}:${i}` }" @click="openSnippet = openSnippet === `${rec.id}:${i}` ? null : `${rec.id}:${i}`">
                {{ t('awsLogs.intel.snippet', { language: action.language }) }}
              </button>
              <a v-else-if="action.type === 'link'" class="btn sm" :href="action.url" target="_blank" rel="noopener noreferrer">{{ t('awsLogs.intel.docs') }} ↗</a>
            </template>
          </div>
          <template v-for="(action, i) in rec.actions" :key="`code-${i}`">
            <div v-if="action.type === 'snippet' && openSnippet === `${rec.id}:${i}`" class="li-snippet">
              <button class="btn sm" @click="copy(action.code)">{{ t('awsLogs.q.copy') }}</button>
              <pre><code>{{ action.code }}</code></pre>
            </div>
          </template>
        </article>
      </section>

      <!-- Categories and filters -->
      <section class="msg-section">
        <h5>{{ t('awsLogs.intel.categories') }}</h5>
        <div class="li-chips">
          <button
            v-for="item in categories" :key="item.category"
            class="btn sm li-cat" :class="[item.group, { accent: filter.category === item.category }]"
            :title="t(`awsLogs.catHint.${item.category}`)"
            @click="applyFilter({ category: filter.category === item.category ? '' : item.category })"
          >{{ t(`awsLogs.cat.${item.category}`) }} <span class="text-dim">{{ item.count }}</span></button>
        </div>
        <div class="li-filters">
          <select v-model="filter.level" class="ctrl-select" :aria-label="t('awsLogs.intel.level')" @change="applyFilter({})">
            <option value="">{{ t('awsLogs.intel.allLevels') }}</option>
            <option value="error">{{ t('awsLogs.intel.level_error') }}</option>
            <option value="warn">{{ t('awsLogs.intel.level_warn') }}</option>
            <option value="info">{{ t('awsLogs.intel.level_info') }}</option>
          </select>
          <span v-if="filter.signature" class="msg-chip warn li-sig-chip" :title="filter.signature">{{ filter.signature }} <button class="li-x" :aria-label="t('awsLogs.intel.clear')" @click="applyFilter({ signature: '' })">×</button></span>
          <button v-if="filter.category || filter.level || filter.signature" class="btn sm" @click="clearFilter">{{ t('awsLogs.intel.clear') }}</button>
          <button v-if="filter.category" class="btn sm" @click="copy(categoryQuery(filter.category))">{{ t('awsLogs.intel.copyQuery') }}</button>
        </div>
        <div v-if="!events && !eventsLoading" class="text-dim li-meta">{{ t('awsLogs.chart.pickHint') }}</div>
        <div v-if="eventsLoading" class="empty-row">{{ t('awsLogs.intel.decrypting') }}</div>
        <template v-else-if="events">
          <div class="text-dim li-meta">{{ t('awsLogs.intel.filtered', { n: events.events.length, blocks: events.blocksRead }) }}<template v-if="events.truncated"> · {{ t('awsLogs.intel.more') }}</template></div>
          <div v-if="events.events.length" class="cwl-events">
            <div v-for="(e, i) in events.events" :key="i" class="li-event">
              <span class="cwl-ts">{{ formatTime(e.timestamp, settings.lang) }}</span>
              <span class="msg-chip" :class="e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : ''">{{ t(`awsLogs.cat.${e.category}`) }}</span>
              <span class="cwl-msg">{{ e.message }}</span>
            </div>
          </div>
        </template>
      </section>

      <div class="msg-columns">
        <section class="msg-section">
          <h5>{{ t('awsLogs.intel.signatures') }}</h5>
          <div v-if="!data.signatures.length" class="text-dim">{{ t('awsLogs.intel.noSignatures') }}</div>
          <table v-else class="msg-subtable">
            <tbody>
              <tr v-for="s in data.signatures" :key="s.signature" class="li-sig-row" @click="applyFilter({ signature: s.signature, category: '' })">
                <td><span class="msg-chip" :class="s.level === 'error' ? 'err' : 'warn'">{{ t(`awsLogs.cat.${s.category || 'other_error'}`) }}</span></td>
                <td :title="s.sample"><code class="li-sig">{{ s.signature }}</code></td>
                <td class="activity-cell">× {{ s.occurrences }}</td>
                <td class="text-dim li-time">{{ formatTime(s.lastSeen, settings.lang) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section class="msg-section">
          <h5>{{ t('awsLogs.intel.references') }}</h5>
          <div v-if="!data.references.length" class="text-dim">{{ t('awsLogs.intel.noReferences') }}</div>
          <ul v-else class="msg-list">
            <li v-for="r in data.references" :key="r.kind + r.target" :title="r.target">
              <span class="msg-chip">{{ r.type }}</span> {{ r.name }}<span v-if="r.namespace" class="text-dim">.{{ r.namespace }}</span>
              <span class="text-dim"> × {{ r.occurrences }}</span>
            </li>
          </ul>
        </section>
        <section class="msg-section">
          <h5>{{ t('awsLogs.intel.observability') }}</h5>
          <div v-if="!data.apm.length" class="text-dim">{{ t('awsLogs.intel.notLinked') }}</div>
          <ul v-else class="msg-list">
            <li v-for="link in data.apm" :key="link.applicationId + link.resourceId">
              <b>{{ link.applicationName }}</b><span v-if="link.environment" class="text-dim"> ({{ link.environment }})</span> → {{ link.type }} {{ link.resourceName }}
            </li>
          </ul>
        </section>
      </div>
      <div class="cwl-hint">{{ t('awsLogs.intel.privacy', { analyzed: data.eventsAnalyzed }) }}</div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useApi } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'
import { useToast } from '../../../composables/useToast'
import { settings } from '../../../composables/useSettings'
import { formatTime } from '../../../lib/awsLogs'
import { CATEGORIES, categoryQuery } from '../../../shared/logSignals.mjs'
import LogActivityChart from './LogActivityChart.vue'

const props = defineProps({ group: { type: String, required: true }, profileId: { type: String, default: '' } })
const { t } = useI18n()
const { apiFetch } = useApi()
const { toast } = useToast()
const data = ref(null)
const loading = ref(false)
const error = ref(null)
const events = ref(null)
const eventsLoading = ref(false)
const openSnippet = ref(null)
const filter = reactive({ category: '', level: '', signature: '' })
// Window of the event list: follows the chart (range buttons and zoom).
const chart = ref(null)
const range = ref({ from: null, to: null, zoomed: false })

function onRange(next) {
  range.value = next
  loadEvents()
}

function currentRange() {
  return range.value.from ? range.value : (chart.value?.currentRange() || { from: Date.now() - 86400000, to: Date.now(), zoomed: false })
}

const GROUPS = Object.fromEntries(CATEGORIES.map(c => [c.id, c.group]))
const categories = computed(() => Object.entries(data.value?.categories7d || {})
  .map(([category, count]) => ({ category, count, group: GROUPS[category] || (category === 'info' ? 'info' : 'failure') }))
  .sort((a, b) => (a.group === 'failure' ? 0 : 1) - (b.group === 'failure' ? 0 : 1) || b.count - a.count))
const sensitiveTotal = computed(() => Object.values(data.value?.sensitive7d || {}).reduce((sum, n) => sum + n, 0))

function headers() { return { 'X-Profile-Id': props.profileId } }

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = await apiFetch(`/api/cloud/aws/cloudwatch/log-intelligence?group=${encodeURIComponent(props.group)}`, { headers: headers() })
  } catch (err) { error.value = err.message } finally { loading.value = false }
}

async function loadEvents() {
  if (!filter.category && !filter.level && !filter.signature && !currentRange().zoomed) { events.value = null; return }
  eventsLoading.value = true
  try {
    const { from, to } = currentRange()
    const query = new URLSearchParams({ group: props.group, from, to })
    if (filter.category) query.set('category', filter.category)
    if (filter.level) query.set('level', filter.level)
    if (filter.signature) query.set('signature', filter.signature)
    events.value = await apiFetch(`/api/cloud/aws/cloudwatch/log-intelligence/events?${query}`, { headers: headers() })
  } catch (err) { error.value = err.message } finally { eventsLoading.value = false }
}

function applyFilter(changes) {
  Object.assign(filter, changes)
  loadEvents()
}

function clearFilter() {
  Object.assign(filter, { category: '', level: '', signature: '' })
  loadEvents()
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('awsLogs.intel.copied'), 'success')
  } catch { /* clipboard unavailable */ }
}

defineExpose({ load, applyFilter, zoom: window => chart.value?.zoom(window) })
onMounted(load)
</script>

<style scoped>
.li { display: flex; flex-direction: column; gap: 12px; padding: 6px 2px; white-space: normal; }
.li-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.li-stat { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; min-width: 120px; font-size: 11px; color: var(--text-dim); }
.li-stat b { font-size: 16px; color: var(--text); }
.li-stat.bad b { color: var(--red); }
.li-chips { display: flex; gap: 4px; flex-wrap: wrap; }
.li-cat.client, .li-cat.platform, .li-cat.noise, .li-cat.info { opacity: .85; }
.li-filters { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.li-sig-chip { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.li-x { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 0 0 4px; }
.li-meta { font-size: 11px; }
.li-event { display: grid; grid-template-columns: 150px 120px 1fr; gap: 8px; padding: 3px 8px; border-bottom: 1px solid var(--border); align-items: baseline; }
.li-sig { font-size: 11px; overflow-wrap: anywhere; }
.li-sig-row { cursor: pointer; }
.li-sig-row:hover td { background: var(--bg-hover); }
.li-time { white-space: nowrap; font-size: 11px; }
.li-rec { border: 1px solid var(--border); border-left-width: 3px; border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.li-rec.high { border-left-color: var(--red); }
.li-rec.medium { border-left-color: var(--yellow); }
.li-rec header { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; }
.li-rec p { margin: 0; font-size: 12px; line-height: 1.45; }
.li-confidence { margin-left: auto; font-size: 11px; }
.li-evidence { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 11px; }
.li-evidence code { font-size: 10px; padding: 0 4px; border-radius: 3px; background: var(--bg-hover); overflow-wrap: anywhere; }
.li-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.li-actions a.btn { text-decoration: none; }
.li-snippet { position: relative; }
.li-snippet .btn { position: absolute; right: 6px; top: 6px; }
.li-snippet pre { margin: 0; padding: 10px; max-height: 280px; overflow: auto; font-size: 11px; background: var(--bg-row); border: 1px solid var(--border); border-radius: 4px; }
.cwl-events { max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-row); font-family: monospace; font-size: 11px; }
.cwl-ts { color: var(--text-dim); white-space: nowrap; }
.cwl-msg { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.cwl-hint { font-size: 11px; color: var(--text-dim); }
@media (max-width: 720px) { .li-event { grid-template-columns: 1fr; } }
</style>
