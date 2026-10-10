<template>
  <Teleport to="body">
    <div v-if="open" class="lmd-backdrop" @mousedown.self="$emit('close')">
      <div class="lmd-modal">

        <!-- Header -->
        <div class="lmd-header">
          <div class="lmd-title">
            <span class="lmd-icon">λ</span>
            <span>{{ fn?.name }}</span>
            <span v-if="fn?.runtime" class="lmd-badge runtime">{{ fn.runtime }}</span>
            <span v-if="data?.basic?.state" :class="['lmd-state', data.basic.state]">{{ data.basic.state }}</span>
          </div>
          <button class="lmd-close" @click="$emit('close')" :aria-label="t('action.close')" :title="t('action.close')">✕</button>
        </div>

        <!-- Tabs -->
        <div class="lmd-tabs">
          <button v-for="tab in TABS" :key="tab.id"
            :class="['lmd-tab', { active: activeTab === tab.id }]"
            @click="switchTab(tab.id)">
            {{ tab.label }}
          </button>
          <div class="lmd-tabs-right">
            <button v-if="!detailLoaded && !loading" class="btn sm" @click="loadDetails">{{ t('lmd.load') }}</button>
            <button v-else-if="detailLoaded" class="btn sm" @click="loadDetails" :disabled="loading" :title="t('action.refresh')">↺</button>
          </div>
        </div>

        <!-- Body -->
        <div class="lmd-body">

          <div v-if="loading" class="lmd-spinner-wrap">
            <div class="lmd-spinner"></div>
            <span>{{ codeLoading ? t('lmd.downloadingCode') : t('common.loading') }}</span>
          </div>
          <div v-else-if="error" class="lmd-error">{{ error }}</div>

          <template v-else-if="data">

            <!-- ══ BÁSICO ════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'basic'" class="lmd-section">
              <div class="lmd-grid">
                <div class="lmd-card">
                  <div class="lmd-card-title">{{ t('lmd.function') }}</div>
                  <dl>
                    <dt>{{ t('res.name') }}</dt>       <dd>{{ data.basic.name }}</dd>
                    <dt>{{ t('res.description') }}</dt>  <dd>{{ data.basic.description || '—' }}</dd>
                    <dt>ARN</dt>          <dd class="mono wrap copyable">{{ data.basic.arn }}<button class="copy-btn" @click.stop="copyField(data.basic.arn,'arn')" :title="copiedKey==='arn' ? t('res.copied') : t('action.copy')">{{ copiedKey==='arn' ? '✓' : '⧉' }}</button></dd>
                    <dt>{{ t('res.state') }}</dt>
                    <dd>
                      <span :class="['lmd-state', data.basic.state]">{{ data.basic.state }}</span>
                      <span v-if="data.basic.stateReason" class="text-dim" style="font-size:.75rem;margin-left:6px">{{ data.basic.stateReason }}</span>
                    </dd>
                    <dt>{{ t('lmd.version') }}</dt>      <dd class="mono">{{ data.basic.version }}</dd>
                    <dt>{{ t('lmd.modified') }}</dt>   <dd>{{ fmtDate(data.basic.lastModified) }}</dd>
                  </dl>
                </div>

                <div class="lmd-card">
                  <div class="lmd-card-title">Runtime</div>
                  <dl>
                    <dt>Runtime</dt>      <dd class="mono">{{ data.basic.runtime }}</dd>
                    <dt>Handler</dt>      <dd class="mono">{{ data.basic.handler }}</dd>
                    <dt>{{ t('ec2d.architecture') }}</dt> <dd class="mono">{{ data.basic.architecture }}</dd>
                    <dt>{{ t('lmd.package') }}</dt>      <dd class="mono">{{ data.basic.packageType }}</dd>
                    <dt v-if="data.basic.imageUri">{{ t('lmd.image') }}</dt>
                    <dd v-if="data.basic.imageUri" class="mono wrap">{{ data.basic.imageUri }}</dd>
                    <dt>SnapStart</dt>    <dd>{{ data.basic.snapStart || 'None' }}</dd>
                  </dl>
                </div>

                <div class="lmd-card">
                  <div class="lmd-card-title">{{ t('lmd.resources') }}</div>
                  <dl>
                    <dt>{{ t('lmd.memory') }}</dt>      <dd>{{ data.basic.memory }} MB</dd>
                    <dt>Timeout</dt>      <dd>{{ data.basic.timeout }} s</dd>
                    <dt>{{ t('lmd.ephemeral') }}</dt> <dd>{{ data.basic.ephemeralStorage }} MB</dd>
                    <dt>{{ t('lmd.code') }}</dt>       <dd>{{ fmtBytes(data.basic.codeSize) }}</dd>
                    <dt>SHA256</dt>       <dd class="mono wrap copyable" style="font-size:.72rem">{{ data.basic.codeHash }}<button class="copy-btn" @click.stop="copyField(data.basic.codeHash,'hash')" :title="copiedKey==='hash' ? t('res.copied') : t('action.copy')">{{ copiedKey==='hash' ? '✓' : '⧉' }}</button></dd>
                  </dl>
                </div>

                <div class="lmd-card">
                  <div class="lmd-card-title">{{ t('res.tagsCount', { n: Object.keys(data.basic.tags || {}).length }) }}</div>
                  <table class="lmd-table" v-if="Object.keys(data.basic.tags || {}).length">
                    <thead><tr><th>{{ t('res.key') }}</th><th>{{ t('res.value') }}</th></tr></thead>
                    <tbody>
                      <tr v-for="(v, k) in data.basic.tags" :key="k">
                        <td class="mono">{{ k }}</td><td class="mono">{{ v }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-dim" style="font-size:.82rem">{{ t('res.noTags') }}</div>
                </div>
              </div>
            </div>

            <!-- ══ CONFIGURACIÓN ═════════════════════════════════════════ -->
            <div v-show="activeTab === 'config'" class="lmd-section">
              <!-- Env Vars -->
              <div class="lmd-card" style="margin-bottom:10px">
                <div class="lmd-card-title" style="display:flex;justify-content:space-between;align-items:center">
                  {{ t('lmd.envVars', { n: data.config.envVars.length }) }}
                  <button class="btn sm" v-if="data.config.envVars.length" @click="showEnvValues = !showEnvValues">
                    {{ showEnvValues ? `🙈 ${t('lmd.hide')}` : `👁 ${t('lmd.show')}` }}
                  </button>
                </div>
                <table class="lmd-table" v-if="data.config.envVars.length">
                  <thead><tr><th>{{ t('res.key') }}</th><th>{{ t('res.value') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="e in data.config.envVars" :key="e.k">
                      <td class="mono">{{ e.k }}</td>
                      <td class="mono wrap">{{ showEnvValues ? e.v : '••••••••' }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">{{ t('lmd.noEnvVars') }}</div>
              </div>

              <!-- Layers -->
              <div class="lmd-card" style="margin-bottom:10px">
                <div class="lmd-card-title">Layers ({{ data.config.layers.length }})</div>
                <table class="lmd-table" v-if="data.config.layers.length">
                  <thead><tr><th>ARN</th><th>{{ t('ec2d.size') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="l in data.config.layers" :key="l.arn">
                      <td class="mono wrap">{{ l.arn }}</td>
                      <td>{{ fmtBytes(l.codeSize) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">{{ t('lmd.noLayers') }}</div>
              </div>

              <!-- VPC -->
              <div class="lmd-card" style="margin-bottom:10px">
                <div class="lmd-card-title">VPC</div>
                <template v-if="data.config.vpc">
                  <dl>
                    <dt>VPC</dt>     <dd class="mono copyable">{{ data.config.vpc.vpcId }}<button class="copy-btn" @click.stop="copyField(data.config.vpc.vpcId,'vpcid')" :title="copiedKey==='vpcid' ? t('res.copied') : t('action.copy')">{{ copiedKey==='vpcid' ? '✓' : '⧉' }}</button></dd>
                    <dt>Subnets</dt> <dd>
                      <span v-for="s in data.config.vpc.subnetIds" :key="s" class="lmd-chip">{{ s }}</span>
                    </dd>
                    <dt>SGs</dt>     <dd>
                      <span v-for="g in data.config.vpc.securityGroupIds" :key="g" class="lmd-chip">{{ g }}</span>
                    </dd>
                  </dl>
                </template>
                <div v-else class="text-dim" style="font-size:.82rem">{{ t('lmd.noVpc') }}</div>
              </div>

              <!-- Misc config -->
              <div class="lmd-card" style="margin-bottom:10px">
                <div class="lmd-card-title">{{ t('lmd.otherOptions') }}</div>
                <dl>
                  <dt>Tracing (X-Ray)</dt>     <dd>{{ data.config.tracing || '—' }}</dd>
                  <dt>{{ t('lmd.dlq') }}</dt><dd class="mono wrap copyable">{{ data.config.dlq || '—' }}<button v-if="data.config.dlq" class="copy-btn" @click.stop="copyField(data.config.dlq,'dlq')" :title="copiedKey==='dlq' ? t('res.copied') : t('action.copy')">{{ copiedKey==='dlq' ? '✓' : '⧉' }}</button></dd>
                  <dt>{{ t('lmd.reservedConcurrency') }}</dt>
                  <dd>{{ data.config.reservedConcurrency !== null ? data.config.reservedConcurrency : t('lmd.unlimited') }}</dd>
                  <dt>KMS Key</dt>             <dd class="mono wrap copyable">{{ data.config.kmsKeyArn || '—' }}<button v-if="data.config.kmsKeyArn" class="copy-btn" @click.stop="copyField(data.config.kmsKeyArn,'kms')" :title="copiedKey==='kms' ? t('res.copied') : t('action.copy')">{{ copiedKey==='kms' ? '✓' : '⧉' }}</button></dd>
                </dl>
              </div>

              <!-- File System -->
              <div v-if="data.config.fileSystem.length" class="lmd-card">
                <div class="lmd-card-title">File System (EFS)</div>
                <table class="lmd-table">
                  <thead><tr><th>ARN</th><th>Mount</th></tr></thead>
                  <tbody>
                    <tr v-for="f in data.config.fileSystem" :key="f.arn">
                      <td class="mono wrap">{{ f.arn }}</td>
                      <td class="mono">{{ f.localMountPath }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- ══ LOGS ════════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'logs'" class="lmd-section">
              <!-- Header con log group + controles -->
              <div class="lmd-card" style="margin-bottom:10px">
                <div class="lmd-card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
                  <span>CloudWatch Logs</span>
                  <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                    <select v-model="logsState.minutes" class="lmd-select" @change="loadLogs" style="font-size:.78rem">
                      <option v-for="m in LOG_MINUTES" :key="m" :value="m">{{ minutesLabel(m) }}</option>
                    </select>
                    <button class="btn sm" @click="loadLogs" :disabled="logsState.loading">{{ logsState.loading ? '...' : `↺ ${t('action.refresh')}` }}</button>
                  </div>
                </div>
                <dl style="margin-top:4px">
                  <dt>Log Group</dt>
                  <dd class="mono wrap" style="font-size:.8rem">{{ data.basic.logGroup || `/aws/lambda/${data.basic.name}` }}</dd>
                  <dt>{{ t('lambdaLogs.format') }}</dt>
                  <dd>{{ data.basic.logFormat || 'Text' }}</dd>
                </dl>
              </div>

              <!-- No log group → opción de crear -->
              <div v-if="logsState.noGroup" class="lmd-logs-nogroup">
                <div style="font-size:1.8rem">📭</div>
                <div>{{ t('lambdaLogs.noGroupTitle') }} <span class="mono-xs">{{ logsState.logGroup || data.basic.logGroup || `/aws/lambda/${data.basic.name}` }}</span></div>
                <div style="font-size:.82rem;color:#8b949e">{{ t('lambdaLogs.noGroupReason') }}</div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center">
                  <select v-model="logsState.createRetention" class="lmd-select">
                    <option v-for="d in RETENTION_DAYS" :key="d" :value="d">{{ t('lambdaLogs.retention', { days: d }) }}</option>
                  </select>
                  <button class="btn" @click="createLogGroup" :disabled="logsState.creating">
                    {{ logsState.creating ? t('lambdaLogs.creating') : t('lambdaLogs.create') }}
                  </button>
                </div>
                <div v-if="logsState.createResult" class="lmd-logs-ok">{{ logsState.createResult }}</div>
                <div v-if="logsState.createError" class="lmd-error">{{ logsState.createError }}</div>
              </div>

              <!-- Eventos -->
              <template v-else-if="!logsState.loading">
                <div v-if="logsState.error && !logsState.noGroup" class="lmd-error" style="margin-bottom:8px">{{ logsState.error }}</div>
                <div v-if="!logsState.events.length && !logsState.error" class="text-dim" style="text-align:center;padding:24px;font-size:.85rem">
                  {{ t('lambdaLogs.noEvents') }}
                </div>
                <div v-else class="lmd-logs-wrap">
                  <div v-for="(e, i) in logsState.events" :key="i" class="lmd-log-row">
                    <span class="lmd-log-ts">{{ fmtTs(e.timestamp) }}</span>
                    <span class="lmd-log-stream">{{ shortStream(e.logStreamName) }}</span>
                    <span class="lmd-log-msg">{{ e.message }}</span>
                  </div>
                </div>
              </template>
              <div v-else class="lmd-spinner-wrap" style="padding:24px"><div class="lmd-spinner"></div></div>
            </div>

            <!-- ══ MONITOREO ══════════════════════════════════════════════ -->
            <div v-show="activeTab === 'monitoring'" class="lmd-section">
              <div class="lmd-metrics-grid">
                <div v-for="m in metricCards" :key="m.key" class="lmd-metric-card">
                  <div class="lmd-metric-title">{{ m.label }}</div>
                  <div class="lmd-metric-last" :class="{ dim: lastVal(m.key) === null }">
                    {{ fmtMetric(lastVal(m.key), m.unit) }}
                  </div>
                  <svg class="lmd-sparkline" viewBox="0 0 200 40" preserveAspectRatio="none">
                    <polyline v-if="sparkPoints(m.key)" :points="sparkPoints(m.key)" fill="none" :stroke="m.color || '#58a6ff'" stroke-width="1.5"/>
                  </svg>
                  <div class="lmd-metric-range">{{ t('lmd.metricRange') }}</div>
                </div>
              </div>
              <div v-if="!hasAnyMetric" class="text-dim" style="text-align:center;padding:32px">
                {{ t('lmd.noMetrics') }}
              </div>
            </div>

            <!-- ══ ALIASES ════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'aliases'" class="lmd-section">
              <div v-if="data.aliases.length" class="lmd-card">
                <div class="lmd-card-title">Aliases ({{ data.aliases.length }})</div>
                <table class="lmd-table">
                  <thead><tr><th>{{ t('res.name') }}</th><th>{{ t('lmd.version') }}</th><th>Routing</th><th>{{ t('res.description') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="a in data.aliases" :key="a.name">
                      <td><strong>{{ a.name }}</strong><div class="mono-xs text-dim">{{ a.arn }}</div></td>
                      <td class="mono">{{ a.version }}</td>
                      <td>
                        <span v-if="!a.routing.length" class="text-dim">—</span>
                        <span v-for="r in a.routing" :key="r.version" class="lmd-chip">
                          v{{ r.version }}: {{ (r.weight * 100).toFixed(0) }}%
                        </span>
                      </td>
                      <td class="text-dim">{{ a.description || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="text-dim" style="text-align:center;padding:32px">
                {{ t('lmd.noAliases') }}
              </div>

              <!-- Versions -->
              <div class="lmd-card" style="margin-top:10px">
                <div class="lmd-card-title">{{ t('lmd.versions') }}</div>
                <table class="lmd-table" v-if="data.versions.length">
                  <thead><tr><th>{{ t('lmd.version') }}</th><th>{{ t('res.state') }}</th><th>{{ t('lmd.code') }}</th><th>{{ t('lmd.modified') }}</th><th>{{ t('res.description') }}</th></tr></thead>
                  <tbody>
                    <tr v-for="v in data.versions" :key="v.version">
                      <td class="mono">{{ v.version === '$LATEST' ? '🔴 $LATEST' : 'v' + v.version }}</td>
                      <td><span :class="['lmd-state', v.state]" style="font-size:.72rem">{{ v.state }}</span></td>
                      <td>{{ fmtBytes(v.codeSize) }}</td>
                      <td class="text-dim" style="white-space:nowrap">{{ fmtDate(v.lastModified) }}</td>
                      <td class="text-dim">{{ v.description || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">{{ t('lmd.noVersions') }}</div>
              </div>
            </div>

            <!-- ══ CÓDIGO ══════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'code'" class="lmd-section">

              <!-- Not loaded yet -->
              <div v-if="!codeData && !codeError" class="lmd-code-empty">
                <div>💻</div>
                <div>{{ t('lmd.codeHint') }}</div>
                <button class="btn" @click="loadCode" :disabled="codeLoading">
                  <span v-if="codeLoading">{{ t('lmd.downloading') }}</span>
                  <span v-else>⬇ {{ t('lmd.loadCode') }}</span>
                </button>
              </div>

              <div v-else-if="codeError" class="lmd-error">{{ codeError }}</div>

              <!-- Image type -->
              <div v-else-if="codeData?.type === 'image'" class="lmd-card">
                <div class="lmd-card-title">{{ t('lmd.containerImage') }}</div>
                <dl>
                  <dt>URI</dt><dd class="mono wrap">{{ codeData.imageUri || '—' }}</dd>
                </dl>
              </div>

              <!-- ZIP type -->
              <template v-else-if="codeData?.type === 'zip'">
                <div class="lmd-code-layout">
                  <!-- File tree -->
                  <div class="lmd-file-tree">
                    <div class="lmd-file-tree-title">
                      {{ t('lmd.files', { n: codeData.files.length }) }}
                    </div>
                    <div class="lmd-file-list">
                      <button
                        v-for="f in codeData.files"
                        :key="f.path"
                        :class="['lmd-file-item', { active: selectedFile?.path === f.path, binary: !f.isText }]"
                        @click="selectedFile = f">
                        <span class="lmd-file-icon">{{ fileIcon(f.path) }}</span>
                        <span class="lmd-file-name">{{ f.path }}</span>
                        <span class="lmd-file-size">{{ fmtBytes(f.size) }}</span>
                      </button>
                    </div>
                  </div>

                  <!-- Code viewer -->
                  <div class="lmd-code-viewer">
                    <div v-if="!selectedFile" class="lmd-code-placeholder">
                      ← {{ t('lmd.selectFile') }}
                    </div>
                    <template v-else>
                      <div class="lmd-code-toolbar">
                        <span class="mono-xs">{{ selectedFile.path }}</span>
                        <span class="lmd-badge runtime">{{ fmtBytes(selectedFile.size) }}</span>
                      </div>
                      <div v-if="!selectedFile.isText" class="lmd-code-placeholder">
                        {{ t('lmd.binaryFile') }}
                      </div>
                      <div v-else-if="selectedFile.content === null" class="lmd-code-placeholder">
                        {{ t('lmd.fileTooLarge') }}
                      </div>
                      <pre v-else class="lmd-code-pre"><code>{{ selectedFile.content }}</code></pre>
                    </template>
                  </div>
                </div>
              </template>

            </div>

          </template>

          <div v-else class="lmd-empty">
            {{ t('lmd.emptyHint') }}
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import { ref, computed, watch } from 'vue'

const { t } = useI18n()
const LOG_MINUTES = [15, 60, 180, 720, 1440]
const RETENTION_DAYS = [7, 14, 30, 60, 90, 365]
function minutesLabel(m) {
  return m < 60 ? t('lambdaLogs.minutes', { n: m }) : t('lambdaLogs.hours', { n: m / 60 })
}

const props = defineProps({
  open:      { type: Boolean, default: false },
  fn:        { type: Object,  default: null  },
  profileId: { type: String,  default: ''    },
})
defineEmits(['close'])

const TABS = computed(() => [
  { id: 'basic',      label: `📋 ${t('lmd.tabBasic')}` },
  { id: 'config',     label: `⚙️ ${t('lmd.tabConfig')}` },
  { id: 'logs',       label: '📋 Logs' },
  { id: 'monitoring', label: `📊 ${t('ec2d.tabMonitoring')}` },
  { id: 'aliases',    label: '🏷 Aliases' },
  { id: 'code',       label: `💻 ${t('lmd.code')}` },
])
const dateLocale = () => (settings.lang === 'es' ? 'es' : 'en-US')

const activeTab    = ref('basic')
const data         = ref(null)
const loading      = ref(false)
const detailLoaded = ref(false)
const error        = ref('')
const showEnvValues = ref(false)

// Code tab state
const codeData     = ref(null)
const codeLoading  = ref(false)
const codeError    = ref('')
const selectedFile = ref(null)

// Logs tab state
const logsState = ref({
  loading: false, error: '', events: [], noGroup: false,
  minutes: 60,
  creating: false, createRetention: 30, createResult: '', createError: '',
})

watch(() => props.open, val => {
  if (val) {
    activeTab.value  = 'basic'
    data.value       = null
    detailLoaded.value = false
    error.value      = ''
    codeData.value   = null
    codeError.value  = ''
    selectedFile.value = null
    showEnvValues.value = false
    logsState.value = {
      loading: false, error: '', events: [], noGroup: false,
      minutes: 60, creating: false, createRetention: 30, createResult: '', createError: '',
    }
    loadDetails()
  }
})

function switchTab(id) {
  activeTab.value = id
  if (id === 'logs' && !logsState.value.events.length && !logsState.value.noGroup && !logsState.value.error) {
    loadLogs()
  }
}

async function loadLogs() {
  if (!props.fn?.name) return
  logsState.value.loading = true
  logsState.value.error   = ''
  logsState.value.noGroup = false
  try {
    const h = props.profileId ? { 'x-profile-id': props.profileId } : {}
    const url = `/api/cloud/aws/logs/lambda/${encodeURIComponent(props.fn.name)}?minutes=${logsState.value.minutes}&limit=300`
    const res = await fetch(url, { headers: h })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      logsState.value.error = b.error || `HTTP ${res.status}`
      return
    }
    const d = await res.json()
    // The API answers a missing log group with a typed status, not an error.
    if (d.logGroupStatus === 'missing') {
      logsState.value.noGroup = true
      logsState.value.logGroup = d.logGroupName
      return
    }
    logsState.value.events = d.events || []
  } catch (e) {
    logsState.value.error = e.message
  } finally {
    logsState.value.loading = false
  }
}

async function createLogGroup() {
  if (!props.fn?.name) return
  logsState.value.creating     = true
  logsState.value.createError  = ''
  logsState.value.createResult = ''
  try {
    const h = {
      'Content-Type': 'application/json',
      ...(props.profileId ? { 'x-profile-id': props.profileId } : {}),
    }
    const res = await fetch(`/api/cloud/aws/lambda/${encodeURIComponent(props.fn.name)}/logging`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ logFormat: data.value?.basic?.logFormat || 'Text', retentionDays: logsState.value.createRetention }),
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      throw new Error(b.error || `HTTP ${res.status}`)
    }
    const r = await res.json()
    logsState.value.createResult = t('lambdaLogs.created', { group: r.logGroup, days: r.retentionDays })
    logsState.value.noGroup = false
    // Reload logs after a moment
    setTimeout(() => loadLogs(), 1500)
  } catch (e) {
    logsState.value.createError = e.message
  } finally {
    logsState.value.creating = false
  }
}

function fmtTs(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function shortStream(s) {
  if (!s) return ''
  const parts = s.split('/')
  return parts[parts.length - 1]?.slice(-12) || s
}

async function loadDetails() {
  if (!props.fn?.name) return
  loading.value = true
  error.value   = ''
  try {
    const h   = props.profileId ? { 'x-profile-id': props.profileId } : {}
    const res = await fetch(`/api/cloud/aws/lambda/${encodeURIComponent(props.fn.name)}/details`, { headers: h })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      throw new Error(b.error || `HTTP ${res.status}`)
    }
    data.value = await res.json()
    detailLoaded.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function loadCode() {
  if (!props.fn?.name) return
  codeLoading.value = true
  codeError.value   = ''
  loading.value     = true
  try {
    const h   = props.profileId ? { 'x-profile-id': props.profileId } : {}
    const res = await fetch(`/api/cloud/aws/lambda/${encodeURIComponent(props.fn.name)}/code`, { headers: h })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      throw new Error(b.error || `HTTP ${res.status}`)
    }
    codeData.value = await res.json()
    // Auto-select first text file
    const first = codeData.value?.files?.find(f => f.isText && f.content !== null)
    if (first) selectedFile.value = first
  } catch (e) {
    codeError.value = e.message
  } finally {
    codeLoading.value = false
    loading.value     = false
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtBytes(b) {
  if (!b && b !== 0) return '—'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB'
  return b + ' B'
}

function fileIcon(path) {
  const ext = path.split('.').pop()?.toLowerCase()
  const icons = {
    js: '🟨', mjs: '🟨', cjs: '🟨', ts: '🟦',
    py: '🐍', rb: '💎', go: '🐹', java: '☕',
    json: '📄', yaml: '📄', yml: '📄', toml: '📄',
    md: '📝', txt: '📝', sh: '📟', env: '🔑',
    html: '🌐', css: '🎨', sql: '🗄',
    tf: '🏗', hcl: '🏗', rs: '🦀',
  }
  return icons[ext] || '📄'
}

// ── Metrics ──────────────────────────────────────────────────────────────────
const metricCards = computed(() => [
  { key: 'Invocations',          label: t('lmd.invocations'),    unit: 'n',  color: '#58a6ff' },
  { key: 'Errors',               label: t('lmd.errors'),         unit: 'n',  color: '#f85149' },
  { key: 'Duration',             label: t('lmd.durationAvg'),    unit: 'ms', color: '#3fb950' },
  { key: 'Throttles',            label: 'Throttles',             unit: 'n',  color: '#d29922' },
  { key: 'ConcurrentExecutions', label: t('lmd.maxConcurrency'), unit: 'n',  color: '#a371f7' },
])

function lastVal(key) {
  const pts = data.value?.metrics?.[key]
  if (!pts?.length) return null
  return pts[pts.length - 1].v
}

function fmtMetric(v, unit) {
  if (v === null || v === undefined) return '—'
  if (unit === 'ms') return v.toFixed(0) + ' ms'
  return v.toFixed(0)
}

function sparkPoints(key) {
  const pts = data.value?.metrics?.[key]
  if (!pts?.length) return null
  const vals = pts.map(p => p.v)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const rng  = max - min || 1
  const w    = 200 / (pts.length - 1 || 1)
  return pts.map((p, i) => `${i * w},${40 - ((p.v - min) / rng) * 36}`).join(' ')
}

const hasAnyMetric = computed(() => {
  const m = data.value?.metrics
  if (!m) return false
  return Object.values(m).some(pts => pts.length > 0)
})

// ── Copy helpers ─────────────────────────────────────────────────────────────
const copiedKey = ref(null)
function copyField(val, key) {
  if (!val || val === '—') return
  navigator.clipboard?.writeText(String(val)).catch(() => {})
  copiedKey.value = key
  setTimeout(() => { if (copiedKey.value === key) copiedKey.value = null }, 1500)
}
</script>

<style scoped>
.lmd-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.62);
  display: flex; align-items: center; justify-content: center;
  z-index: 800;
}
.lmd-modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: min(98vw, 1060px);
  max-height: 90vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,.7);
}

/* Header */
.lmd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  flex-shrink: 0; gap: 8px;
}
.lmd-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; color: #e6edf3; font-size: .95rem;
}
.lmd-icon {
  font-size: 1.15rem; font-weight: 700;
  color: #f0a500;
  background: rgba(240,165,0,.12);
  border: 1px solid rgba(240,165,0,.25);
  border-radius: 6px;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
}
.lmd-badge {
  border-radius: 4px; padding: 1px 7px;
  font-size: .75rem; font-family: monospace;
}
.lmd-badge.runtime {
  background: rgba(163,113,247,.15); color: #a371f7;
  border: 1px solid rgba(163,113,247,.3);
}
.lmd-state {
  font-size: .75rem; padding: 2px 8px; border-radius: 12px; font-weight: 500;
}
.lmd-state.Active   { background: rgba(63,185,80,.2);   color: #3fb950; }
.lmd-state.Inactive { background: rgba(139,148,158,.2); color: #8b949e; }
.lmd-state.Failed   { background: rgba(248,81,73,.2);   color: #f85149; }
.lmd-state.Pending  { background: rgba(210,153,34,.2);  color: #d29922; }
.lmd-close {
  background: none; border: none; color: #8b949e;
  cursor: pointer; font-size: 1rem; padding: 2px 5px; border-radius: 4px;
}
.lmd-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Tabs */
.lmd-tabs {
  display: flex; align-items: center;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  padding: 0 8px; gap: 2px;
  flex-shrink: 0;
}
.lmd-tab {
  background: none; border: none;
  color: #8b949e; cursor: pointer;
  padding: 8px 13px; font-size: .82rem;
  border-bottom: 2px solid transparent;
  transition: all .15s;
}
.lmd-tab:hover { color: #e6edf3; }
.lmd-tab.active { color: #f0a500; border-bottom-color: #f0a500; }
.lmd-tabs-right { margin-left: auto; }

/* Body */
.lmd-body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
@media (max-width: 768px) {
  .lmd-body {
    padding: 10px 12px;
  }
}
.lmd-section { display: flex; flex-direction: column; }

.lmd-spinner-wrap {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; padding: 48px;
  color: #8b949e; font-size: .9rem;
}
.lmd-spinner {
  width: 28px; height: 28px;
  border: 3px solid #30363d;
  border-top-color: #f0a500;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.lmd-error {
  background: rgba(248,81,73,.1);
  border: 1px solid rgba(248,81,73,.3);
  border-radius: 6px; padding: 12px 16px;
  color: #f85149; font-size: .85rem;
}
.lmd-empty {
  text-align: center; color: #8b949e;
  padding: 40px; font-size: .9rem;
}

/* Cards */
.lmd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
@media (max-width: 768px) {
  .lmd-grid {
    grid-template-columns: 1fr;
  }
}
.lmd-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 12px 14px;
}
.lmd-card-title {
  font-size: .78rem; color: #f0a500;
  font-weight: 600; margin-bottom: 10px;
  letter-spacing: .03em; text-transform: uppercase;
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
}
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
dt { color: #8b949e; font-size: .8rem; align-self: start; padding-top: 2px; }
dd { color: #e6edf3; font-size: .83rem; margin: 0; word-break: break-word; }
dd.mono { font-family: monospace; }
dd.wrap { word-break: break-all; }

/* Tables */
.lmd-table {
  width: 100%; border-collapse: collapse; font-size: .8rem;
}
.lmd-table th {
  color: #8b949e; text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid #21262d;
}
.lmd-table td {
  padding: 5px 8px; color: #e6edf3;
  border-bottom: 1px solid rgba(48,54,61,.5);
  vertical-align: top;
}
.lmd-table tr:last-child td { border-bottom: none; }
.lmd-table .mono { font-family: monospace; font-size: .78rem; }
.lmd-table .wrap { word-break: break-all; }

.lmd-chip {
  display: inline-block;
  background: rgba(139,148,158,.12);
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: .75rem; font-family: monospace;
  margin: 2px 2px 2px 0;
}

/* Metrics */
.lmd-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.lmd-metric-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 12px 14px;
}
.lmd-metric-title { font-size: .8rem; color: #8b949e; margin-bottom: 6px; }
.lmd-metric-last  { font-size: 1.4rem; font-weight: 600; color: #e6edf3; }
.lmd-metric-last.dim { color: #8b949e; font-size: 1rem; }
.lmd-sparkline { width: 100%; height: 40px; display: block; margin-top: 8px; }
.lmd-metric-range { font-size: .72rem; color: #8b949e; margin-top: 4px; }

/* Code tab */
.lmd-code-empty {
  display: flex; flex-direction: column;
  align-items: center; gap: 14px;
  padding: 48px;
  color: #8b949e; font-size: .9rem;
  text-align: center;
}
.lmd-code-empty > div:first-child { font-size: 2.5rem; }

.lmd-code-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 0;
  height: calc(90vh - 200px);
  min-height: 300px;
  border: 1px solid #21262d;
  border-radius: 8px;
  overflow: hidden;
}
@media (max-width: 768px) {
  .lmd-code-layout {
    grid-template-columns: 1fr;
    height: auto;
  }
}

.lmd-file-tree {
  background: #161b22;
  border-right: 1px solid #21262d;
  display: flex; flex-direction: column;
  overflow: hidden;
}
@media (max-width: 768px) {
  .lmd-file-tree {
    border-right: none;
    border-bottom: 1px solid #21262d;
    max-height: 40vh;
  }
}
.lmd-file-tree-title {
  padding: 8px 12px;
  font-size: .78rem; color: #8b949e;
  border-bottom: 1px solid #21262d;
  flex-shrink: 0;
  text-transform: uppercase; font-weight: 600;
}
.lmd-file-list {
  overflow-y: auto; flex: 1;
}
.lmd-file-item {
  display: flex; align-items: center; gap: 6px;
  width: 100%; text-align: left;
  padding: 5px 12px;
  background: none; border: none;
  color: #c9d1d9; font-size: .78rem;
  cursor: pointer; transition: background .1s;
  border-bottom: 1px solid rgba(48,54,61,.3);
}
.lmd-file-item:hover   { background: rgba(255,255,255,.05); }
.lmd-file-item.active  { background: rgba(240,165,0,.1); color: #f0a500; }
.lmd-file-item.binary  { color: #8b949e; }
.lmd-file-icon  { flex-shrink: 0; }
.lmd-file-name  { flex: 1; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lmd-file-size  { flex-shrink: 0; color: #8b949e; font-size: .7rem; }

.lmd-code-viewer {
  display: flex; flex-direction: column;
  background: #0d1117;
  overflow: hidden;
}
.lmd-code-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 14px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  flex-shrink: 0; gap: 8px;
}
.lmd-code-placeholder {
  flex: 1; display: flex;
  align-items: center; justify-content: center;
  color: #8b949e; font-size: .85rem;
}
.lmd-code-pre {
  flex: 1; margin: 0;
  overflow: auto;
  padding: 14px 16px;
  font-family: 'Fira Code', 'Cascadia Code', 'Menlo', monospace;
  font-size: .78rem;
  line-height: 1.55;
  color: #e6edf3;
  white-space: pre;
  background: transparent;
}
@media (max-width: 768px) {
  .lmd-code-pre {
    font-size: .72rem;
    padding: 10px 12px;
    max-height: 50vh;
  }
}

/* Buttons */
.btn { background: rgba(240,165,0,.12); border: 1px solid rgba(240,165,0,.35); color: #f0a500; border-radius: 6px; padding: 6px 16px; font-size: .87rem; cursor: pointer; transition: all .15s; }
.btn:hover { background: rgba(240,165,0,.22); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn.sm { padding: 3px 10px; font-size: .78rem; }

.text-dim  { color: #8b949e; }
.mono-xs   { font-family: monospace; font-size: .75rem; }

/* Logs tab */
.lmd-select {
  background: #161b22; border: 1px solid #30363d; color: #e6edf3;
  border-radius: 5px; padding: 3px 8px; font-size: .82rem; cursor: pointer;
}
.lmd-logs-nogroup {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 36px 24px; text-align: center;
  background: rgba(248,81,73,.06); border: 1px solid rgba(248,81,73,.2);
  border-radius: 8px; color: #e6edf3; font-size: .87rem;
}
.lmd-logs-ok {
  background: rgba(63,185,80,.12); border: 1px solid rgba(63,185,80,.3);
  border-radius: 6px; padding: 8px 14px; color: #3fb950; font-size: .82rem;
}
.lmd-logs-wrap {
  background: #0d1117; border: 1px solid #21262d;
  border-radius: 8px; overflow-y: auto; max-height: calc(90vh - 340px);
  font-family: 'Fira Code', monospace;
}
.lmd-log-row {
  display: grid; grid-template-columns: 80px 90px 1fr;
  gap: 8px; padding: 3px 10px;
  border-bottom: 1px solid rgba(33,38,45,.6);
  font-size: .76rem; line-height: 1.45;
}
.lmd-log-row:last-child { border-bottom: none; }
.lmd-log-ts     { color: #8b949e; white-space: nowrap; flex-shrink: 0; }
.lmd-log-stream { color: #a371f7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lmd-log-msg    { color: #e6edf3; white-space: pre-wrap; word-break: break-word; }

/* Copy buttons */
.copyable { display: inline-flex; align-items: flex-start; gap: 4px; width: 100%; min-width: 0; }
.copyable span { flex: 1; min-width: 0; word-break: break-word; }
.copy-btn {
  background: none; border: none;
  color: #8b949e; cursor: pointer;
  font-size: .72rem; padding: 1px 3px;
  border-radius: 3px; opacity: 0;
  transition: opacity .15s, color .15s;
  flex-shrink: 0; line-height: 1.5;
}
.copyable:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: #f0a500; background: rgba(240,165,0,.12); }
</style>
