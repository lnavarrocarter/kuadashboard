<template>
  <section class="public-endpoints" data-test="aws-public-endpoints">
    <header class="public-endpoints-header">
      <div>
        <h3>{{ t('publicEndpoints.title') }}</h3>
        <p class="text-dim">{{ t('publicEndpoints.scope', { account: accountId || '—', region: region || '—' }) }}</p>
      </div>
      <div class="public-endpoints-actions">
        <button type="button" class="btn sm" :disabled="loading || !profileId" @click="load">
          {{ t(loading ? 'common.loading' : inventory ? 'action.refresh' : 'publicEndpoints.load') }}
        </button>
        <button type="button" class="btn sm" :disabled="!filtered.length" @click="download('json')">JSON</button>
        <button type="button" class="btn sm" :disabled="!filtered.length" @click="download('csv')">CSV</button>
      </div>
    </header>

    <p class="text-dim">{{ t('publicEndpoints.note') }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="inventory?.partial" role="status">{{ t('publicEndpoints.partial') }}</p>
    <p v-for="source in inventory?.unavailable || []" :key="source.source" role="status">
      {{ t('publicEndpoints.unavailable', { source: source.source }) }}
    </p>
    <p v-if="inventory" class="text-dim" data-test="request-count">
      {{ t('publicEndpoints.requestCount', { requests: inventory.requests || 0, count: inventory.entries?.length || 0 }) }}
    </p>

    <template v-if="inventory">
      <div class="public-endpoints-filters">
        <label>
          <span>{{ t('awsCtx.account') }}</span>
          <input v-model="accountFilter" type="search" class="ctrl-input" :placeholder="props.accountId || '—'" />
        </label>
        <label>
          <span>{{ t('publicEndpoints.domain') }}</span>
          <input v-model="domainFilter" type="search" class="ctrl-input" data-test="domain-filter" :placeholder="t('publicEndpoints.domainPlaceholder')" />
        </label>
        <label>
          <span>{{ t('publicEndpoints.status') }}</span>
          <select v-model="statusFilter" class="ctrl-select">
            <option value="">{{ t('awsFilter.any', { label: t('publicEndpoints.status') }) }}</option>
            <option value="resolved">{{ t('publicEndpoints.resolved') }}</option>
            <option value="unresolved">{{ t('publicEndpoints.unresolved') }}</option>
          </select>
        </label>
        <label>
          <span>{{ t('publicEndpoints.risk') }}</span>
          <select v-model="riskFilter" class="ctrl-select">
            <option value="">{{ t('awsFilter.any', { label: t('publicEndpoints.risk') }) }}</option>
            <option value="high">{{ t('publicEndpoints.risk.high') }}</option>
            <option value="medium">{{ t('publicEndpoints.risk.medium') }}</option>
            <option value="low">{{ t('publicEndpoints.risk.low') }}</option>
            <option value="unknown">{{ t('publicEndpoints.risk.unknown') }}</option>
          </select>
        </label>
      </div>

      <p v-if="!filtered.length" class="empty-row">{{ t('publicEndpoints.empty') }}</p>
      <table v-else class="cloud-table">
        <thead><tr>
          <th>{{ t('publicEndpoints.domain') }}</th>
          <th>{{ t('publicEndpoints.risk') }}</th>
          <th>{{ t('publicEndpoints.status') }}</th>
          <th>{{ t('publicEndpoints.chain') }}</th>
        </tr></thead>
        <tbody>
          <template v-for="entry in filtered" :key="entry.id">
            <tr>
              <td class="mono-xs">{{ entry.hostname }}</td>
              <td><span :class="['public-endpoints-risk', `risk-${risk(entry)}`]">{{ t(`publicEndpoints.risk.${risk(entry)}`) }}</span></td>
              <td>{{ t(`publicEndpoints.${status(entry)}`) }}</td>
              <td>
                <button type="button" class="btn sm" :aria-expanded="expanded === entry.id" @click="expanded = expanded === entry.id ? '' : entry.id">
                  {{ t(expanded === entry.id ? 'publicEndpoints.hideChain' : 'publicEndpoints.showChain') }}
                </button>
              </td>
            </tr>
            <tr v-if="expanded === entry.id" class="public-endpoints-chain-row">
              <td colspan="4">
                <ol class="public-endpoints-chain" :aria-label="t('publicEndpoints.chain')">
                  <li v-for="(hop, index) in entry.hops || []" :key="`${entry.id}:${index}`">
                    <strong>{{ hop.type.replaceAll('_', ' ') }}</strong>
                    <span v-if="hop.name"> · {{ hop.name }}</span>
                    <span v-if="hop.port"> · :{{ hop.port }}</span>
                    <span v-if="hop.reason" class="text-dim"> · {{ hop.reason }}</span>
                    <span v-if="hop.health?.total" class="text-dim"> · {{ hop.health.healthy }}/{{ hop.health.total }}</span>
                  </li>
                </ol>
                <ul v-if="entry.findings?.length" class="public-endpoints-findings">
                  <li v-for="finding in entry.findings" :key="finding.id" :class="`risk-${finding.severity}`">
                    {{ finding.key ? t(finding.key) : (finding.title || finding.id) }}
                    <span v-if="finding.whyKey || finding.why"> · {{ finding.whyKey ? t(finding.whyKey) : finding.why }}</span>
                  </li>
                </ul>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>
  </section>
</template>

<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import { api } from '../../../composables/useApi'
import { useI18n } from '../../../composables/useI18n'

const props = defineProps({
  active: { type: Boolean, default: false },
  profileId: { type: String, default: '' },
  accountId: { type: String, default: '' },
  region: { type: String, default: '' },
})
const { t } = useI18n()
const inventory = ref(null)
const error = ref('')
const loading = ref(false)
const domainFilter = ref('')
const accountFilter = ref('')
const statusFilter = ref('')
const riskFilter = ref('')
const expanded = ref('')
let generation = 0
let mounted = true

function status(entry) {
  return (entry.hops || []).some(hop => hop.status === 'unresolved') ? 'unresolved' : 'resolved'
}

function risk(entry) {
  const severity = entry.findings?.reduce((rank, finding) => Math.max(rank, { high: 3, medium: 2, low: 1 }[finding.severity] || 0), 0)
  if (severity) return ({ 3: 'high', 2: 'medium', 1: 'low' })[severity]
  return status(entry) === 'unresolved' ? 'unknown' : 'low'
}

const filtered = computed(() => (inventory.value?.entries || []).filter(entry => {
  if (accountFilter.value && !String(props.accountId).includes(accountFilter.value.trim())) return false
  const host = String(entry.hostname || '').toLowerCase()
  if (domainFilter.value && !host.includes(domainFilter.value.trim().toLowerCase())) return false
  if (statusFilter.value && status(entry) !== statusFilter.value) return false
  return !riskFilter.value || risk(entry) === riskFilter.value
}))

async function load() {
  if (!props.profileId || loading.value) return
  const current = ++generation
  loading.value = true
  error.value = ''
  try {
    const result = await api('GET', '/api/cloud/aws/public-endpoints', undefined, {
      headers: { 'X-Profile-Id': props.profileId },
    })
    if (mounted && current === generation) inventory.value = result
  } catch (err) {
    if (mounted && current === generation) error.value = err.message
  } finally {
    if (mounted && current === generation) loading.value = false
  }
}

function download(format) {
  const entries = filtered.value.map(entry => ({
    hostname: entry.hostname,
    risk: risk(entry),
    status: status(entry),
    region: props.region || inventory.value?.region || '',
    accountId: props.accountId,
    findings: entry.findings || [],
    hops: entry.hops || [],
  }))
  const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  const body = format === 'json'
    ? JSON.stringify({ region: inventory.value?.region || props.region || null, requests: inventory.value?.requests || 0, entries }, null, 2)
    : [
      ['hostname', 'risk', 'status', 'accountId', 'region', 'chain', 'findings'].map(csvCell).join(','),
      ...entries.map(entry => [entry.hostname, entry.risk, entry.status, entry.accountId, entry.region,
        entry.hops.map(hop => [hop.type, hop.name, hop.port].filter(Boolean).join(':')).join(' → '),
        entry.findings.map(finding => finding.id).join('; ')].map(csvCell).join(',')),
    ].join('\n')
  const blob = new Blob([body], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `kua-public-endpoints.${format}`
  link.click()
  URL.revokeObjectURL(url)
}

watch(() => [props.active, props.profileId], ([active, profileId], previous = []) => {
  if (profileId !== previous[1]) {
    generation += 1
    inventory.value = null
    expanded.value = ''
    loading.value = false
  }
  if (active && profileId) load()
}, { immediate: true })

onUnmounted(() => { mounted = false; generation += 1 })
</script>

<style scoped>
.public-endpoints { padding: 12px 0; }
.public-endpoints-header, .public-endpoints-actions, .public-endpoints-filters { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
.public-endpoints-header { justify-content: space-between; align-items: center; }
.public-endpoints-header h3 { margin: 0; font-size: 13px; }
.public-endpoints-header p { margin: 4px 0 0; font-size: 11px; }
.public-endpoints-filters { margin: 12px 0; }
.public-endpoints-filters label { display: grid; gap: 4px; color: var(--text-dim); font-size: 11px; }
.public-endpoints-filters input, .public-endpoints-filters select { min-width: 170px; }
.public-endpoints-chain-row > td { background: var(--bg-secondary); }
.public-endpoints-chain { margin: 0; padding-left: 20px; }
.public-endpoints-chain li { padding: 3px 0; }
.public-endpoints-risk { font-weight: 600; text-transform: capitalize; }
.risk-high { color: var(--danger, #ef4444); }
.risk-medium { color: var(--warning, #f59e0b); }
.risk-low { color: var(--success, #22c55e); }
.risk-unknown { color: var(--text-dim); }
.public-endpoints-findings { margin-top: 10px; }
</style>
