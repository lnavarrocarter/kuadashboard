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
          <div class="gi-card-title">{{ t('gri.service') }}</div>
          <dl>
            <dt>URL</dt><dd><a v-if="d.uri" :href="d.uri" target="_blank" rel="noopener" class="gi-mono gi-wrap">{{ d.uri }}</a><span v-else>—</span></dd>
            <dt>{{ t('res.state') }}</dt><dd><span :class="['gi-badge', d.status === 'ready' ? 'ok' : d.status === 'failed' ? 'err' : 'warn']">{{ d.status }}</span><div v-if="d.statusMessage && d.status !== 'ready'" class="gi-dim">{{ d.statusMessage }}</div></dd>
            <dt>{{ t('res.region') }}</dt><dd class="gi-mono">{{ d.region }}</dd>
            <dt>{{ t('res.created') }}</dt><dd>{{ fmt(d.created) }}<span v-if="d.creator" class="gi-dim"> · {{ d.creator }}</span></dd>
            <dt>{{ t('res.updated') }}</dt><dd>{{ fmt(d.updated) }}<span v-if="d.lastModifier" class="gi-dim"> · {{ d.lastModifier }}</span></dd>
            <dt>{{ t('gri.generation') }}</dt><dd>{{ d.generation || '—' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('gri.access') }}</div>
          <dl>
            <dt>Ingress</dt><dd>{{ ingressLabel }}</dd>
            <dt>{{ t('gri.invocation') }}</dt>
            <dd>
              <span v-if="d.publicAccess === true" class="gi-badge warn">{{ t('gri.publicAccess') }}</span>
              <span v-else-if="d.publicAccess === false" class="gi-badge ok">{{ t('gri.requiresAuth') }}</span>
              <span v-else class="gi-dim">{{ t('gri.iamUnreadable') }}</span>
            </dd>
            <dt>{{ t('gri.serviceAccount') }}</dt><dd class="gi-mono gi-wrap">{{ d.serviceAccount || t('gri.computeDefault') }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('gri.container') }}</div>
          <dl>
            <dt>{{ t('lmd.image') }}</dt><dd class="gi-mono gi-wrap">{{ d.container?.image || '—' }}</dd>
            <dt>{{ t('gri.port') }}</dt><dd>{{ d.container?.port || '—' }}</dd>
            <dt>{{ t('gri.cpuMemory') }}</dt><dd :title="`${d.container?.cpu || '—'} / ${d.container?.memory || '—'}`">{{ formatCloudRunCpu(d.container?.cpu) }} / {{ formatCloudRunMemory(d.container?.memory) }}</dd>
            <dt>{{ t('gri.cpuAllocation') }}</dt><dd>{{ d.container?.cpuAlwaysAllocated ? t('gri.cpuAlways') : t('gri.cpuRequests') }}<span v-if="d.container?.startupCpuBoost" class="gi-dim"> · {{ t('gri.startupBoost') }}</span></dd>
            <dt v-if="d.container?.command?.length">{{ t('gri.command') }}</dt><dd v-if="d.container?.command?.length" class="gi-mono">{{ [...d.container.command, ...(d.container.args || [])].join(' ') }}</dd>
            <dt>{{ t('gri.startupProbe') }}</dt><dd>{{ probeText(d.container?.startupProbe) }}</dd>
            <dt>{{ t('gri.livenessProbe') }}</dt><dd>{{ probeText(d.container?.livenessProbe) }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('eksd.scaling') }}</div>
          <dl>
            <dt>{{ t('gcpv.audit.crScaling') }}</dt><dd data-test="scaling" :title="d.scaling?.minInstances > 0 ? t('gcpv.audit.crWarmHint') : t('gcpv.audit.crZeroHint')">{{ d.scaling?.minInstances ?? 0 }} – {{ d.scaling?.maxInstances ?? '∞' }}<span v-if="d.scaling?.minInstances > 0" class="gi-badge warn" style="margin-left:6px">24/7</span><span v-else class="gi-dim"> · {{ t('gcpv.audit.crScalesToZero') }}</span></dd>
            <dt>{{ t('gri.concurrency') }}</dt><dd>{{ t('gri.concurrencyValue', { n: d.scaling?.concurrency ?? '—' }) }}</dd>
            <dt>Timeout</dt><dd>{{ d.scaling?.timeoutSeconds ? `${d.scaling.timeoutSeconds} s` : '—' }}</dd>
            <dt>{{ t('gri.environment') }}</dt><dd>{{ d.scaling?.executionEnvironment || t('gri.defaultValue') }}</dd>
            <dt>{{ t('gri.sessionAffinity') }}</dt><dd>{{ yesNo(d.scaling?.sessionAffinity) }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">{{ t('eksd.tabNetwork') }}</div>
          <dl>
            <dt>VPC connector</dt><dd class="gi-mono">{{ d.networking?.vpcConnector || '—' }}</dd>
            <dt>Direct VPC</dt><dd class="gi-mono">{{ d.networking?.directVpc?.length ? d.networking.directVpc.map(n => `${n.network}/${n.subnetwork || '*'}`).join(', ') : '—' }}</dd>
            <dt>Egress</dt><dd>{{ d.networking?.vpcEgress || '—' }}</dd>
            <dt>Cloud SQL</dt><dd><span v-for="i in d.cloudSqlInstances || []" :key="i" class="gi-chip">{{ i }}</span><span v-if="!d.cloudSqlInstances?.length">—</span></dd>
          </dl>
        </div>

        <div v-if="d.conditions?.length" class="gi-card">
          <div class="gi-card-title">{{ t('gri.conditions') }}</div>
          <dl>
            <template v-for="c in d.conditions" :key="c.type">
              <dt>{{ c.type }}</dt>
              <dd><span :class="['gi-badge', c.state === 'CONDITION_SUCCEEDED' ? 'ok' : c.state === 'CONDITION_FAILED' ? 'err' : 'warn']">{{ String(c.state || '').replace('CONDITION_', '').toLowerCase() }}</span></dd>
            </template>
          </dl>
        </div>
      </div>
    </template>

    <!-- ══ Revisiones y tráfico ══ -->
    <template v-else-if="section === 'revisions'">
      <div class="gi-card">
        <div class="gi-card-title">{{ t('gri.traffic') }}</div>
        <table class="gi-table" data-test="traffic">
          <thead><tr><th>{{ t('ec2d.destination') }}</th><th>{{ t('gri.traffic') }}</th><th>Tag</th></tr></thead>
          <tbody>
            <tr v-for="(entry, i) in d.traffic || []" :key="i">
              <td class="gi-mono">{{ entry.latest ? t('gri.latest', { name: latestRevision || '—' }) : entry.revision }}</td>
              <td style="min-width:140px"><div style="display:flex;align-items:center;gap:6px"><div class="gi-bar" style="flex:1"><span :style="{ width: `${entry.percent}%` }"></span></div>{{ entry.percent }}%</div></td>
              <td class="gi-mono">{{ entry.tag || '—' }}<div v-if="entry.uri" class="gi-dim gi-wrap">{{ entry.uri }}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="gi-card">
        <div class="gi-card-title">{{ t('gri.revisions', { n: d.revisions?.length || 0 }) }}</div>
        <table v-if="d.revisions?.length" class="gi-table">
          <thead><tr><th>{{ t('gri.revision') }}</th><th>{{ t('gri.createdF') }}</th><th>{{ t('gri.traffic') }}</th><th>{{ t('gri.ready') }}</th><th>{{ t('lmd.image') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in d.revisions" :key="r.name">
              <td class="gi-mono">{{ r.name }}</td>
              <td>{{ fmt(r.created) }}</td>
              <td>{{ r.traffic != null ? `${r.traffic}%` : '—' }}</td>
              <td><span :class="['gi-badge', r.ready ? 'ok' : 'warn']">{{ yesNo(r.ready) }}</span></td>
              <td class="gi-mono gi-wrap">{{ shortImage(r.image) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="gi-empty">{{ t('gri.noRevisions') }}</div>
      </div>
    </template>

    <!-- ══ Variables y secretos ══ -->
    <template v-else-if="section === 'variables'">
      <div class="gi-card">
        <div class="gi-card-title">{{ t('lmd.envVars', { n: d.envVars?.length || 0 }) }}</div>
        <table v-if="d.envVars?.length" class="gi-table" data-test="env">
          <thead><tr><th>{{ t('res.name') }}</th><th>{{ t('res.value') }}</th></tr></thead>
          <tbody>
            <tr v-for="e in d.envVars" :key="e.name">
              <td class="gi-mono">{{ e.name }}</td>
              <td class="gi-mono gi-wrap">
                <span v-if="e.secret" class="gi-badge ok" :title="t('gri.secretValue')">🔐 {{ e.secret }}</span>
                <template v-else>{{ e.value }}<span v-if="looksSecret(e)" class="gi-badge warn" style="margin-left:6px" :title="t('gri.plainSecretHint')">{{ t('gri.plainSecret') }}</span></template>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="gi-empty">{{ t('lmd.noEnvVars') }}</div>
      </div>
      <div v-if="d.secretVolumes?.length" class="gi-card">
        <div class="gi-card-title">{{ t('gri.secretVolumes') }}</div>
        <div v-for="v in d.secretVolumes" :key="v.name" class="gi-mono">{{ v.name }} → {{ v.secret }}</div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatCloudRunCpu, formatCloudRunMemory } from './gcpActions'
import { useI18n } from '../../composables/useI18n'
import { settings } from '../../composables/useSettings'
import './gcpInfo.css'

const props = defineProps({
  detail:  { type: Object, required: true },
  section: { type: String, default: 'overview' },   // overview | revisions | variables
})
const d = computed(() => props.detail || {})
const { t } = useI18n()
const yesNo = value => t(value ? 'common.yes' : 'common.no')

// GCP returns the default Compute SA by email when no custom one is set
const DEFAULT_SA = /-compute@developer\.gserviceaccount\.com$/
const SECRET_NAME = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential)/i
function looksSecret(e) { return !e.secret && SECRET_NAME.test(e.name) && (e.value || '').length >= 8 }

const INGRESS_KEYS = { all: 'gri.ingressAll', internal_only: 'gri.ingressInternal', internal_load_balancer: 'gri.ingressInternalLb' }
const ingressLabel = computed(() => (INGRESS_KEYS[d.value.ingress] ? t(INGRESS_KEYS[d.value.ingress]) : d.value.ingress || '—'))

const latestRevision = computed(() => (d.value.revisions || []).find(r => r.traffic)?.name || d.value.revisions?.[0]?.name)

const notes = computed(() => {
  const out = []
  const v = d.value
  if (v.publicAccess && v.ingress === 'all') out.push({ level: 'warn', text: t('gri.notePublic') })
  if ((v.scaling?.minInstances || 0) > 0) out.push({ level: 'warn', text: t('gri.noteMinInstances', { n: v.scaling.minInstances }) })
  const plain = (v.envVars || []).filter(looksSecret)
  if (plain.length) out.push({ level: 'err', text: t('gri.notePlainSecrets', { names: plain.map(e => e.name).join(', ') }) })
  if (!v.serviceAccount || DEFAULT_SA.test(v.serviceAccount)) out.push({ level: 'warn', text: t('gri.noteDefaultSa') })
  if (v.status === 'failed') out.push({ level: 'err', text: v.statusMessage || t('gri.noteDeployFailed') })
  return out
})

function probeText(p) {
  if (!p) return '—'
  return `${p.kind}${p.periodSeconds ? ` · ${t('gri.probeEvery', { n: p.periodSeconds })}` : ''}${p.failureThreshold ? ` · ${t('gri.probeFailures', { n: p.failureThreshold })}` : ''}`
}
function shortImage(image) {
  if (!image) return '—'
  return image.split('/').pop().replace(/@sha256:(\w{12})\w+/, '@$1…')
}
function fmt(v) { return v ? new Date(v).toLocaleString(settings.lang === 'es' ? 'es' : 'en-US') : '—' }
</script>
