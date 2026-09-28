<template>
  <Teleport to="body">
    <div v-if="open" class="eksd-backdrop" @mousedown.self="$emit('close')">
      <div class="eksd-modal">

        <!-- Header -->
        <div class="eksd-header">
          <div class="eksd-title">
            <span class="eksd-icon">☸</span>
            <span>{{ cluster?.name }}</span>
            <span v-if="cluster?.version" class="eksd-id-badge">v{{ cluster.version }}</span>
            <span v-if="cluster?.status" :class="['eksd-state', stateClass(cluster.status)]">{{ cluster.status }}</span>
            <span v-if="cluster?.region" class="badge-gray">{{ cluster.region }}</span>
          </div>
          <button class="eksd-close" @click="$emit('close')">✕</button>
        </div>

        <!-- Tabs -->
        <div class="eksd-tabs">
          <button v-for="tab in TABS" :key="tab.id"
            :class="['eksd-tab', { active: activeTab === tab.id }]"
            @click="activeTab = tab.id">
            {{ tab.label }}<span v-if="data && tab.count" class="eksd-tab-count">{{ tab.count(data) }}</span>
          </button>
          <div class="eksd-tabs-right">
            <button v-if="loaded" class="btn sm" @click="load" :disabled="loading" title="Refrescar">↺</button>
          </div>
        </div>

        <!-- Body -->
        <div class="eksd-body">

          <div v-if="loading" class="eksd-spinner-wrap">
            <div class="eksd-spinner"></div>
            <span>Cargando infraestructura del cluster...</span>
          </div>
          <div v-else-if="error" class="eksd-error">{{ error }}</div>

          <template v-else-if="data">

            <div v-if="data.warnings?.length" class="eksd-notice">
              <strong>⚠ Información parcial</strong>
              <div v-for="w in data.warnings" :key="w.section" class="eksd-notice-row">
                <span class="mono">{{ SECTION_LABELS[w.section] || w.section }}</span>: {{ w.message }}
              </div>
            </div>

            <!-- ══ OVERVIEW ═════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'overview'" class="eksd-section" data-tab="overview">
              <div class="eksd-grid">
                <div class="eksd-card">
                  <div class="eksd-card-title">Cluster</div>
                  <dl>
                    <dt>Nombre</dt>     <dd>{{ data.cluster.name }}</dd>
                    <dt>ARN</dt>        <dd class="mono wrap copyable">{{ data.cluster.arn }}<button class="copy-btn" @click.stop="copyField(data.cluster.arn,'arn')" :title="copiedKey==='arn'?'¡Copiado!':'Copiar'">{{ copiedKey==='arn' ? '✓' : '⧉' }}</button></dd>
                    <dt>Versión</dt>    <dd class="mono">{{ data.cluster.version }} <span class="text-dim">({{ data.cluster.platformVersion || '—' }})</span></dd>
                    <dt>Estado</dt>     <dd><span :class="['eksd-state', stateClass(data.cluster.status)]">{{ data.cluster.status }}</span></dd>
                    <dt>Creado</dt>     <dd>{{ fmtDate(data.cluster.createdAt) }}</dd>
                    <dt>Rol IAM</dt>    <dd class="mono wrap copyable">{{ data.cluster.roleArn || '—' }}<button v-if="data.cluster.roleArn" class="copy-btn" @click.stop="copyField(data.cluster.roleArn,'role')" :title="copiedKey==='role'?'¡Copiado!':'Copiar'">{{ copiedKey==='role' ? '✓' : '⧉' }}</button></dd>
                  </dl>
                </div>

                <div class="eksd-card">
                  <div class="eksd-card-title">API endpoint</div>
                  <dl>
                    <dt>Endpoint</dt>   <dd class="mono wrap copyable">{{ data.cluster.endpoint || '—' }}<button v-if="data.cluster.endpoint" class="copy-btn" @click.stop="copyField(data.cluster.endpoint,'endpoint')" :title="copiedKey==='endpoint'?'¡Copiado!':'Copiar'">{{ copiedKey==='endpoint' ? '✓' : '⧉' }}</button></dd>
                    <dt>Público</dt>    <dd><span :class="data.cluster.endpointPublicAccess ? 'badge-yellow' : 'badge-gray'">{{ data.cluster.endpointPublicAccess ? 'Sí' : 'No' }}</span></dd>
                    <dt>Privado</dt>    <dd><span :class="data.cluster.endpointPrivateAccess ? 'badge-green' : 'badge-gray'">{{ data.cluster.endpointPrivateAccess ? 'Sí' : 'No' }}</span></dd>
                    <dt v-if="data.cluster.endpointPublicAccess">CIDRs públicos</dt>
                    <dd v-if="data.cluster.endpointPublicAccess" class="mono">{{ data.cluster.publicAccessCidrs.join(', ') || '—' }}</dd>
                    <dt>OIDC issuer</dt><dd class="mono wrap">{{ data.cluster.oidcIssuer || '—' }}</dd>
                    <dt>Autenticación</dt><dd>{{ data.cluster.authenticationMode || '—' }}</dd>
                  </dl>
                </div>

                <div class="eksd-card">
                  <div class="eksd-card-title">Red del cluster</div>
                  <dl>
                    <dt>VPC</dt>        <dd class="mono copyable">{{ data.network.vpc?.id || '—' }}<button v-if="data.network.vpc?.id" class="copy-btn" @click.stop="copyField(data.network.vpc.id,'vpc')" :title="copiedKey==='vpc'?'¡Copiado!':'Copiar'">{{ copiedKey==='vpc' ? '✓' : '⧉' }}</button></dd>
                    <dt>CIDR VPC</dt>   <dd class="mono">{{ data.network.vpc?.cidr || '—' }}</dd>
                    <dt>CIDR services</dt><dd class="mono">{{ data.cluster.serviceIpv4Cidr || '—' }}</dd>
                    <dt>IP family</dt>  <dd>{{ data.cluster.ipFamily || '—' }}</dd>
                    <dt>Subnets</dt>    <dd>{{ data.network.subnets.length }}</dd>
                    <dt>Security groups</dt><dd>{{ data.network.securityGroups.length }}</dd>
                  </dl>
                </div>

                <div class="eksd-card">
                  <div class="eksd-card-title">Capacidad</div>
                  <dl>
                    <dt>Node groups</dt><dd>{{ data.nodegroups.length }}</dd>
                    <dt>Instancias EC2</dt><dd>{{ data.instances.length }}</dd>
                    <dt>Add-ons</dt>    <dd>{{ data.addons.length }}</dd>
                    <dt>Logging</dt>
                    <dd>
                      <span v-if="!data.cluster.logging.length" class="badge-gray">deshabilitado</span>
                      <span v-for="l in data.cluster.logging" :key="l" class="eksd-chip">{{ l }}</span>
                    </dd>
                  </dl>
                </div>
              </div>

              <div class="eksd-card" style="margin-top:12px">
                <div class="eksd-card-title">Tags ({{ Object.keys(data.cluster.tags || {}).length }})</div>
                <table class="eksd-table" v-if="Object.keys(data.cluster.tags || {}).length">
                  <thead><tr><th>Clave</th><th>Valor</th></tr></thead>
                  <tbody>
                    <tr v-for="(v, k) in data.cluster.tags" :key="k">
                      <td class="mono">{{ k }}</td>
                      <td class="mono wrap">{{ v }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">Sin tags.</div>
              </div>
            </div>

            <!-- ══ NETWORK ══════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'network'" class="eksd-section" data-tab="network">
              <div class="eksd-card" style="margin-bottom:12px">
                <div class="eksd-card-title">Subnets ({{ data.network.subnets.length }})</div>
                <table v-if="data.network.subnets.length" class="eksd-table">
                  <thead><tr><th>Subnet</th><th>CIDR</th><th>Zona</th><th>IPs libres</th><th>IP pública</th><th>Usada por</th></tr></thead>
                  <tbody>
                    <tr v-for="s in data.network.subnets" :key="s.id">
                      <td class="mono">{{ s.id }}<div v-if="s.name" class="text-dim eksd-sub">{{ s.name }}</div></td>
                      <td class="mono">{{ s.cidr || '—' }}</td>
                      <td class="mono">{{ s.az || '—' }}</td>
                      <td>{{ s.availableIps ?? '—' }}</td>
                      <td><span v-if="s.mapPublicIp !== null" :class="s.mapPublicIp ? 'badge-yellow' : 'badge-gray'">{{ s.mapPublicIp ? 'Sí' : 'No' }}</span><span v-else>—</span></td>
                      <td><span v-for="u in s.usedBy" :key="u" class="eksd-chip">{{ u }}</span></td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">Sin subnets.</div>
              </div>

              <div class="eksd-card">
                <div class="eksd-card-title">Security groups ({{ data.network.securityGroups.length }})</div>
                <table v-if="data.network.securityGroups.length" class="eksd-table">
                  <thead><tr><th>Grupo</th><th>Rol</th><th>Reglas in / out</th><th>Descripción</th></tr></thead>
                  <tbody>
                    <tr v-for="g in data.network.securityGroups" :key="g.id">
                      <td class="mono">{{ g.id }}<div v-if="g.name" class="text-dim eksd-sub">{{ g.name }}</div></td>
                      <td><span v-for="r in g.roles" :key="r" class="eksd-chip">{{ r }}</span></td>
                      <td class="mono">{{ g.inboundRules ?? '—' }} / {{ g.outboundRules ?? '—' }}</td>
                      <td class="text-dim">{{ g.description || '—' }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">Sin security groups.</div>
              </div>
            </div>

            <!-- ══ NODE GROUPS ══════════════════════════════════════════════ -->
            <div v-show="activeTab === 'nodegroups'" class="eksd-section" data-tab="nodegroups">
              <div v-if="!data.nodegroups.length" class="eksd-empty">Sin managed node groups (el cluster puede usar Fargate, Karpenter o nodos self-managed).</div>
              <div v-for="ng in data.nodegroups" :key="ng.name" class="eksd-card" style="margin-bottom:12px">
                <div class="eksd-card-title">
                  🖥 {{ ng.name }}
                  <span :class="['eksd-state', stateClass(ng.status)]">{{ ng.status }}</span>
                  <span class="badge-gray">{{ ng.capacityType }}</span>
                  <span class="badge-gray">{{ ng.architecture }}</span>
                </div>
                <dl>
                  <dt>Tipos</dt>        <dd class="mono">{{ ng.instanceTypes.join(', ') || '—' }}</dd>
                  <dt>Escalado</dt>     <dd>min {{ ng.scaling.minSize ?? '—' }} · deseado {{ ng.scaling.desiredSize ?? '—' }} · max {{ ng.scaling.maxSize ?? '—' }}</dd>
                  <dt>Instancias EC2</dt><dd>{{ ng.instanceCount ?? 0 }}</dd>
                  <dt>AMI</dt>          <dd class="mono">{{ ng.amiType || '—' }} <span class="text-dim">{{ ng.releaseVersion || '' }}</span></dd>
                  <dt>Versión K8s</dt>  <dd class="mono">{{ ng.version || '—' }}</dd>
                  <dt>Disco</dt>        <dd>{{ ng.diskSize ? ng.diskSize + ' GiB' : '—' }}</dd>
                  <dt>Subnets</dt>      <dd class="mono">{{ ng.subnets.join(', ') || '—' }}</dd>
                  <dt>Auto Scaling</dt> <dd class="mono">{{ ng.autoScalingGroups.join(', ') || '—' }}</dd>
                  <dt>Launch template</dt><dd class="mono">{{ ng.launchTemplate ? `${ng.launchTemplate.name || ng.launchTemplate.id} (v${ng.launchTemplate.version})` : '—' }}</dd>
                  <dt>Rol de nodo</dt>  <dd class="mono wrap">{{ ng.nodeRole || '—' }}</dd>
                </dl>
                <div v-if="ng.healthIssues.length" class="eksd-issues">
                  <div v-for="(h, i) in ng.healthIssues" :key="i"><span class="badge-red">{{ h.code }}</span> {{ h.message }}</div>
                </div>
              </div>
            </div>

            <!-- ══ EC2 ══════════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'instances'" class="eksd-section" data-tab="instances">
              <div v-if="!data.instances.length" class="eksd-empty">Sin instancias EC2 asociadas (Fargate o sin nodos activos).</div>
              <div v-else class="eksd-card">
                <table class="eksd-table">
                  <thead><tr><th>Instancia</th><th>Tipo</th><th>Estado</th><th>Origen</th><th>IP privada</th><th>Zona</th><th>Ciclo</th><th>Lanzada</th></tr></thead>
                  <tbody>
                    <tr v-for="i in data.instances" :key="i.id">
                      <td class="mono copyable">{{ i.id }}<button class="copy-btn" @click.stop="copyField(i.id, i.id)" :title="copiedKey===i.id?'¡Copiado!':'Copiar'">{{ copiedKey===i.id ? '✓' : '⧉' }}</button><div v-if="i.name" class="text-dim eksd-sub">{{ i.name }}</div></td>
                      <td class="mono">{{ i.type }}</td>
                      <td><span :class="['eksd-state', stateClass(i.state)]">{{ i.state }}</span></td>
                      <td><span class="eksd-chip">{{ i.nodegroup }}</span></td>
                      <td class="mono">{{ i.privateIp || '—' }}</td>
                      <td class="mono">{{ i.az || '—' }}</td>
                      <td><span :class="i.lifecycle === 'spot' ? 'badge-yellow' : 'badge-gray'">{{ i.lifecycle }}</span></td>
                      <td style="white-space:nowrap">{{ fmtDate(i.launchTime) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- ══ ADD-ONS ══════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'addons'" class="eksd-section" data-tab="addons">
              <div v-if="!data.addons.length" class="eksd-empty">Sin add-ons administrados por EKS.</div>
              <div v-else class="eksd-card">
                <table class="eksd-table">
                  <thead><tr><th>Add-on</th><th>Versión</th><th>Estado</th><th>Rol IRSA</th><th>Problemas</th></tr></thead>
                  <tbody>
                    <tr v-for="a in data.addons" :key="a.name">
                      <td class="mono">{{ a.name }}</td>
                      <td class="mono">{{ a.version || '—' }}</td>
                      <td><span :class="['eksd-state', stateClass(a.status)]">{{ a.status || '—' }}</span></td>
                      <td class="mono wrap text-dim">{{ a.serviceAccountRoleArn || '—' }}</td>
                      <td>
                        <span v-if="!a.healthIssues.length" class="text-dim">—</span>
                        <div v-for="(h, i) in a.healthIssues" :key="i"><span class="badge-red">{{ h.code }}</span> {{ h.message }}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useAwsStore } from '../../stores/useAwsStore'

const props = defineProps({
  open:    { type: Boolean, default: false },
  cluster: { type: Object,  default: null  },
})
defineEmits(['close'])

const awsStore = useAwsStore()

const TABS = [
  { id: 'overview',   label: '📋 Overview' },
  { id: 'network',    label: '🌐 Red',           count: d => d.network.subnets.length + d.network.securityGroups.length },
  { id: 'nodegroups', label: '🖥 Node groups',   count: d => d.nodegroups.length },
  { id: 'instances',  label: 'Instancias EC2',  count: d => d.instances.length },
  { id: 'addons',     label: '🧩 Add-ons',       count: d => d.addons.length },
]

const SECTION_LABELS = {
  nodegroups: 'Node groups', addons: 'Add-ons', instances: 'Instancias EC2',
  vpc: 'VPC', subnets: 'Subnets', securityGroups: 'Security groups',
}

const activeTab = ref('overview')
const data      = ref(null)
const loading   = ref(false)
const loaded    = ref(false)
const error     = ref('')

watch(() => props.open, val => {
  if (val) {
    activeTab.value = 'overview'
    data.value   = null
    loaded.value = false
    error.value  = ''
    load()
  }
}, { immediate: true })

async function load() {
  const name = props.cluster?.name
  if (!name) return
  loading.value = true
  error.value   = ''
  try {
    const res = await awsStore.fetchEksDetails(name)
    if (props.cluster?.name !== name) return
    data.value   = res
    loaded.value = true
  } catch (e) {
    error.value = e?.message || 'No se pudo cargar la infraestructura del cluster'
  } finally {
    loading.value = false
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
}

function stateClass(s) {
  const v = String(s || '').toUpperCase()
  if (['ACTIVE', 'RUNNING', 'AVAILABLE'].includes(v)) return 'ok'
  if (['CREATING', 'UPDATING', 'PENDING', 'STOPPING'].includes(v)) return 'warn'
  if (['DEGRADED', 'CREATE_FAILED', 'DELETE_FAILED', 'FAILED', 'STOPPED', 'DELETING'].includes(v)) return 'err'
  return 'dim'
}

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
.eksd-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 800;
}
.eksd-modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: min(98vw, 1080px);
  max-height: 90vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,.7);
}

/* Header */
.eksd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  flex-shrink: 0; gap: 8px;
}
.eksd-title {
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  font-weight: 600; color: #e6edf3; font-size: .95rem;
}
.eksd-icon { font-size: 1.1rem; color: #58a6ff; }
.eksd-id-badge {
  background: rgba(88,166,255,.15); color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3);
  border-radius: 4px; padding: 1px 7px;
  font-size: .75rem; font-family: monospace;
}
.eksd-state { font-size: .72rem; padding: 2px 8px; border-radius: 12px; font-weight: 500; text-transform: none; letter-spacing: 0; }
.eksd-state.ok   { background: rgba(63,185,80,.2);   color: #3fb950; }
.eksd-state.warn { background: rgba(210,153,34,.2);  color: #d29922; }
.eksd-state.err  { background: rgba(248,81,73,.2);   color: #f85149; }
.eksd-state.dim  { background: rgba(139,148,158,.15); color: #8b949e; }
.eksd-close {
  background: none; border: none; color: #8b949e;
  cursor: pointer; font-size: 1rem; padding: 2px 5px; border-radius: 4px;
}
.eksd-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Tabs */
.eksd-tabs {
  display: flex; align-items: center;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  padding: 0 8px; gap: 2px;
  flex-shrink: 0; overflow-x: auto;
}
.eksd-tab {
  background: none; border: none;
  color: #8b949e; cursor: pointer;
  padding: 8px 13px; font-size: .82rem;
  border-bottom: 2px solid transparent;
  transition: all .15s; white-space: nowrap;
}
.eksd-tab:hover { color: #e6edf3; }
.eksd-tab.active { color: #58a6ff; border-bottom-color: #388bfd; }
.eksd-tab-count {
  margin-left: 6px; font-size: .7rem;
  background: rgba(139,148,158,.15); color: #8b949e;
  border-radius: 10px; padding: 0 6px;
}
.eksd-tabs-right { margin-left: auto; }

/* Body */
.eksd-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; }
.eksd-section { display: flex; flex-direction: column; }

.eksd-spinner-wrap {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 48px; color: #8b949e; font-size: .9rem;
}
.eksd-spinner {
  width: 28px; height: 28px;
  border: 3px solid #30363d; border-top-color: #58a6ff;
  border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.eksd-error {
  background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.3);
  border-radius: 6px; padding: 12px 16px; color: #f85149; font-size: .85rem;
}
.eksd-notice {
  background: rgba(210,153,34,.08); border: 1px solid rgba(210,153,34,.3);
  border-radius: 6px; padding: 10px 14px; font-size: .8rem; color: #d29922;
  margin-bottom: 12px;
}
.eksd-notice-row { color: #8b949e; margin-top: 4px; word-break: break-word; }
.eksd-empty { text-align: center; color: #8b949e; padding: 32px; font-size: .9rem; }

/* Cards */
.eksd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
.eksd-card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
.eksd-card-title {
  font-size: .8rem; color: #58a6ff; font-weight: 600; margin-bottom: 10px;
  letter-spacing: .03em; text-transform: uppercase;
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
}
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
dt { color: #8b949e; font-size: .8rem; align-self: start; padding-top: 2px; }
dd { color: #e6edf3; font-size: .83rem; margin: 0; word-break: break-word; }
.mono { font-family: monospace; }
.wrap { word-break: break-all; }

.eksd-issues { margin-top: 10px; font-size: .78rem; color: #8b949e; display: flex; flex-direction: column; gap: 4px; }

/* Table */
.eksd-table { width: 100%; border-collapse: collapse; font-size: .8rem; }
.eksd-table th { color: #8b949e; text-align: left; padding: 4px 8px; border-bottom: 1px solid #21262d; white-space: nowrap; }
.eksd-table td { padding: 4px 8px; color: #e6edf3; border-bottom: 1px solid rgba(48,54,61,.5); vertical-align: top; }
.eksd-table tr:last-child td { border-bottom: none; }
.eksd-table td.copyable { display: table-cell; width: auto; }
.eksd-sub { font-size: .72rem; font-family: inherit; }

.eksd-chip {
  display: inline-block; background: rgba(139,148,158,.12); border: 1px solid #30363d;
  border-radius: 4px; padding: 0 6px; font-size: .72rem; font-family: monospace;
  margin: 1px 3px 1px 0; text-transform: none; letter-spacing: 0; font-weight: 400; color: #e6edf3;
}

/* Badges */
.badge-green { background: rgba(63,185,80,.2); color: #3fb950; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-yellow{ background: rgba(210,153,34,.2); color: #d29922; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-red   { background: rgba(248,81,73,.2); color: #f85149; border-radius: 4px; padding: 1px 7px; font-size: .72rem; font-family: monospace; }
.badge-gray  { background: rgba(139,148,158,.15); color: #8b949e; border-radius: 4px; padding: 1px 7px; font-size: .75rem; text-transform: none; letter-spacing: 0; font-weight: 400; }

.text-dim { color: #8b949e; }

/* Buttons */
.btn { background: rgba(88,166,255,.15); border: 1px solid rgba(88,166,255,.4); color: #58a6ff; border-radius: 6px; padding: 4px 12px; font-size: .82rem; cursor: pointer; transition: all .15s; }
.btn:hover { background: rgba(88,166,255,.25); }
.btn.sm { padding: 3px 10px; font-size: .78rem; }

/* Copy buttons */
.copyable { display: inline-flex; align-items: flex-start; gap: 4px; width: 100%; min-width: 0; }
.copy-btn {
  background: none; border: none; color: #8b949e; cursor: pointer;
  font-size: .72rem; padding: 1px 3px; border-radius: 3px; opacity: 0;
  transition: opacity .15s, color .15s; flex-shrink: 0; line-height: 1.5;
}
.copyable:hover .copy-btn { opacity: 1; }
.copy-btn:hover { color: #58a6ff; background: rgba(88,166,255,.12); }

@media (max-width: 768px) {
  .eksd-body { padding: 10px 12px; }
  .eksd-grid { grid-template-columns: 1fr; }
}
</style>
