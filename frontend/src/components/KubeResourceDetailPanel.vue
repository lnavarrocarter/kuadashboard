<template>
  <aside class="kube-detail-panel">
    <header class="kdp-header">
      <div class="kdp-title">
        <span class="kdp-kind">{{ kindLabel }}</span>
        <strong :title="resource?.name">{{ resource?.name }}</strong>
      </div>
      <button class="btn btn-icon" title="Cerrar" @click="$emit('close')"><i data-lucide="x"></i></button>
    </header>

    <div class="kdp-tabs">
      <button :class="['kdp-tab', { active: tab === 'overview' }]" @click="tab = 'overview'"><i data-lucide="layout-list"></i> Resumen</button>
      <button :class="['kdp-tab', { active: tab === 'yaml' }]" @click="tab = 'yaml'"><i data-lucide="braces"></i> YAML</button>
      <button :class="['kdp-tab', { active: tab === 'metrics' }]" @click="tab = 'metrics'"><i data-lucide="activity"></i> Metricas</button>
    </div>

    <section v-if="tab === 'overview'" class="kdp-body">
      <div v-if="loading" class="kdp-empty">Cargando detalle...</div>
      <div v-else-if="error" class="kdp-alert error"><i data-lucide="alert-triangle"></i>{{ error }}</div>
      <template v-else>
        <div class="kdp-section">
          <h3>Propiedades</h3>
          <dl class="kdp-props">
            <div v-for="item in properties" :key="item.label" class="kdp-prop-row">
              <dt>{{ item.label }}</dt>
              <dd :title="String(item.value || '-')">{{ item.value || '-' }}</dd>
            </div>
          </dl>
        </div>
        <div v-if="labels.length" class="kdp-section">
          <h3>Labels</h3>
          <div class="kdp-chips">
            <span v-for="label in labels" :key="label" class="kdp-chip">{{ label }}</span>
          </div>
        </div>
        <div v-for="section in detailSections" :key="section.title" class="kdp-section">
          <h3>{{ section.title }}</h3>
          <dl v-if="section.rows?.length" class="kdp-props compact">
            <div v-for="item in section.rows" :key="item.label" class="kdp-prop-row">
              <dt>{{ item.label }}</dt>
              <dd :title="String(item.value || '-')">{{ item.value || '-' }}</dd>
            </div>
          </dl>
          <div v-if="section.chips?.length" class="kdp-chips">
            <span v-for="chip in section.chips" :key="chip" class="kdp-chip">{{ chip }}</span>
          </div>
          <div v-if="section.items?.length" class="kdp-list">
            <div v-for="item in section.items" :key="item.title + item.subtitle" class="kdp-list-item">
              <span>{{ item.title }}</span>
              <small>{{ item.subtitle || '-' }}</small>
            </div>
          </div>
        </div>
        <div v-if="containers.length" class="kdp-section">
          <h3>Contenedores</h3>
          <div class="kdp-list">
            <div v-for="container in containers" :key="container.name" class="kdp-list-item">
              <span>{{ container.name }}</span>
              <small>{{ container.image || '-' }}</small>
            </div>
          </div>
        </div>
      </template>
    </section>

    <section v-else-if="tab === 'yaml'" class="kdp-body">
      <div v-if="loading" class="kdp-empty">Cargando YAML...</div>
      <div v-else-if="error" class="kdp-alert error"><i data-lucide="alert-triangle"></i>{{ error }}</div>
      <div v-else class="kdp-yaml-tree">
        <div v-for="line in yamlTreeLines" :key="line.key" class="kdp-yaml-line" :style="{ paddingLeft: `${line.depth * 14 + 8}px` }">
          <span class="kdp-yaml-key">{{ line.name }}</span>
          <span v-if="line.value !== undefined" class="kdp-yaml-value">{{ line.value }}</span>
        </div>
      </div>
    </section>

    <section v-else class="kdp-body">
      <template v-if="isPodLike">
        <div v-if="metricsLoading" class="kdp-empty">Cargando metricas...</div>
        <div v-else-if="metrics" class="kdp-section">
          <h3>Consumo actual</h3>
          <div :class="['kdp-prom-status', prometheus?.available ? 'ok' : 'warn']">
            <i :data-lucide="prometheus?.available ? 'check-circle-2' : 'circle-dashed'"></i>
            <span>{{ prometheusLabel }}</span>
          </div>
          <div class="kdp-metric-grid">
            <div class="kdp-meter">
              <span>CPU</span>
              <strong>{{ metrics.cpu.display }}</strong>
              <div class="kdp-bar"><span :style="{ width: `${metrics.cpu.percent}%` }"></span></div>
            </div>
            <div class="kdp-meter">
              <span>Memoria</span>
              <strong>{{ metrics.memory.display }}</strong>
              <div class="kdp-bar memory"><span :style="{ width: `${metrics.memory.percent}%` }"></span></div>
            </div>
          </div>
          <p class="kdp-muted">Fuente: Kubernetes Metrics API (<code>metrics.k8s.io</code>).</p>
        </div>
        <div v-else class="kdp-alert warn">
          <i data-lucide="info"></i>
          <div>
            <strong>Metricas no disponibles</strong>
            <p>{{ metricsError || 'No se pudo consultar metrics.k8s.io en el cluster.' }}</p>
            <p>{{ prometheusLabel }} Instala Metrics Server o integra Prometheus para historicos y graficas completas.</p>
            <button class="btn sm primary" @click="$emit('open-helm')"><i data-lucide="package-plus"></i> Abrir Helm</button>
          </div>
        </div>
      </template>
      <div v-else class="kdp-alert warn">
        <i data-lucide="info"></i>
        <div>
          <p>Las metricas visuales estan disponibles para Pods. Para {{ kindLabel }}, abre el Pod asociado o integra Prometheus desde Helm.</p>
          <p>{{ prometheusLabel }}</p>
          <button class="btn sm primary" @click="$emit('open-helm')"><i data-lucide="package-plus"></i> Abrir Helm</button>
        </div>
      </div>
    </section>
  </aside>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import yaml from 'js-yaml'
import { api } from '../composables/useApi'

const props = defineProps({
  resourceType: { type: String, required: true },
  resource: { type: Object, required: true },
})
defineEmits(['close', 'open-helm'])

const tab = ref('overview')
const loading = ref(false)
const error = ref('')
const yamlText = ref('')
const yamlObject = ref(null)
const metrics = ref(null)
const metricsError = ref('')
const metricsLoading = ref(false)
const prometheus = ref(null)

const kindLabel = computed(() => props.resourceType === 'pvcs' ? 'PersistentVolumeClaim' : singularTitle(props.resourceType))
const isPodLike = computed(() => props.resourceType === 'pods')
const metadata = computed(() => yamlObject.value?.metadata || {})
const spec = computed(() => yamlObject.value?.spec || {})
const status = computed(() => yamlObject.value?.status || {})
const labels = computed(() => Object.entries(metadata.value.labels || {}).map(([key, value]) => `${key}=${value}`))
const containers = computed(() => spec.value.containers || spec.value.template?.spec?.containers || [])
const properties = computed(() => baseProperties())
const ownerText = computed(() => (metadata.value.ownerReferences || []).map(o => `${o.kind}/${o.name}`).join(', '))
const yamlTreeLines = computed(() => flattenYaml(yamlObject.value))
const detailSections = computed(() => resourceSections())
const prometheusLabel = computed(() => {
  if (!prometheus.value) return 'Prometheus no verificado.'
  if (!prometheus.value.available) return 'No se detecto Prometheus en los Services del cluster.'
  const svc = prometheus.value.services?.[0]
  return `Prometheus detectado: ${svc.namespace}/${svc.name}.`
})

watch(() => [props.resourceType, props.resource?.name, props.resource?.namespace], () => loadDetail(), { immediate: true })
watch(tab, () => nextTick(() => createIcons({ icons })))

async function loadDetail() {
  if (!props.resource?.name) return
  tab.value = 'overview'
  loading.value = true
  error.value = ''
  yamlText.value = ''
  yamlObject.value = null
  metrics.value = null
  metricsError.value = ''
  prometheus.value = null
  try {
    const url = props.resourceType === 'nodes'
      ? `/api/nodes/${encodeURIComponent(props.resource.name)}/yaml`
      : `/api/${encodeURIComponent(props.resource.namespace)}/${props.resourceType}/${encodeURIComponent(props.resource.name)}/yaml`
    yamlText.value = await api('GET', url)
    yamlObject.value = yaml.load(yamlText.value)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
  if (props.resourceType === 'pods') loadMetrics()
  loadPrometheusStatus()
}

async function loadPrometheusStatus() {
  try {
    prometheus.value = await api('GET', '/api/monitoring/prometheus/status')
  } catch (_) {
    prometheus.value = { available: false, services: [] }
  } finally {
    nextTick(() => createIcons({ icons }))
  }
}

async function loadMetrics() {
  metricsLoading.value = true
  metricsError.value = ''
  metrics.value = null
  try {
    metrics.value = await api('GET', `/api/${encodeURIComponent(props.resource.namespace)}/pods/${encodeURIComponent(props.resource.name)}/metrics`)
  } catch (e) {
    metricsError.value = e.message
  } finally {
    metricsLoading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function singularTitle(type) {
  return ({ pods: 'Pod', deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet', services: 'Service', ingresses: 'Ingress', configmaps: 'ConfigMap', secrets: 'Secret', nodes: 'Node', events: 'Event' })[type] || type
}

function baseProperties() {
  return compactRows([
    row('Nombre', metadata.value.name || props.resource.name),
    row('Namespace', metadata.value.namespace || props.resource.namespace),
    row('Estado', status.value.phase || props.resource.status || props.resource.ready),
    row('Creado', metadata.value.creationTimestamp ? new Date(metadata.value.creationTimestamp).toLocaleString() : props.resource.age),
    row('UID', metadata.value.uid),
    row('Version', metadata.value.resourceVersion),
    row('Owner', ownerText.value),
  ])
}

function resourceSections() {
  const type = props.resourceType
  if (type === 'pods') return podSections()
  if (['deployments', 'statefulsets', 'daemonsets'].includes(type)) return workloadSections(type)
  if (type === 'services') return serviceSections()
  if (type === 'ingresses') return ingressSections()
  if (type === 'configmaps') return dataObjectSections('Datos', yamlObject.value?.data, yamlObject.value?.binaryData)
  if (type === 'secrets') return secretSections()
  if (type === 'pvcs') return pvcSections()
  if (type === 'nodes') return nodeSections()
  if (type === 'events') return eventSections()
  return []
}

function podSections() {
  return [
    {
      title: 'Ejecucion',
      rows: compactRows([
        row('Pod IP', status.value.podIP), row('Host IP', status.value.hostIP), row('Nodo', spec.value.nodeName),
        row('Service Account', spec.value.serviceAccountName), row('QoS', status.value.qosClass), row('Reinicios', podRestartCount()),
        row('Restart Policy', spec.value.restartPolicy), row('DNS Policy', spec.value.dnsPolicy), row('Prioridad', spec.value.priorityClassName || spec.value.priority),
      ]),
    },
    { title: 'Condiciones', items: conditionItems(status.value.conditions) },
    { title: 'Volumenes', items: volumeItems(spec.value.volumes) },
    { title: 'Red', rows: compactRows([row('Host Network', spec.value.hostNetwork), row('DNS Config', spec.value.dnsConfig ? 'Configurado' : ''), row('Subdomain', spec.value.subdomain)]) },
  ].filter(sectionHasContent)
}

function workloadSections(type) {
  const template = spec.value.template || {}
  return [
    {
      title: 'Replicas',
      rows: compactRows([
        row('Deseadas', spec.value.replicas ?? (type === 'daemonsets' ? status.value.desiredNumberScheduled : undefined)),
        row('Listas', status.value.readyReplicas ?? status.value.numberReady),
        row('Disponibles', status.value.availableReplicas ?? status.value.numberAvailable),
        row('Actualizadas', status.value.updatedReplicas ?? status.value.updatedNumberScheduled),
        row('Observada', status.value.observedGeneration),
      ]),
    },
    { title: 'Selector', chips: selectorChips(spec.value.selector) },
    {
      title: 'Estrategia',
      rows: compactRows([
        row('Tipo', spec.value.strategy?.type || spec.value.updateStrategy?.type),
        row('Max Surge', spec.value.strategy?.rollingUpdate?.maxSurge),
        row('Max Unavailable', spec.value.strategy?.rollingUpdate?.maxUnavailable || spec.value.updateStrategy?.rollingUpdate?.maxUnavailable),
        row('Service Name', spec.value.serviceName),
        row('Revision History', spec.value.revisionHistoryLimit),
      ]),
    },
    { title: 'Template', chips: objectChips(template.metadata?.labels), items: containerItems(template.spec?.containers) },
    { title: 'Condiciones', items: conditionItems(status.value.conditions) },
  ].filter(sectionHasContent)
}

function serviceSections() {
  return [
    {
      title: 'Red',
      rows: compactRows([
        row('Tipo', spec.value.type), row('Cluster IP', spec.value.clusterIP), row('Cluster IPs', spec.value.clusterIPs?.join(', ')),
        row('External IPs', spec.value.externalIPs?.join(', ')), row('LoadBalancer', loadBalancerText()), row('Session Affinity', spec.value.sessionAffinity),
        row('IP Families', spec.value.ipFamilies?.join(', ')), row('Traffic Policy', spec.value.externalTrafficPolicy),
      ]),
    },
    { title: 'Selector', chips: objectChips(spec.value.selector) },
    { title: 'Puertos', items: (spec.value.ports || []).map(port => ({ title: `${port.name || port.port} ${port.protocol || 'TCP'}`, subtitle: `${port.port} -> ${port.targetPort || port.port}${port.nodePort ? ` | node ${port.nodePort}` : ''}` })) },
  ].filter(sectionHasContent)
}

function ingressSections() {
  return [
    { title: 'Entrada', rows: compactRows([row('Clase', spec.value.ingressClassName), row('TLS', spec.value.tls?.length ? `${spec.value.tls.length} secreto(s)` : 'No'), row('LoadBalancer', loadBalancerText())]) },
    { title: 'Reglas', items: (spec.value.rules || []).flatMap(rule => (rule.http?.paths || []).map(path => ({ title: `${rule.host || '*'}${path.path || '/'}`, subtitle: `${path.pathType || 'Prefix'} -> ${backendText(path.backend)}` }))) },
    { title: 'TLS', items: (spec.value.tls || []).map(tls => ({ title: tls.secretName || 'Sin secreto', subtitle: (tls.hosts || []).join(', ') || '-' })) },
  ].filter(sectionHasContent)
}

function dataObjectSections(title, data = {}, binaryData = {}) {
  const items = Object.entries(data || {}).map(([key, value]) => ({ title: key, subtitle: `${String(value ?? '').length} caracteres` }))
  const binaryItems = Object.keys(binaryData || {}).map(key => ({ title: key, subtitle: 'binaryData' }))
  return [{ title, items: [...items, ...binaryItems] }].filter(sectionHasContent)
}

function secretSections() {
  return [
    { title: 'Secreto', rows: compactRows([row('Tipo', yamlObject.value?.type), row('Immutable', yamlObject.value?.immutable), row('Llaves', Object.keys(yamlObject.value?.data || {}).length)]) },
    { title: 'Data', items: Object.keys(yamlObject.value?.data || {}).map(key => ({ title: key, subtitle: 'Valor redactado' })) },
  ].filter(sectionHasContent)
}

function pvcSections() {
  return [
    {
      title: 'Almacenamiento',
      rows: compactRows([
        row('Estado', status.value.phase), row('StorageClass', spec.value.storageClassName), row('Volumen', spec.value.volumeName),
        row('Capacidad', status.value.capacity?.storage), row('Solicitado', spec.value.resources?.requests?.storage), row('Access Modes', (spec.value.accessModes || []).join(', ')),
        row('Volume Mode', spec.value.volumeMode),
      ]),
    },
    { title: 'Condiciones', items: conditionItems(status.value.conditions) },
  ].filter(sectionHasContent)
}

function nodeSections() {
  const nodeInfo = status.value.nodeInfo || {}
  return [
    { title: 'Sistema', rows: compactRows([row('Roles', nodeRoles()), row('Schedulable', spec.value.unschedulable ? 'No' : 'Si'), row('Kubelet', nodeInfo.kubeletVersion), row('Runtime', nodeInfo.containerRuntimeVersion), row('OS', nodeInfo.osImage), row('Kernel', nodeInfo.kernelVersion), row('Arquitectura', nodeInfo.architecture)]) },
    { title: 'Capacidad', rows: resourceRows(status.value.capacity) },
    { title: 'Allocatable', rows: resourceRows(status.value.allocatable) },
    { title: 'Condiciones', items: conditionItems(status.value.conditions) },
    { title: 'Taints', items: (spec.value.taints || []).map(t => ({ title: `${t.key}${t.value ? `=${t.value}` : ''}`, subtitle: t.effect })) },
  ].filter(sectionHasContent)
}

function eventSections() {
  return [{
    title: 'Evento',
    rows: compactRows([
      row('Tipo', yamlObject.value?.type), row('Reason', yamlObject.value?.reason), row('Objeto', involvedObjectText()), row('Source', yamlObject.value?.source?.component || yamlObject.value?.reportingController),
      row('Count', yamlObject.value?.count), row('Primero', yamlObject.value?.firstTimestamp || yamlObject.value?.eventTime), row('Ultimo', yamlObject.value?.lastTimestamp), row('Mensaje', yamlObject.value?.message),
    ]),
  }].filter(sectionHasContent)
}

function row(label, value) { return { label, value: formatDetailValue(value) } }
function compactRows(rows) { return rows.filter(item => item.value !== undefined && item.value !== null && item.value !== '') }
function sectionHasContent(section) { return section.rows?.length || section.chips?.length || section.items?.length }
function formatDetailValue(value) {
  if (value === true) return 'Si'
  if (value === false) return 'No'
  if (Array.isArray(value)) return value.join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value
}

function objectChips(obj = {}) { return Object.entries(obj || {}).map(([key, value]) => `${key}=${value}`) }
function selectorChips(selector = {}) { return [...objectChips(selector.matchLabels), ...(selector.matchExpressions || []).map(expr => `${expr.key} ${expr.operator}${expr.values?.length ? ` (${expr.values.join(', ')})` : ''}`)] }
function conditionItems(conditions = []) { return (conditions || []).map(c => ({ title: `${c.type}: ${c.status}`, subtitle: c.reason || c.message || c.lastTransitionTime || '-' })) }
function volumeItems(volumes = []) { return (volumes || []).map(v => ({ title: v.name, subtitle: Object.keys(v).filter(k => k !== 'name').join(', ') || '-' })) }
function containerItems(list = []) { return (list || []).map(c => ({ title: c.name, subtitle: [c.image, portsText(c.ports), resourcesText(c.resources)].filter(Boolean).join(' | ') })) }
function portsText(ports = []) { return (ports || []).map(p => `${p.containerPort}/${p.protocol || 'TCP'}`).join(', ') }
function resourcesText(resources = {}) {
  const req = resources.requests ? `req ${Object.entries(resources.requests).map(([k, v]) => `${k}:${v}`).join(',')}` : ''
  const lim = resources.limits ? `lim ${Object.entries(resources.limits).map(([k, v]) => `${k}:${v}`).join(',')}` : ''
  return [req, lim].filter(Boolean).join(' ')
}
function podRestartCount() { return (status.value.containerStatuses || []).reduce((sum, c) => sum + (c.restartCount || 0), 0) }
function loadBalancerText() {
  return (status.value.loadBalancer?.ingress || []).map(item => item.ip || item.hostname).filter(Boolean).join(', ')
}
function backendText(backend = {}) {
  const service = backend.service
  if (!service) return backend.resource?.name || '-'
  return `${service.name}:${service.port?.number || service.port?.name || '-'}`
}
function nodeRoles() {
  return Object.keys(metadata.value.labels || {}).filter(k => k.startsWith('node-role.kubernetes.io/')).map(k => k.replace('node-role.kubernetes.io/', '') || 'control-plane').join(', ') || 'worker'
}
function resourceRows(resources = {}) { return Object.entries(resources || {}).map(([key, value]) => row(key, value)) }
function involvedObjectText() {
  const obj = yamlObject.value?.involvedObject || yamlObject.value?.regarding
  return obj ? `${obj.kind || 'Object'}/${obj.namespace ? `${obj.namespace}/` : ''}${obj.name || '-'}` : ''
}

function flattenYaml(value, depth = 0, prefix = 'root') {
  if (!value || typeof value !== 'object') return []
  const rows = []
  Object.entries(value).forEach(([key, child]) => {
    const rowKey = `${prefix}.${key}`
    if (Array.isArray(child)) {
      rows.push({ key: rowKey, depth, name: `${key}:`, value: child.length ? `[${child.length}]` : '[]' })
      child.slice(0, 30).forEach((item, idx) => {
        if (item && typeof item === 'object') {
          rows.push({ key: `${rowKey}.${idx}`, depth: depth + 1, name: `- ${item.name || item.kind || idx}:` })
          rows.push(...flattenYaml(item, depth + 2, `${rowKey}.${idx}`))
        } else {
          rows.push({ key: `${rowKey}.${idx}`, depth: depth + 1, name: '-', value: formatValue(item) })
        }
      })
      return
    }
    if (child && typeof child === 'object') {
      rows.push({ key: rowKey, depth, name: `${key}:` })
      rows.push(...flattenYaml(child, depth + 1, rowKey))
      return
    }
    rows.push({ key: rowKey, depth, name: `${key}:`, value: formatValue(child) })
  })
  return rows
}

function formatValue(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
</script>

<style scoped>
.kube-detail-panel { width: 420px; min-width: 320px; max-width: 72vw; background: var(--bg); display: flex; flex-direction: column; min-height: 0; flex-shrink: 0; }
.kdp-header { height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; border-bottom: 1px solid var(--border); }
.kdp-title { min-width: 0; display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.kdp-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kdp-kind { color: var(--accent); font-weight: 700; }
.kdp-tabs { display: flex; gap: 2px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.kdp-tab { display: inline-flex; align-items: center; gap: 5px; border: none; border-radius: 5px; background: transparent; color: var(--text-dim); padding: 6px 8px; font-size: 12px; }
.kdp-tab.active { background: var(--bg-sel); color: #fff; }
.kdp-tab svg, .kdp-alert svg, .kdp-header svg, .kdp-prom-status svg { width: 13px; height: 13px; flex-shrink: 0; }
.kdp-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.kdp-section h3 { font-size: 12px; margin: 0 0 8px; color: var(--text); }
.kdp-props { margin: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.kdp-props.compact { border-radius: 5px; }
.kdp-prop-row { display: grid; grid-template-columns: 120px minmax(0, 1fr); }
.kdp-props dt, .kdp-props dd { padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 12px; min-width: 0; }
.kdp-props dt { color: var(--text-dim); background: var(--bg-row); }
.kdp-props dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kdp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.kdp-chip { font-size: 11px; color: var(--text-dim); background: var(--bg-row); border: 1px solid var(--border); border-radius: 4px; padding: 3px 6px; }
.kdp-list { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.kdp-list-item { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.kdp-list-item small { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kdp-yaml-tree { font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.65; border: 1px solid var(--border); border-radius: 6px; background: #111; overflow: auto; }
.kdp-yaml-line { display: flex; gap: 8px; min-height: 22px; border-bottom: 1px solid rgba(255,255,255,.035); }
.kdp-yaml-key { color: #9cdcfe; flex-shrink: 0; }
.kdp-yaml-value { color: #ce9178; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kdp-alert { display: flex; align-items: flex-start; gap: 8px; border-radius: 6px; padding: 10px 12px; font-size: 12px; line-height: 1.5; }
.kdp-alert.error { color: var(--red); border: 1px solid var(--red); background: rgba(244,67,54,.1); }
.kdp-alert.warn { color: var(--text); border: 1px solid rgba(255,152,0,.35); background: rgba(255,152,0,.08); }
.kdp-alert p { margin: 4px 0 8px; color: var(--text-dim); }
.kdp-empty, .kdp-muted { color: var(--text-dim); font-size: 12px; }
.kdp-metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.kdp-prom-status { display: flex; align-items: center; gap: 6px; margin: -2px 0 10px; font-size: 12px; color: var(--text-dim); }
.kdp-prom-status.ok { color: var(--green); }
.kdp-prom-status.warn { color: var(--yellow); }
.kdp-meter { border: 1px solid var(--border); border-radius: 6px; padding: 10px; background: var(--bg-row); }
.kdp-meter span { display: block; color: var(--text-dim); font-size: 11px; }
.kdp-meter strong { display: block; margin: 5px 0 9px; font-size: 16px; }
.kdp-bar { height: 7px; border-radius: 4px; background: rgba(255,255,255,.09); overflow: hidden; }
.kdp-bar span { display: block; height: 100%; background: var(--accent); }
.kdp-bar.memory span { background: var(--teal); }
code { background: var(--bg-row); padding: 1px 4px; border-radius: 3px; }
</style>