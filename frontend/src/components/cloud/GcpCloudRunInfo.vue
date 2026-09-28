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
          <div class="gi-card-title">Servicio</div>
          <dl>
            <dt>URL</dt><dd><a v-if="d.uri" :href="d.uri" target="_blank" rel="noopener" class="gi-mono gi-wrap">{{ d.uri }}</a><span v-else>—</span></dd>
            <dt>Estado</dt><dd><span :class="['gi-badge', d.status === 'ready' ? 'ok' : d.status === 'failed' ? 'err' : 'warn']">{{ d.status }}</span><div v-if="d.statusMessage && d.status !== 'ready'" class="gi-dim">{{ d.statusMessage }}</div></dd>
            <dt>Región</dt><dd class="gi-mono">{{ d.region }}</dd>
            <dt>Creado</dt><dd>{{ fmt(d.created) }}<span v-if="d.creator" class="gi-dim"> · {{ d.creator }}</span></dd>
            <dt>Actualizado</dt><dd>{{ fmt(d.updated) }}<span v-if="d.lastModifier" class="gi-dim"> · {{ d.lastModifier }}</span></dd>
            <dt>Generación</dt><dd>{{ d.generation || '—' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Acceso</div>
          <dl>
            <dt>Ingress</dt><dd>{{ ingressLabel }}</dd>
            <dt>Invocación</dt>
            <dd>
              <span v-if="d.publicAccess === true" class="gi-badge warn">Pública (allUsers)</span>
              <span v-else-if="d.publicAccess === false" class="gi-badge ok">Requiere autenticación</span>
              <span v-else class="gi-dim">No se pudo leer la política IAM</span>
            </dd>
            <dt>Cuenta de servicio</dt><dd class="gi-mono gi-wrap">{{ d.serviceAccount || 'Compute default' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Contenedor</div>
          <dl>
            <dt>Imagen</dt><dd class="gi-mono gi-wrap">{{ d.container?.image || '—' }}</dd>
            <dt>Puerto</dt><dd>{{ d.container?.port || '—' }}</dd>
            <dt>CPU / Memoria</dt><dd>{{ d.container?.cpu || '—' }} / {{ d.container?.memory || '—' }}</dd>
            <dt>Asignación CPU</dt><dd>{{ d.container?.cpuAlwaysAllocated ? 'Siempre asignada' : 'Solo durante requests' }}<span v-if="d.container?.startupCpuBoost" class="gi-dim"> · boost al iniciar</span></dd>
            <dt v-if="d.container?.command?.length">Comando</dt><dd v-if="d.container?.command?.length" class="gi-mono">{{ [...d.container.command, ...(d.container.args || [])].join(' ') }}</dd>
            <dt>Probe de inicio</dt><dd>{{ probeText(d.container?.startupProbe) }}</dd>
            <dt>Probe de vida</dt><dd>{{ probeText(d.container?.livenessProbe) }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Escalado</div>
          <dl>
            <dt>Instancias</dt><dd>{{ d.scaling?.minInstances ?? 0 }} – {{ d.scaling?.maxInstances ?? '∞' }}<span v-if="d.scaling?.minInstances > 0" class="gi-badge warn" style="margin-left:6px">24/7</span></dd>
            <dt>Concurrencia</dt><dd>{{ d.scaling?.concurrency ?? '—' }} requests/instancia</dd>
            <dt>Timeout</dt><dd>{{ d.scaling?.timeoutSeconds ? `${d.scaling.timeoutSeconds} s` : '—' }}</dd>
            <dt>Entorno</dt><dd>{{ d.scaling?.executionEnvironment || 'Por defecto' }}</dd>
            <dt>Afinidad de sesión</dt><dd>{{ d.scaling?.sessionAffinity ? 'Sí' : 'No' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Red</div>
          <dl>
            <dt>VPC connector</dt><dd class="gi-mono">{{ d.networking?.vpcConnector || '—' }}</dd>
            <dt>Direct VPC</dt><dd class="gi-mono">{{ d.networking?.directVpc?.length ? d.networking.directVpc.map(n => `${n.network}/${n.subnetwork || '*'}`).join(', ') : '—' }}</dd>
            <dt>Egress</dt><dd>{{ d.networking?.vpcEgress || '—' }}</dd>
            <dt>Cloud SQL</dt><dd><span v-for="i in d.cloudSqlInstances || []" :key="i" class="gi-chip">{{ i }}</span><span v-if="!d.cloudSqlInstances?.length">—</span></dd>
          </dl>
        </div>

        <div v-if="d.conditions?.length" class="gi-card">
          <div class="gi-card-title">Condiciones</div>
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
        <div class="gi-card-title">Tráfico</div>
        <table class="gi-table" data-test="traffic">
          <thead><tr><th>Destino</th><th>Tráfico</th><th>Tag</th></tr></thead>
          <tbody>
            <tr v-for="(t, i) in d.traffic || []" :key="i">
              <td class="gi-mono">{{ t.latest ? `Última (${latestRevision || '—'})` : t.revision }}</td>
              <td style="min-width:140px"><div style="display:flex;align-items:center;gap:6px"><div class="gi-bar" style="flex:1"><span :style="{ width: `${t.percent}%` }"></span></div>{{ t.percent }}%</div></td>
              <td class="gi-mono">{{ t.tag || '—' }}<div v-if="t.uri" class="gi-dim gi-wrap">{{ t.uri }}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="gi-card">
        <div class="gi-card-title">Revisiones ({{ d.revisions?.length || 0 }})</div>
        <table v-if="d.revisions?.length" class="gi-table">
          <thead><tr><th>Revisión</th><th>Creada</th><th>Tráfico</th><th>Lista</th><th>Imagen</th></tr></thead>
          <tbody>
            <tr v-for="r in d.revisions" :key="r.name">
              <td class="gi-mono">{{ r.name }}</td>
              <td>{{ fmt(r.created) }}</td>
              <td>{{ r.traffic != null ? `${r.traffic}%` : '—' }}</td>
              <td><span :class="['gi-badge', r.ready ? 'ok' : 'warn']">{{ r.ready ? 'Sí' : 'No' }}</span></td>
              <td class="gi-mono gi-wrap">{{ shortImage(r.image) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="gi-empty">Sin revisiones.</div>
      </div>
    </template>

    <!-- ══ Variables y secretos ══ -->
    <template v-else-if="section === 'variables'">
      <div class="gi-card">
        <div class="gi-card-title">Variables de entorno ({{ d.envVars?.length || 0 }})</div>
        <table v-if="d.envVars?.length" class="gi-table" data-test="env">
          <thead><tr><th>Nombre</th><th>Valor</th></tr></thead>
          <tbody>
            <tr v-for="e in d.envVars" :key="e.name">
              <td class="gi-mono">{{ e.name }}</td>
              <td class="gi-mono gi-wrap">
                <span v-if="e.secret" class="gi-badge ok" title="Valor en Secret Manager">🔐 {{ e.secret }}</span>
                <template v-else>{{ e.value }}<span v-if="looksSecret(e)" class="gi-badge warn" style="margin-left:6px" title="Parece un secreto en texto plano; considera Secret Manager">posible secreto</span></template>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="gi-empty">Sin variables de entorno.</div>
      </div>
      <div v-if="d.secretVolumes?.length" class="gi-card">
        <div class="gi-card-title">Secretos montados como volumen</div>
        <div v-for="v in d.secretVolumes" :key="v.name" class="gi-mono">{{ v.name }} → {{ v.secret }}</div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import './gcpInfo.css'

const props = defineProps({
  detail:  { type: Object, required: true },
  section: { type: String, default: 'overview' },   // overview | revisions | variables
})
const d = computed(() => props.detail || {})

const SECRET_NAME = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential)/i
function looksSecret(e) { return !e.secret && SECRET_NAME.test(e.name) && (e.value || '').length >= 8 }

const ingressLabel = computed(() => ({
  all: 'Todo Internet',
  internal_only: 'Solo interno (VPC)',
  internal_load_balancer: 'Interno + Load Balancer',
}[d.value.ingress] || d.value.ingress || '—'))

const latestRevision = computed(() => (d.value.revisions || []).find(r => r.traffic)?.name || d.value.revisions?.[0]?.name)

const notes = computed(() => {
  const out = []
  const v = d.value
  if (v.publicAccess && v.ingress === 'all') out.push({ level: 'warn', text: 'Cualquier persona en Internet puede invocar este servicio (allUsers).' })
  if ((v.scaling?.minInstances || 0) > 0) out.push({ level: 'warn', text: `${v.scaling.minInstances} instancia(s) mínima(s): se facturan 24/7 aunque no haya tráfico.` })
  const plain = (v.envVars || []).filter(looksSecret)
  if (plain.length) out.push({ level: 'err', text: `Posibles secretos en texto plano: ${plain.map(e => e.name).join(', ')}. Usa Secret Manager.` })
  if (!v.serviceAccount) out.push({ level: 'warn', text: 'Usa la cuenta de servicio por defecto de Compute (suele tener permisos amplios).' })
  if (v.status === 'failed') out.push({ level: 'err', text: v.statusMessage || 'El último despliegue falló.' })
  return out
})

function probeText(p) {
  if (!p) return '—'
  return `${p.kind}${p.periodSeconds ? ` · cada ${p.periodSeconds}s` : ''}${p.failureThreshold ? ` · ${p.failureThreshold} fallo(s)` : ''}`
}
function shortImage(image) {
  if (!image) return '—'
  return image.split('/').pop().replace(/@sha256:(\w{12})\w+/, '@$1…')
}
function fmt(v) { return v ? new Date(v).toLocaleString() : '—' }
</script>
