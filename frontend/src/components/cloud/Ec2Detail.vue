<template>
  <Teleport to="body">
    <div v-if="open" class="ec2d-backdrop" @mousedown.self="$emit('close')">
      <div class="ec2d-modal">

        <!-- Header -->
        <div class="ec2d-header">
          <div class="ec2d-title">
            <span class="ec2d-os-icon">{{ isWindows ? '🪟' : '🐧' }}</span>
            <span>{{ instance?.name || instance?.id }}</span>
            <span class="ec2d-id-badge">{{ instance?.id }}</span>
            <span :class="['ec2d-state', instance?.state]">{{ instance?.state }}</span>
          </div>
          <button class="ec2d-close" @click="$emit('close')">✕</button>
        </div>

        <!-- Tabs -->
        <div class="ec2d-tabs">
          <button v-for="tab in TABS" :key="tab.id"
            :class="['ec2d-tab', { active: activeTab === tab.id }]"
            @click="activeTab = tab.id">
            {{ tab.label }}
          </button>
          <div class="ec2d-tabs-right">
            <button v-if="!loaded && !loading" class="btn sm" @click="load">Cargar detalles</button>
            <button v-else-if="loaded" class="btn sm" @click="load" :disabled="loading" title="Refrescar">↺</button>
          </div>
        </div>

        <!-- Body -->
        <div class="ec2d-body">

          <!-- Loading / Error -->
          <div v-if="loading" class="ec2d-spinner-wrap">
            <div class="ec2d-spinner"></div>
            <span>Cargando detalles...</span>
          </div>
          <div v-else-if="error" class="ec2d-error">{{ error }}</div>

          <template v-else-if="data">

            <!-- ══ DETALLES ══════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'details'" class="ec2d-section">
              <div class="ec2d-grid">
                <div class="ec2d-card">
                  <div class="ec2d-card-title">Instancia</div>
                  <dl>
                    <dt>ID</dt>             <dd class="mono">{{ data.details.id }}</dd>
                    <dt>Nombre</dt>         <dd>{{ data.details.name }}</dd>
                    <dt>Tipo</dt>           <dd class="mono">{{ data.details.type }}</dd>
                    <dt>Estado</dt>
                    <dd><span :class="['ec2d-state', data.details.state]">{{ data.details.state }}</span>
                      <span v-if="data.details.stateReason" class="text-dim" style="font-size:.75rem;margin-left:6px">{{ data.details.stateReason }}</span>
                    </dd>
                    <dt>Lanzamiento</dt>    <dd>{{ fmtDate(data.details.launchTime) }}</dd>
                    <dt>Zona</dt>           <dd class="mono">{{ data.details.az }}</dd>
                    <dt>Tenencia</dt>       <dd>{{ data.details.tenancy }}</dd>
                  </dl>
                </div>

                <div class="ec2d-card">
                  <div class="ec2d-card-title">Imagen y Plataforma</div>
                  <dl>
                    <dt>AMI</dt>            <dd class="mono">{{ data.details.ami }}</dd>
                    <dt>Plataforma</dt>     <dd>{{ data.details.platform }}</dd>
                    <dt>Arquitectura</dt>   <dd class="mono">{{ data.details.architecture }}</dd>
                    <dt>Virtualización</dt> <dd>{{ data.details.virtualizationType }}</dd>
                    <dt>Hypervisor</dt>     <dd>{{ data.details.hypervisor }}</dd>
                    <dt>Disp. raíz</dt>     <dd class="mono">{{ data.details.rootDeviceName }} ({{ data.details.rootDeviceType }})</dd>
                  </dl>
                </div>

                <div class="ec2d-card">
                  <div class="ec2d-card-title">Red y DNS</div>
                  <dl>
                    <dt>IP Pública</dt>     <dd class="mono">{{ data.details.publicIp || '—' }}</dd>
                    <dt>IP Privada</dt>     <dd class="mono">{{ data.details.privateIp || '—' }}</dd>
                    <dt>DNS Público</dt>    <dd class="mono wrap">{{ data.details.publicDns || '—' }}</dd>
                    <dt>DNS Privado</dt>    <dd class="mono wrap">{{ data.details.privateDns || '—' }}</dd>
                  </dl>
                </div>

                <div class="ec2d-card">
                  <div class="ec2d-card-title">IAM y acceso</div>
                  <dl>
                    <dt>Key Pair</dt>       <dd class="mono">{{ data.details.keyPair || '—' }}</dd>
                    <dt>Perfil IAM</dt>     <dd class="mono wrap">{{ data.details.iamProfile || '—' }}</dd>
                    <dt>EBS Optimizado</dt> <dd>{{ data.details.ebsOptimized ? 'Sí' : 'No' }}</dd>
                    <dt>ENA</dt>            <dd>{{ data.details.enaSupport ? 'Habilitado' : 'Deshabilitado' }}</dd>
                    <dt>Monitoreo CW</dt>   <dd>{{ data.details.monitoring || '—' }}</dd>
                  </dl>
                </div>

                <div class="ec2d-card">
                  <div class="ec2d-card-title">Status Checks</div>
                  <dl>
                    <dt>Sistema</dt>
                    <dd><span :class="statusCheckClass(data.details.systemStatus)">{{ data.details.systemStatus }}</span></dd>
                    <dt>Instancia</dt>
                    <dd><span :class="statusCheckClass(data.details.instanceStatus)">{{ data.details.instanceStatus }}</span></dd>
                  </dl>
                </div>
              </div>

              <!-- Tags -->
              <div class="ec2d-card" style="margin-top:12px">
                <div class="ec2d-card-title">Tags ({{ data.details.tags.length }})</div>
                <table class="ec2d-table" v-if="data.details.tags.length">
                  <thead><tr><th>Clave</th><th>Valor</th></tr></thead>
                  <tbody>
                    <tr v-for="t in data.details.tags" :key="t.Key">
                      <td class="mono">{{ t.Key }}</td>
                      <td class="mono">{{ t.Value }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="text-dim" style="font-size:.82rem">Sin tags.</div>
              </div>
            </div>

            <!-- ══ MONITOREO ════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'monitoring'" class="ec2d-section">
              <div class="ec2d-notice" v-if="!data.monitoring.cwEnabled">
                <strong>ℹ</strong> Monitoreo detallado de CloudWatch no está habilitado en esta instancia.
                Los datos mostrados son del monitoreo básico (resolución 5 min).
              </div>
              <div class="ec2d-metrics-grid">
                <div v-for="m in metricCards" :key="m.key" class="ec2d-metric-card">
                  <div class="ec2d-metric-title">{{ m.label }}</div>
                  <div class="ec2d-metric-last" :class="{ dim: !lastVal(m.key) }">
                    {{ fmtMetric(lastVal(m.key), m.unit) }}
                  </div>
                  <div class="ec2d-sparkline-wrap">
                    <svg class="ec2d-sparkline" viewBox="0 0 200 40" preserveAspectRatio="none">
                      <polyline v-if="sparkPoints(m.key)" :points="sparkPoints(m.key)" fill="none" stroke="#58a6ff" stroke-width="1.5"/>
                    </svg>
                  </div>
                  <div class="ec2d-metric-range">Últimas 3 h</div>
                </div>
              </div>
              <div v-if="!hasAnyMetric" class="text-dim" style="text-align:center;padding:32px">
                Sin datos de CloudWatch en las últimas 3 horas (puede que la instancia esté detenida).
              </div>
            </div>

            <!-- ══ SEGURIDAD ════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'security'" class="ec2d-section">
              <!-- IMDSv2 -->
              <div class="ec2d-card" style="margin-bottom:12px">
                <div class="ec2d-card-title">Metadata (IMDS)</div>
                <dl>
                  <dt>HTTP Tokens</dt>
                  <dd>
                    <span :class="data.security.metadataOptions.httpTokens === 'required' ? 'badge-green' : 'badge-yellow'">
                      {{ data.security.metadataOptions.httpTokens || '—' }}
                    </span>
                    <span v-if="data.security.metadataOptions.httpTokens !== 'required'" class="text-dim" style="font-size:.75rem;margin-left:6px">
                      (IMDSv1 habilitado — considere IMDSv2)
                    </span>
                  </dd>
                  <dt>Endpoint</dt>     <dd>{{ data.security.metadataOptions.httpEndpoint }}</dd>
                  <dt>Hop limit</dt>    <dd>{{ data.security.metadataOptions.httpPutHopLimit }}</dd>
                  <dt>Tags en IMDS</dt> <dd>{{ data.security.metadataOptions.instanceMetadataTags || '—' }}</dd>
                  <dt>Perfil IAM</dt>   <dd class="mono wrap">{{ data.security.iamProfile || '—' }}</dd>
                </dl>
              </div>

              <!-- Security Groups -->
              <div v-for="sg in data.security.securityGroups" :key="sg.id" class="ec2d-card" style="margin-bottom:12px">
                <div class="ec2d-card-title">
                  🔒 {{ sg.name }}
                  <span class="text-dim mono-xs" style="margin-left:6px">{{ sg.id }}</span>
                  <span class="text-dim" style="margin-left:6px;font-size:.75rem">{{ sg.description }}</span>
                </div>

                <div class="ec2d-sg-section">
                  <div class="ec2d-sg-label">Entrada ({{ sg.inbound.length }})</div>
                  <table class="ec2d-table" v-if="sg.inbound.length">
                    <thead><tr><th>Protocolo</th><th>Puertos</th><th>Origen</th></tr></thead>
                    <tbody>
                      <tr v-for="(r, ri) in sg.inbound" :key="ri">
                        <td class="mono">{{ r.protocol }}</td>
                        <td class="mono">{{ fmtPortRange(r) }}</td>
                        <td>
                          <span v-for="s in r.sources" :key="s.cidr || s.sg" class="ec2d-src-chip">
                            {{ s.cidr || s.sg }}<span v-if="s.desc" class="text-dim"> ({{ s.desc }})</span>
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-dim" style="font-size:.8rem">Sin reglas de entrada.</div>
                </div>

                <div class="ec2d-sg-section" style="margin-top:10px">
                  <div class="ec2d-sg-label">Salida ({{ sg.outbound.length }})</div>
                  <table class="ec2d-table" v-if="sg.outbound.length">
                    <thead><tr><th>Protocolo</th><th>Puertos</th><th>Destino</th></tr></thead>
                    <tbody>
                      <tr v-for="(r, ri) in sg.outbound" :key="ri">
                        <td class="mono">{{ r.protocol }}</td>
                        <td class="mono">{{ fmtPortRange(r) }}</td>
                        <td>
                          <span v-for="s in r.sources" :key="s.cidr || s.sg" class="ec2d-src-chip">
                            {{ s.cidr || s.sg }}<span v-if="s.desc" class="text-dim"> ({{ s.desc }})</span>
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="text-dim" style="font-size:.8rem">Sin reglas de salida.</div>
                </div>
              </div>

              <div v-if="!data.security.securityGroups.length" class="text-dim" style="text-align:center;padding:24px">
                Sin security groups asociados.
              </div>
            </div>

            <!-- ══ REDES ════════════════════════════════════════════════════ -->
            <div v-show="activeTab === 'networking'" class="ec2d-section">
              <div class="ec2d-card" style="margin-bottom:12px">
                <div class="ec2d-card-title">VPC y Subnet</div>
                <dl>
                  <dt>VPC</dt>         <dd class="mono">{{ data.networking.vpcId || '—' }}</dd>
                  <dt>Subnet</dt>      <dd class="mono">{{ data.networking.subnetId || '—' }}</dd>
                  <dt>Source/Dest</dt> <dd>{{ data.networking.sourceDestCheck ? 'Habilitado' : 'Deshabilitado' }}</dd>
                </dl>
              </div>

              <div v-for="ni in data.networking.interfaces" :key="ni.id" class="ec2d-card" style="margin-bottom:12px">
                <div class="ec2d-card-title">
                  🌐 Interfaz {{ ni.id }}
                  <span class="text-dim mono-xs" style="margin-left:6px">{{ ni.macAddress }}</span>
                  <span :class="['ec2d-ni-status', ni.status === 'in-use' ? 'ok' : 'dim']">{{ ni.status }}</span>
                </div>
                <dl>
                  <dt>IP Privada</dt>  <dd class="mono">{{ ni.privateIp }}</dd>
                  <dt>DNS Privado</dt> <dd class="mono wrap">{{ ni.privateDns || '—' }}</dd>
                  <dt>IP Pública</dt>  <dd class="mono">{{ ni.publicIp || '—' }}</dd>
                  <dt>DNS Público</dt> <dd class="mono wrap">{{ ni.publicDns || '—' }}</dd>
                  <dt>Subnet</dt>      <dd class="mono">{{ ni.subnetId }}</dd>
                  <dt>VPC</dt>         <dd class="mono">{{ ni.vpcId }}</dd>
                  <dt>Descripción</dt> <dd>{{ ni.description || '—' }}</dd>
                  <dt>Src/Dest</dt>    <dd>{{ ni.sourceDest ? 'Habilitado' : 'Deshabilitado' }}</dd>
                  <dt>Groups</dt>
                  <dd>
                    <span v-for="g in ni.groups" :key="g.id" class="ec2d-src-chip">{{ g.name }} <span class="text-dim">({{ g.id }})</span></span>
                  </dd>
                </dl>
              </div>

              <div v-if="!data.networking.interfaces.length" class="text-dim" style="text-align:center;padding:24px">
                Sin interfaces de red.
              </div>
            </div>

            <!-- ══ ALMACENAMIENTO ══════════════════════════════════════════ -->
            <div v-show="activeTab === 'storage'" class="ec2d-section">
              <div class="ec2d-card" style="margin-bottom:8px">
                <div class="ec2d-card-title">Dispositivo raíz: <span class="mono">{{ data.storage.rootDevice }}</span></div>
              </div>
              <div v-for="vol in data.storage.volumes" :key="vol.id" class="ec2d-card" style="margin-bottom:12px">
                <div class="ec2d-card-title">
                  💾 {{ vol.id }}
                  <span class="text-dim mono-xs" style="margin-left:6px">{{ vol.device }}</span>
                  <span :class="['ec2d-vol-state', vol.state]">{{ vol.state }}</span>
                </div>
                <dl>
                  <dt>Tamaño</dt>       <dd>{{ vol.size }} GiB</dd>
                  <dt>Tipo</dt>         <dd class="mono">{{ vol.type }}</dd>
                  <dt>IOPS</dt>         <dd>{{ vol.iops ?? '—' }}</dd>
                  <dt>Throughput</dt>   <dd>{{ vol.throughput ? vol.throughput + ' MB/s' : '—' }}</dd>
                  <dt>Cifrado</dt>      <dd>{{ vol.encrypted ? '✓ Sí' : '✗ No' }}</dd>
                  <dt>KMS Key</dt>      <dd class="mono wrap">{{ vol.kmsKeyId || '—' }}</dd>
                  <dt>Snapshot</dt>     <dd class="mono">{{ vol.snapshotId || '—' }}</dd>
                  <dt>Zona</dt>         <dd class="mono">{{ vol.az }}</dd>
                  <dt>Multi-Attach</dt> <dd>{{ vol.multiAttach ? 'Sí' : 'No' }}</dd>
                  <dt>Delete-on-term</dt><dd>{{ vol.deleteOnTermination ? 'Sí' : 'No' }}</dd>
                  <dt>Creado</dt>       <dd>{{ fmtDate(vol.createTime) }}</dd>
                </dl>
              </div>

              <div v-if="!data.storage.volumes.length" class="text-dim" style="text-align:center;padding:24px">
                Sin volúmenes adjuntos.
              </div>
            </div>

          </template>

          <!-- Empty state -->
          <div v-else class="ec2d-empty">
            Haz clic en <strong>Cargar detalles</strong> para obtener la información completa de la instancia.
          </div>

        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  open:     { type: Boolean, default: false },
  instance: { type: Object,  default: null  },
  profileId:{ type: String,  default: ''    },
})
defineEmits(['close'])

const TABS = [
  { id: 'details',    label: '📋 Detalles'       },
  { id: 'monitoring', label: '📊 Monitoreo'      },
  { id: 'security',   label: '🔒 Seguridad'      },
  { id: 'networking', label: '🌐 Redes'           },
  { id: 'storage',    label: '💾 Almacenamiento'  },
]

const activeTab = ref('details')
const data      = ref(null)
const loading   = ref(false)
const loaded    = ref(false)
const error     = ref('')

const isWindows = computed(() => props.instance?.platform === 'windows')

watch(() => props.open, val => {
  if (val) {
    activeTab.value = 'details'
    data.value  = null
    loaded.value = false
    error.value = ''
    load()
  }
})

async function load() {
  if (!props.instance?.id) return
  loading.value = true
  error.value   = ''
  try {
    const pid = props.profileId || ''
    const res = await fetch(`/api/cloud/aws/ec2/${props.instance.id}/details`, {
      headers: pid ? { 'x-profile-id': pid } : {},
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    data.value  = await res.json()
    loaded.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtPortRange(r) {
  if (r.protocol === 'All' || r.fromPort == null) return 'Todos'
  if (r.fromPort === r.toPort) return String(r.fromPort)
  return `${r.fromPort}–${r.toPort}`
}

function statusCheckClass(s) {
  return s === 'ok' ? 'badge-green' : s === 'impaired' ? 'badge-red' : 'badge-gray'
}

// ── Metrics helpers ──────────────────────────────────────────────────────────
const metricCards = [
  { key: 'CPUUtilization', label: 'CPU',          unit: '%'  },
  { key: 'NetworkIn',      label: 'Red Entrada',  unit: 'B'  },
  { key: 'NetworkOut',     label: 'Red Salida',   unit: 'B'  },
  { key: 'DiskReadBytes',  label: 'Disco Lectura',unit: 'B'  },
  { key: 'DiskWriteBytes', label: 'Disco Escritura', unit: 'B' },
  { key: 'StatusCheckFailed', label: 'Status Checks', unit: '' },
]

function lastVal(key) {
  const pts = data.value?.monitoring?.metrics?.[key]
  if (!pts?.length) return null
  return pts[pts.length - 1].v
}

function fmtMetric(v, unit) {
  if (v === null || v === undefined) return '—'
  if (unit === '%') return v.toFixed(1) + ' %'
  if (unit === 'B') {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' GB'
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' MB'
    if (v >= 1e3) return (v / 1e3).toFixed(1) + ' KB'
    return v.toFixed(0) + ' B'
  }
  return String(v)
}

function sparkPoints(key) {
  const pts = data.value?.monitoring?.metrics?.[key]
  if (!pts?.length) return null
  const vals = pts.map(p => p.v)
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const rng  = max - min || 1
  const w    = 200 / (pts.length - 1 || 1)
  return pts.map((p, i) => `${i * w},${40 - ((p.v - min) / rng) * 36}`).join(' ')
}

const hasAnyMetric = computed(() => {
  const m = data.value?.monitoring?.metrics
  if (!m) return false
  return Object.values(m).some(pts => pts.length > 0)
})
</script>

<style scoped>
.ec2d-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 800;
}
.ec2d-modal {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 10px;
  width: min(98vw, 940px);
  max-height: 90vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,.7);
}

/* Header */
.ec2d-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  flex-shrink: 0; gap: 8px;
}
.ec2d-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; color: #e6edf3; font-size: .95rem;
}
.ec2d-os-icon { font-size: 1.1rem; }
.ec2d-id-badge {
  background: rgba(88,166,255,.15); color: #58a6ff;
  border: 1px solid rgba(88,166,255,.3);
  border-radius: 4px; padding: 1px 7px;
  font-size: .75rem; font-family: monospace;
}
.ec2d-state {
  font-size: .75rem; padding: 2px 8px; border-radius: 12px; font-weight: 500;
}
.ec2d-state.running  { background: rgba(63,185,80,.2);  color: #3fb950; }
.ec2d-state.stopped  { background: rgba(248,81,73,.2);  color: #f85149; }
.ec2d-state.stopping,.ec2d-state.pending { background: rgba(210,153,34,.2); color: #d29922; }
.ec2d-close {
  background: none; border: none; color: #8b949e;
  cursor: pointer; font-size: 1rem; padding: 2px 5px; border-radius: 4px;
}
.ec2d-close:hover { color: #e6edf3; background: rgba(255,255,255,.1); }

/* Tabs */
.ec2d-tabs {
  display: flex; align-items: center;
  background: #161b22;
  border-bottom: 1px solid #21262d;
  padding: 0 8px; gap: 2px;
  flex-shrink: 0;
}
.ec2d-tab {
  background: none; border: none;
  color: #8b949e; cursor: pointer;
  padding: 8px 13px; font-size: .82rem;
  border-bottom: 2px solid transparent;
  transition: all .15s;
}
.ec2d-tab:hover { color: #e6edf3; }
.ec2d-tab.active { color: #58a6ff; border-bottom-color: #388bfd; }
.ec2d-tabs-right { margin-left: auto; }

/* Body */
.ec2d-body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
.ec2d-section { display: flex; flex-direction: column; }

.ec2d-spinner-wrap {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px; padding: 48px;
  color: #8b949e; font-size: .9rem;
}
.ec2d-spinner {
  width: 28px; height: 28px;
  border: 3px solid #30363d;
  border-top-color: #58a6ff;
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.ec2d-error {
  background: rgba(248,81,73,.1);
  border: 1px solid rgba(248,81,73,.3);
  border-radius: 6px; padding: 12px 16px;
  color: #f85149; font-size: .85rem;
}
.ec2d-empty {
  text-align: center; color: #8b949e;
  padding: 40px; font-size: .9rem;
}
.ec2d-notice {
  background: rgba(88,166,255,.08);
  border: 1px solid rgba(88,166,255,.2);
  border-radius: 6px; padding: 10px 14px;
  font-size: .82rem; color: #8b949e;
  margin-bottom: 14px;
}

/* Cards grid */
.ec2d-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
.ec2d-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 12px 14px;
}
.ec2d-card-title {
  font-size: .8rem; color: #58a6ff;
  font-weight: 600; margin-bottom: 10px;
  letter-spacing: .03em; text-transform: uppercase;
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
}
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; }
dt { color: #8b949e; font-size: .8rem; align-self: start; padding-top: 2px; }
dd { color: #e6edf3; font-size: .83rem; margin: 0; word-break: break-word; }
dd.mono { font-family: monospace; }
dd.wrap { word-break: break-all; }

/* Table */
.ec2d-table {
  width: 100%;
  border-collapse: collapse;
  font-size: .8rem;
}
.ec2d-table th {
  color: #8b949e; text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid #21262d;
}
.ec2d-table td {
  padding: 4px 8px; color: #e6edf3;
  border-bottom: 1px solid rgba(48,54,61,.5);
}
.ec2d-table tr:last-child td { border-bottom: none; }
.ec2d-table .mono { font-family: monospace; }

/* SG rules */
.ec2d-sg-label { font-size: .75rem; color: #8b949e; margin-bottom: 4px; }
.ec2d-src-chip {
  display: inline-block;
  background: rgba(139,148,158,.12);
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: .75rem; font-family: monospace;
  margin: 2px 2px 2px 0;
}

/* Metrics */
.ec2d-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.ec2d-metric-card {
  background: #161b22;
  border: 1px solid #21262d;
  border-radius: 8px;
  padding: 12px 14px;
}
.ec2d-metric-title { font-size: .8rem; color: #8b949e; margin-bottom: 6px; }
.ec2d-metric-last  { font-size: 1.4rem; font-weight: 600; color: #e6edf3; }
.ec2d-metric-last.dim { color: #8b949e; font-size: 1rem; }
.ec2d-sparkline-wrap { margin-top: 8px; }
.ec2d-sparkline { width: 100%; height: 40px; }
.ec2d-metric-range { font-size: .72rem; color: #8b949e; margin-top: 4px; }

/* Network interface status */
.ec2d-ni-status { font-size: .72rem; padding: 1px 6px; border-radius: 10px; margin-left: 6px; }
.ec2d-ni-status.ok  { background: rgba(63,185,80,.2); color: #3fb950; }
.ec2d-ni-status.dim { background: rgba(139,148,158,.15); color: #8b949e; }

/* Volume state */
.ec2d-vol-state { font-size: .72rem; padding: 1px 6px; border-radius: 10px; margin-left: 6px; }
.ec2d-vol-state.in-use   { background: rgba(63,185,80,.2); color: #3fb950; }
.ec2d-vol-state.available{ background: rgba(88,166,255,.15); color: #58a6ff; }
.ec2d-vol-state.deleting { background: rgba(248,81,73,.2); color: #f85149; }

/* Badges */
.badge-green { background: rgba(63,185,80,.2); color: #3fb950; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-yellow{ background: rgba(210,153,34,.2); color: #d29922; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-red   { background: rgba(248,81,73,.2); color: #f85149; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }
.badge-gray  { background: rgba(139,148,158,.15); color: #8b949e; border-radius: 4px; padding: 1px 7px; font-size: .75rem; }

.text-dim  { color: #8b949e; }
.mono-xs   { font-family: monospace; font-size: .75rem; }

/* Buttons */
.btn { background: rgba(88,166,255,.15); border: 1px solid rgba(88,166,255,.4); color: #58a6ff; border-radius: 6px; padding: 4px 12px; font-size: .82rem; cursor: pointer; transition: all .15s; }
.btn:hover { background: rgba(88,166,255,.25); }
.btn.sm { padding: 3px 10px; font-size: .78rem; }
</style>
