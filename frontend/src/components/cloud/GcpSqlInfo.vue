<template>
  <div class="gi-root">
    <!-- ══ Resumen ══ -->
    <template v-if="section === 'overview'">
      <div v-if="notes.length" class="gi-notes" data-test="notes">
        <div class="gi-notes-title">Observaciones</div>
        <ul><li v-for="n in notes" :key="n.text" :class="n.level">{{ n.text }}</li></ul>
      </div>

      <div class="gi-grid">
        <div class="gi-card">
          <div class="gi-card-title">Instancia</div>
          <dl>
            <dt>Estado</dt><dd><span :class="['gi-badge', d.status === 'RUNNING' ? 'ok' : d.status === 'STOPPED' ? '' : 'warn']">{{ d.status }}</span></dd>
            <dt>Motor</dt><dd class="gi-mono">{{ d.database }}</dd>
            <dt>Edición · tier</dt><dd>{{ d.edition || '—' }} · <span class="gi-mono">{{ d.tier }}</span></dd>
            <dt>Disponibilidad</dt><dd><span :class="['gi-badge', d.availabilityType === 'REGIONAL' ? 'ok' : '']">{{ d.availabilityType === 'REGIONAL' ? 'Alta disponibilidad' : 'Zonal' }}</span></dd>
            <dt>Ubicación</dt><dd class="gi-mono">{{ d.zone || d.region }}<span v-if="d.secondaryZone" class="gi-dim"> · standby {{ d.secondaryZone }}</span></dd>
            <dt>Creada</dt><dd>{{ fmt(d.created) }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Almacenamiento</div>
          <dl>
            <dt>Tipo · tamaño</dt><dd>{{ d.storage?.type || '—' }} · {{ d.storage?.sizeGb ? `${d.storage.sizeGb} GB` : '—' }}</dd>
            <dt>Auto-resize</dt><dd>{{ d.storage?.autoResize ? `Sí${d.storage.autoResizeLimitGb ? ` (hasta ${d.storage.autoResizeLimitGb} GB)` : ' (sin límite)'}` : 'No' }}</dd>
            <dt>Data cache</dt><dd>{{ yesNo(d.storage?.dataCache) }}</dd>
            <dt>Cifrado</dt><dd>{{ d.storage?.encryption || '—' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Backups</div>
          <dl>
            <dt>Automáticos</dt><dd><span :class="['gi-badge', d.backups?.enabled ? 'ok' : 'err']">{{ d.backups?.enabled ? 'Activados' : 'Desactivados' }}</span></dd>
            <dt>Hora (UTC)</dt><dd>{{ d.backups?.enabled ? (d.backups.startTime || '—') : '—' }}</dd>
            <dt>Point-in-time</dt><dd>{{ yesNo(d.backups?.pointInTimeRecovery) }}</dd>
            <dt>Retención</dt><dd>{{ d.backups?.retainedBackups ?? '—' }} backups · logs {{ d.backups?.logRetentionDays ?? '—' }} días</dd>
            <dt v-if="d.backups?.location">Ubicación</dt><dd v-if="d.backups?.location">{{ d.backups.location }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Mantenimiento y seguridad</div>
          <dl>
            <dt>Ventana</dt><dd>{{ d.maintenance ? `${d.maintenance.day}${d.maintenance.hour != null ? ` ${d.maintenance.hour}:00 UTC` : ''}` : 'Cualquier momento' }}<span v-if="d.maintenance?.track" class="gi-dim"> · {{ d.maintenance.track }}</span></dd>
            <dt>Protección eliminación</dt><dd><span :class="['gi-badge', d.security?.deletionProtection ? 'ok' : 'warn']">{{ yesNo(d.security?.deletionProtection) }}</span></dd>
            <dt>Query Insights</dt><dd>{{ yesNo(d.security?.queryInsights) }}</dd>
            <dt>Certificado CA</dt><dd>vence {{ fmtDate(d.security?.serverCaExpires) }}</dd>
          </dl>
        </div>

        <div v-if="d.replication?.primary || d.replication?.replicas?.length" class="gi-card">
          <div class="gi-card-title">Replicación</div>
          <dl>
            <dt v-if="d.replication.primary">Primaria</dt><dd v-if="d.replication.primary" class="gi-mono">{{ d.replication.primary }}</dd>
            <dt>Réplicas</dt><dd><span v-for="r in d.replication.replicas" :key="r" class="gi-chip">{{ r }}</span><span v-if="!d.replication.replicas.length">—</span></dd>
          </dl>
        </div>
      </div>
    </template>

    <!-- ══ Configuración (flags) ══ -->
    <template v-else-if="section === 'config'">
      <div class="gi-card">
        <div class="gi-card-title">Flags de base de datos ({{ d.flags?.length || 0 }})</div>
        <table v-if="d.flags?.length" class="gi-table" data-test="flags">
          <thead><tr><th>Flag</th><th>Valor</th></tr></thead>
          <tbody><tr v-for="f in d.flags" :key="f.name"><td class="gi-mono">{{ f.name }}</td><td class="gi-mono">{{ f.value }}</td></tr></tbody>
        </table>
        <div v-else class="gi-empty">Sin flags personalizados (se usan los valores por defecto).</div>
      </div>
    </template>

    <!-- ══ Conexión ══ -->
    <template v-else-if="section === 'connection'">
      <div class="gi-grid">
        <div class="gi-card">
          <div class="gi-card-title">Direcciones</div>
          <dl>
            <dt>Connection name</dt><dd class="gi-mono gi-wrap">{{ d.connectionName || '—' }}</dd>
            <dt>IP pública</dt><dd class="gi-mono">{{ d.network?.publicIp || '—' }}<span v-if="d.network && !d.network.ipv4Enabled" class="gi-dim"> (desactivada)</span></dd>
            <dt>IP privada</dt><dd class="gi-mono">{{ d.network?.privateIp || '—' }}<span v-if="d.network?.privateNetwork" class="gi-dim"> · VPC {{ d.network.privateNetwork }}</span></dd>
            <dt>IP de salida</dt><dd class="gi-mono">{{ d.network?.outgoingIp || '—' }}</dd>
            <dt v-if="d.dnsName">DNS</dt><dd v-if="d.dnsName" class="gi-mono gi-wrap">{{ d.dnsName }}</dd>
            <dt>Private Service Connect</dt><dd>{{ yesNo(d.network?.pscEnabled) }}</dd>
          </dl>
        </div>
        <div class="gi-card">
          <div class="gi-card-title">Cifrado en tránsito</div>
          <dl>
            <dt>Modo SSL</dt><dd><span :class="['gi-badge', sslTone]">{{ sslLabel }}</span></dd>
          </dl>
        </div>
        <div class="gi-card wide">
          <div class="gi-card-title">Redes autorizadas ({{ d.network?.authorizedNetworks?.length || 0 }})</div>
          <table v-if="d.network?.authorizedNetworks?.length" class="gi-table" data-test="authorized">
            <thead><tr><th>Nombre</th><th>CIDR</th></tr></thead>
            <tbody>
              <tr v-for="n in d.network.authorizedNetworks" :key="n.cidr">
                <td>{{ n.name || '—' }}</td>
                <td class="gi-mono">{{ n.cidr }} <span v-if="n.cidr === '0.0.0.0/0'" class="gi-badge err">todo Internet</span></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="gi-empty">Ninguna: solo conexiones vía Cloud SQL Auth Proxy / conectores o IP privada.</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import './gcpInfo.css'

const props = defineProps({
  detail:  { type: Object, required: true },
  section: { type: String, default: 'overview' },   // overview | config | connection
})
const d = computed(() => props.detail || {})

const SSL = {
  ENCRYPTED_ONLY: ['Solo conexiones cifradas', 'ok'],
  TRUSTED_CLIENT_CERTIFICATE_REQUIRED: ['Requiere certificado de cliente', 'ok'],
  REQUIRE_SSL: ['Requiere SSL', 'ok'],
  ALLOW_UNENCRYPTED_AND_ENCRYPTED: ['Permite conexiones sin cifrar', 'err'],
}
const sslLabel = computed(() => SSL[d.value.network?.sslMode]?.[0] || d.value.network?.sslMode || '—')
const sslTone = computed(() => SSL[d.value.network?.sslMode]?.[1] || '')

const notes = computed(() => {
  const out = []
  const v = d.value
  if (v.backups && !v.backups.enabled) out.push({ level: 'err', text: 'Los backups automáticos están desactivados.' })
  if (v.network?.sslMode === 'ALLOW_UNENCRYPTED_AND_ENCRYPTED') out.push({ level: 'err', text: 'Se permiten conexiones sin cifrar.' })
  if ((v.network?.authorizedNetworks || []).some(n => n.cidr === '0.0.0.0/0')) out.push({ level: 'err', text: 'Una red autorizada es 0.0.0.0/0: la base está abierta a todo Internet.' })
  else if (v.network?.ipv4Enabled && v.network?.authorizedNetworks?.length) out.push({ level: 'warn', text: `IP pública con ${v.network.authorizedNetworks.length} red(es) autorizada(s).` })
  if (v.security && !v.security.deletionProtection) out.push({ level: 'warn', text: 'Sin protección contra eliminación.' })
  if (v.availabilityType !== 'REGIONAL') out.push({ level: 'warn', text: 'Instancia zonal: sin failover automático ante caída de la zona.' })
  if (v.status === 'STOPPED') out.push({ level: 'warn', text: 'Detenida: el almacenamiento y las IPs siguen facturando.' })
  return out
})

function yesNo(v) { return v == null ? '—' : v ? 'Sí' : 'No' }
function fmt(v) { return v ? new Date(v).toLocaleString() : '—' }
function fmtDate(v) { return v ? new Date(v).toLocaleDateString() : '—' }
</script>
