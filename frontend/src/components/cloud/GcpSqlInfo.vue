<template>
  <div class="gi-root">
    <!-- ══ Resumen ══ -->
    <template v-if="section === 'overview'">
      <div v-if="notes.length" class="gi-notes" data-test="notes">
        <div class="gi-notes-title">{{ t('gi.notes') }}</div>
        <ul><li v-for="n in notes" :key="n.text" :class="n.level">{{ n.text }}</li></ul>
      </div>

      <div class="gi-grid">
        <div class="gi-card">
          <div class="gi-card-title">{{ t('ec2d.instance') }}</div>
          <dl>
            <dt>{{ t('res.state') }}</dt><dd><span :class="['gi-badge', d.status === 'RUNNING' ? 'ok' : d.status === 'STOPPED' ? '' : 'warn']">{{ d.status }}</span></dd>
            <dt>{{ t('gsi.engine') }}</dt><dd class="gi-mono">{{ d.database }}</dd>
            <dt>{{ t('gsi.editionTier') }}</dt><dd>{{ d.edition || '—' }} · <span class="gi-mono">{{ d.tier }}</span></dd>
            <dt>{{ t('gvi.availability') }}</dt><dd><span :class="['gi-badge', d.availabilityType === 'REGIONAL' ? 'ok' : '']">{{ d.availabilityType === 'REGIONAL' ? t('gsi.highAvailability') : t('gsi.zonal') }}</span></dd>
            <dt>{{ t('gsi.location') }}</dt><dd class="gi-mono">{{ d.zone || d.region }}<span v-if="d.secondaryZone" class="gi-dim"> · standby {{ d.secondaryZone }}</span></dd>
            <dt>{{ t('gri.createdF') }}</dt><dd>{{ fmt(d.created) }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('ec2d.tabStorage') }}</div>
          <dl>
            <dt>{{ t('gsi.typeSize') }}</dt><dd>{{ d.storage?.type || '—' }} · {{ d.storage?.sizeGb ? `${d.storage.sizeGb} GB` : '—' }}</dd>
            <dt>Auto-resize</dt><dd>{{ d.storage?.autoResize ? (d.storage.autoResizeLimitGb ? t('gsi.autoResizeUpTo', { gb: d.storage.autoResizeLimitGb }) : t('gsi.autoResizeUnlimited')) : t('common.no') }}</dd>
            <dt>{{ t('gcpv.audit.kv.dataCache') }}</dt><dd>{{ yesNo(d.storage?.dataCache) }}</dd>
            <dt>{{ t('ec2d.encrypted') }}</dt><dd>{{ d.storage?.encryption || '—' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Backups</div>
          <dl>
            <dt>{{ t('gsi.automatic') }}</dt><dd><span :class="['gi-badge', d.backups?.enabled ? 'ok' : 'err']">{{ d.backups?.enabled ? t('gsi.backupsOn') : t('gsi.backupsOff') }}</span></dd>
            <dt>{{ t('gsi.timeUtc') }}</dt><dd>{{ d.backups?.enabled ? (d.backups.startTime || '—') : '—' }}</dd>
            <dt>Point-in-time</dt><dd>{{ yesNo(d.backups?.pointInTimeRecovery) }}</dd>
            <dt>{{ t('gsi.retention') }}</dt><dd>{{ t('gsi.retentionValue', { backups: d.backups?.retainedBackups ?? '—', days: d.backups?.logRetentionDays ?? '—' }) }}</dd>
            <dt v-if="d.backups?.location">{{ t('gsi.location') }}</dt><dd v-if="d.backups?.location">{{ d.backups.location }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('gsi.maintenanceSecurity') }}</div>
          <dl>
            <dt>{{ t('gsi.window') }}</dt><dd>{{ d.maintenance ? `${maintenanceDay(d.maintenance.day)}${d.maintenance.hour != null ? ` ${d.maintenance.hour}:00 UTC` : ''}` : t('gsi.anyTime') }}<span v-if="d.maintenance?.track" class="gi-dim"> · {{ d.maintenance.track }}</span></dd>
            <dt>{{ t('gvi.deletionProtection') }}</dt><dd><span :class="['gi-badge', d.security?.deletionProtection ? 'ok' : 'warn']">{{ yesNo(d.security?.deletionProtection) }}</span></dd>
            <dt>Query Insights</dt><dd>{{ yesNo(d.security?.queryInsights) }}</dd>
            <dt>{{ t('gsi.caCertificate') }}</dt><dd>{{ t('gsi.expires', { date: fmtDate(d.security?.serverCaExpires) }) }}</dd>
          </dl>
        </div>

        <div v-if="d.replication?.primary || d.replication?.replicas?.length" class="gi-card">
          <div class="gi-card-title">{{ t('gsi.replication') }}</div>
          <dl>
            <dt v-if="d.replication.primary">{{ t('gsi.primary') }}</dt><dd v-if="d.replication.primary" class="gi-mono">{{ d.replication.primary }}</dd>
            <dt>{{ t('gsi.replicas') }}</dt><dd><span v-for="r in d.replication.replicas" :key="r" class="gi-chip">{{ r }}</span><span v-if="!d.replication.replicas.length">—</span></dd>
          </dl>
        </div>
      </div>
    </template>

    <!-- ══ Configuración (flags) ══ -->
    <template v-else-if="section === 'config'">
      <div class="gi-card">
        <div class="gi-card-title">{{ t('gsi.flags', { n: d.flags?.length || 0 }) }}</div>
        <table v-if="d.flags?.length" class="gi-table" data-test="flags">
          <thead><tr><th>Flag</th><th>{{ t('res.value') }}</th></tr></thead>
          <tbody><tr v-for="f in d.flags" :key="f.name"><td class="gi-mono">{{ f.name }}</td><td class="gi-mono">{{ f.value }}</td></tr></tbody>
        </table>
        <div v-else class="gi-empty">{{ t('gsi.noFlags') }}</div>
      </div>
    </template>

    <!-- ══ Conexión ══ -->
    <template v-else-if="section === 'connection'">
      <div class="gi-grid">
        <div class="gi-card">
          <div class="gi-card-title">{{ t('gsi.addresses') }}</div>
          <dl>
            <dt>{{ t('gcpv.audit.kv.connectionName') }}</dt><dd class="gi-mono gi-wrap">{{ d.connectionName || '—' }}</dd>
            <dt>{{ t('ec2d.publicIp') }}</dt><dd class="gi-mono">{{ d.network?.publicIp || '—' }}<span v-if="d.network && !d.network.ipv4Enabled" class="gi-dim"> ({{ t('gsi.disabledF') }})</span></dd>
            <dt>{{ t('ec2d.privateIp') }}</dt><dd class="gi-mono">{{ d.network?.privateIp || '—' }}<span v-if="d.network?.privateNetwork" class="gi-dim"> · VPC {{ d.network.privateNetwork }}</span></dd>
            <dt>{{ t('gsi.outgoingIp') }}</dt><dd class="gi-mono">{{ d.network?.outgoingIp || '—' }}</dd>
            <dt v-if="d.dnsName">DNS</dt><dd v-if="d.dnsName" class="gi-mono gi-wrap">{{ d.dnsName }}</dd>
            <dt>Private Service Connect</dt><dd>{{ yesNo(d.network?.pscEnabled) }}</dd>
          </dl>
        </div>
        <div class="gi-card">
          <div class="gi-card-title">{{ t('gsi.inTransit') }}</div>
          <dl>
            <dt>{{ t('gsi.sslMode') }}</dt><dd><span :class="['gi-badge', sslTone]">{{ sslLabel }}</span></dd>
          </dl>
        </div>
        <div class="gi-card wide">
          <div class="gi-card-title">{{ t('gsi.authorizedNetworks', { n: d.network?.authorizedNetworks?.length || 0 }) }}</div>
          <table v-if="d.network?.authorizedNetworks?.length" class="gi-table" data-test="authorized">
            <thead><tr><th>{{ t('res.name') }}</th><th>CIDR</th></tr></thead>
            <tbody>
              <tr v-for="n in d.network.authorizedNetworks" :key="n.cidr">
                <td>{{ n.name || '—' }}</td>
                <td class="gi-mono">{{ n.cidr }} <span v-if="n.cidr === '0.0.0.0/0'" class="gi-badge err">{{ t('gsi.allInternet') }}</span></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="gi-empty">{{ t('gsi.noAuthorizedNetworks') }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import './gcpInfo.css'

const props = defineProps({
  detail:  { type: Object, required: true },
  section: { type: String, default: 'overview' },   // overview | config | connection
})
const d = computed(() => props.detail || {})
const { t } = useI18n()
const dateLocale = () => (settings.lang === 'es' ? 'es' : 'en-US')

const SSL = {
  ENCRYPTED_ONLY: ['gsi.sslEncryptedOnly', 'ok'],
  TRUSTED_CLIENT_CERTIFICATE_REQUIRED: ['gsi.sslClientCert', 'ok'],
  REQUIRE_SSL: ['gsi.sslRequired', 'ok'],
  ALLOW_UNENCRYPTED_AND_ENCRYPTED: ['gsi.sslAllowUnencrypted', 'err'],
}
const sslLabel = computed(() => (SSL[d.value.network?.sslMode] ? t(SSL[d.value.network.sslMode][0]) : d.value.network?.sslMode || '—'))
const sslTone = computed(() => SSL[d.value.network?.sslMode]?.[1] || '')

const notes = computed(() => {
  const out = []
  const v = d.value
  if (v.backups && !v.backups.enabled) out.push({ level: 'err', text: t('gsi.noteBackupsOff') })
  if (v.network?.sslMode === 'ALLOW_UNENCRYPTED_AND_ENCRYPTED') out.push({ level: 'err', text: t('gsi.noteUnencrypted') })
  if ((v.network?.authorizedNetworks || []).some(n => n.cidr === '0.0.0.0/0')) out.push({ level: 'err', text: t('gsi.noteOpenWorld') })
  else if (v.network?.ipv4Enabled && v.network?.authorizedNetworks?.length) out.push({ level: 'warn', text: t('gsi.notePublicIp', { n: v.network.authorizedNetworks.length }) })
  if (v.security && !v.security.deletionProtection) out.push({ level: 'warn', text: t('gvi.noteDeletionProtection') })
  if (v.availabilityType !== 'REGIONAL') out.push({ level: 'warn', text: t('gsi.noteZonal') })
  if (v.status === 'STOPPED') out.push({ level: 'warn', text: t('gsi.noteStopped') })
  return out
})

function yesNo(v) { return v == null ? '—' : t(v ? 'common.yes' : 'common.no') }
// The backend sends the maintenance day as 1 (Monday) … 7 (Sunday), or null for any day.
function maintenanceDay(day) { return day >= 1 && day <= 7 ? t(`gsi.day.${day}`) : t('gsi.anyDay') }
function fmt(v) { return v ? new Date(v).toLocaleString(dateLocale()) : '—' }
function fmtDate(v) { return v ? new Date(v).toLocaleDateString(dateLocale()) : '—' }
</script>
