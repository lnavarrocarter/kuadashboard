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
            <dt>Nombre</dt><dd>{{ d.name }}</dd>
            <dt>ID</dt><dd class="gi-mono">{{ d.instanceId || '—' }}</dd>
            <dt>Estado</dt><dd><span :class="['gi-badge', statusTone(d.status)]">{{ d.status }}</span><div v-if="d.statusMessage" class="gi-dim">{{ d.statusMessage }}</div></dd>
            <dt>Zona</dt><dd class="gi-mono">{{ d.zone }}</dd>
            <dt>Creada</dt><dd>{{ fmt(d.created) }}</dd>
            <dt>Último inicio</dt><dd>{{ fmt(d.lastStart) }}</dd>
            <dt>Última detención</dt><dd>{{ fmt(d.lastStop) }}</dd>
            <dt v-if="d.description">Descripción</dt><dd v-if="d.description">{{ d.description }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Máquina</div>
          <dl>
            <dt>Tipo</dt><dd class="gi-mono">{{ d.machine?.type }}</dd>
            <dt>Sistema</dt><dd>{{ d.machine?.os || '—' }}</dd>
            <dt>Plataforma CPU</dt><dd>{{ d.machine?.cpuPlatform || '—' }}</dd>
            <dt v-if="d.machine?.minCpuPlatform">CPU mínima</dt><dd v-if="d.machine?.minCpuPlatform">{{ d.machine.minCpuPlatform }}</dd>
            <dt>GPUs</dt><dd>{{ d.machine?.gpus?.length ? d.machine.gpus.map(g => `${g.count}× ${g.type}`).join(', ') : '—' }}</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Disponibilidad</div>
          <dl>
            <dt>Modelo</dt><dd><span :class="['gi-badge', d.scheduling?.provisioningModel === 'STANDARD' ? '' : 'warn']">{{ d.scheduling?.provisioningModel }}</span></dd>
            <dt>Reinicio automático</dt><dd>{{ yesNo(d.scheduling?.automaticRestart) }}</dd>
            <dt>Mantenimiento host</dt><dd>{{ d.scheduling?.onHostMaintenance === 'MIGRATE' ? 'Migrar en vivo' : d.scheduling?.onHostMaintenance === 'TERMINATE' ? 'Detener' : '—' }}</dd>
            <dt v-if="d.scheduling?.terminationAction">Al ser interrumpida</dt><dd v-if="d.scheduling?.terminationAction">{{ d.scheduling.terminationAction === 'STOP' ? 'Detener' : 'Eliminar' }}</dd>
            <dt v-if="d.scheduling?.maxRunDurationSeconds">Duración máx.</dt><dd v-if="d.scheduling?.maxRunDurationSeconds">{{ Math.round(d.scheduling.maxRunDurationSeconds / 3600) }} h</dd>
          </dl>
        </div>

        <div class="gi-card">
          <div class="gi-card-title">Seguridad</div>
          <dl>
            <dt>Protección eliminación</dt><dd><span :class="['gi-badge', d.security?.deletionProtection ? 'ok' : '']">{{ yesNo(d.security?.deletionProtection) }}</span></dd>
            <dt>Secure Boot</dt><dd>{{ yesNo(d.security?.secureBoot) }}</dd>
            <dt>vTPM · Integridad</dt><dd>{{ yesNo(d.security?.vtpm) }} · {{ yesNo(d.security?.integrityMonitoring) }}</dd>
            <dt>Confidential VM</dt><dd>{{ yesNo(d.security?.confidentialCompute) }}</dd>
            <dt>OS Login</dt><dd>{{ d.security?.osLogin ? (String(d.security.osLogin).toUpperCase() === 'TRUE' ? 'Activado (instancia)' : 'Desactivado (instancia)') : 'Según proyecto' }}</dd>
            <dt>IP forwarding</dt><dd>{{ yesNo(d.security?.canIpForward) }}</dd>
            <dt>Puerto serie</dt><dd>{{ yesNo(d.security?.serialPortEnabled) }}</dd>
          </dl>
        </div>

        <div class="gi-card wide">
          <div class="gi-card-title">Cuentas de servicio</div>
          <div v-if="!d.security?.serviceAccounts?.length" class="gi-empty">Sin cuenta de servicio asociada.</div>
          <div v-for="sa in d.security?.serviceAccounts || []" :key="sa.email" style="margin-bottom:6px">
            <div class="gi-mono">{{ sa.email }}</div>
            <span v-for="s in sa.scopes" :key="s" class="gi-chip">{{ s }}</span>
          </div>
        </div>

        <div class="gi-card wide">
          <div class="gi-card-title">Network tags y metadata</div>
          <dl>
            <dt>Network tags</dt>
            <dd><span v-for="t in d.tags" :key="t" class="gi-chip">{{ t }}</span><span v-if="!d.tags?.length" class="gi-dim">—</span></dd>
            <dt>Metadata</dt>
            <dd>
              <span v-if="!d.metadata?.length" class="gi-dim">—</span>
              <div v-for="m in d.metadata" :key="m.key" class="gi-mono">
                {{ m.key }}
                <span v-if="m.sensitive" class="gi-dim">· valor oculto ({{ m.size }} caracteres)</span>
                <span v-else class="gi-dim">= {{ m.value || '""' }}</span>
              </div>
            </dd>
          </dl>
        </div>
      </div>
    </template>

    <!-- ══ Discos ══ -->
    <template v-else-if="section === 'disks'">
      <div class="gi-card">
        <div class="gi-card-title">Discos ({{ d.disks?.length || 0 }} · {{ totalDiskGb }} GB)</div>
        <table v-if="d.disks?.length" class="gi-table" data-test="disks">
          <thead><tr><th>Disco</th><th>Tipo</th><th>Tamaño</th><th>Interfaz</th><th>Modo</th><th>Imagen de origen</th><th>Cifrado</th><th>Auto-delete</th></tr></thead>
          <tbody>
            <tr v-for="disk in d.disks" :key="disk.deviceName">
              <td><span class="gi-mono">{{ disk.name || disk.deviceName }}</span> <span v-if="disk.boot" class="gi-badge">boot</span><div class="gi-dim">{{ disk.os || '' }}</div></td>
              <td class="gi-mono">{{ disk.type || disk.kind }}</td>
              <td>{{ disk.sizeGb ? `${disk.sizeGb} GB` : '—' }}</td>
              <td>{{ disk.interface || '—' }}</td>
              <td>{{ disk.mode === 'READ_WRITE' ? 'Lectura/escritura' : disk.mode === 'READ_ONLY' ? 'Solo lectura' : disk.mode }}</td>
              <td class="gi-mono gi-wrap">{{ disk.sourceImage || '—' }}</td>
              <td>{{ disk.encryption }}</td>
              <td><span :class="['gi-badge', disk.autoDelete ? '' : 'warn']" :title="disk.autoDelete ? '' : 'Se conserva (y factura) al eliminar la VM'">{{ yesNo(disk.autoDelete) }}</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="gi-empty">Sin discos.</div>
      </div>
    </template>

    <!-- ══ Red ══ -->
    <template v-else-if="section === 'network'">
      <div v-for="n in d.networks || []" :key="n.name" class="gi-card">
        <div class="gi-card-title">Interfaz {{ n.name }}</div>
        <dl>
          <dt>Red / subred</dt><dd class="gi-mono">{{ n.network }} / {{ n.subnetwork }}</dd>
          <dt>IP interna</dt><dd class="gi-mono">{{ n.internalIp || '—' }}</dd>
          <dt>IP externa</dt><dd class="gi-mono">{{ n.externalIp || '—' }} <span v-if="n.networkTier" class="gi-badge">{{ n.networkTier }}</span></dd>
          <dt v-if="n.ipv6">IPv6</dt><dd v-if="n.ipv6" class="gi-mono">{{ n.ipv6 }}</dd>
          <dt>Stack</dt><dd>{{ n.stackType || 'IPV4_ONLY' }}</dd>
          <dt v-if="n.aliasRanges?.length">Rangos alias</dt><dd v-if="n.aliasRanges?.length"><span v-for="r in n.aliasRanges" :key="r" class="gi-chip">{{ r }}</span></dd>
        </dl>
      </div>
      <div v-if="!d.networks?.length" class="gi-empty">Sin interfaces de red.</div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import './gcpInfo.css'

const props = defineProps({
  detail:  { type: Object, required: true },
  section: { type: String, default: 'overview' },   // overview | disks | network
})
const d = computed(() => props.detail || {})

const totalDiskGb = computed(() => (d.value.disks || []).reduce((sum, disk) => sum + (disk.sizeGb || 0), 0))

// Security / cost observations worth a second look
const notes = computed(() => {
  const out = []
  const v = d.value
  const hasExternalIp = (v.networks || []).some(n => n.externalIp)
  if (hasExternalIp) out.push({ level: 'warn', text: 'Tiene IP pública: revisa las reglas de firewall que la exponen.' })
  if ((v.security?.serviceAccounts || []).some(sa => sa.scopes.some(s => s.startsWith('cloud-platform')))) {
    out.push({ level: 'warn', text: 'La cuenta de servicio tiene el scope cloud-platform (acceso a todas las APIs según sus roles IAM).' })
  }
  if ((v.security?.serviceAccounts || []).some(sa => /-compute@developer\.gserviceaccount\.com$/.test(sa.email))) {
    out.push({ level: 'warn', text: 'Usa la cuenta de servicio por defecto de Compute (suele tener el rol Editor del proyecto).' })
  }
  if (v.security && !v.security.secureBoot) out.push({ level: 'warn', text: 'Secure Boot desactivado.' })
  if (v.security && !v.security.deletionProtection) out.push({ level: 'warn', text: 'Sin protección contra eliminación.' })
  if (v.security?.serialPortEnabled) out.push({ level: 'err', text: 'El puerto serie interactivo está habilitado.' })
  if (['SPOT', 'PREEMPTIBLE'].includes(v.scheduling?.provisioningModel)) out.push({ level: 'warn', text: 'VM Spot/Preemptible: Google puede detenerla en cualquier momento.' })
  if ((v.disks || []).some(disk => !disk.autoDelete)) out.push({ level: 'warn', text: 'Hay discos sin auto-delete: se conservan (y facturan) si eliminas la VM.' })
  return out
})

function statusTone(s) {
  if (s === 'RUNNING') return 'ok'
  if (['STOPPING', 'PROVISIONING', 'STAGING', 'SUSPENDING', 'REPAIRING'].includes(s)) return 'warn'
  if (['TERMINATED', 'SUSPENDED'].includes(s)) return ''
  return 'err'
}
function yesNo(v) { return v == null ? '—' : v ? 'Sí' : 'No' }
function fmt(v) { return v ? new Date(v).toLocaleString() : '—' }
</script>
