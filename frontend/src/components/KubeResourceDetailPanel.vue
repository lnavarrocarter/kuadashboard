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
      <button v-if="isDeployment" :class="['kdp-tab', { active: tab === 'env' }]" @click="tab = 'env'"><i data-lucide="list-plus"></i> Env</button>
      <button v-if="isDataEditable" :class="['kdp-tab', { active: tab === 'data' }]" @click="tab = 'data'"><i data-lucide="table-properties"></i> Data</button>
      <button :class="['kdp-tab', { active: tab === 'yaml' }]" @click="tab = 'yaml'"><i data-lucide="braces"></i> YAML</button>
      <button :class="['kdp-tab', { active: tab === 'metrics' }]" @click="tab = 'metrics'"><i data-lucide="activity"></i> Metricas</button>
      <button :class="['kdp-tab', { active: tab === 'events' }]" @click="tab = 'events'"><i data-lucide="bell-ring"></i> Eventos</button>
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
              <a v-if="item.url" class="kdp-open-link" :href="item.url" target="_blank" rel="noopener noreferrer">
                <i data-lucide="external-link"></i> Abrir
              </a>
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
      <template v-else>
        <div class="kdp-yaml-tools">
          <div class="kdp-yaml-search">
            <i data-lucide="search"></i>
            <input v-model.trim="yamlSearch" class="ctrl-input" placeholder="Buscar en YAML..." spellcheck="false" />
            <span>{{ yamlSearchStatus }}</span>
          </div>
          <div class="kdp-yaml-actions">
            <button class="btn sm" title="Expandir todo" @click="expandAllYaml"><i data-lucide="chevrons-down"></i></button>
            <button class="btn sm" title="Colapsar todo" @click="collapseAllYaml"><i data-lucide="chevrons-up"></i></button>
          </div>
        </div>
        <div class="kdp-yaml-tree">
          <transition-group name="kdp-yaml-row" tag="div">
            <div
              v-for="line in yamlTreeLines"
              :key="line.key"
              :class="['kdp-yaml-line', { match: line.matches }]"
              :style="{ paddingLeft: `${line.depth * 14 + 8}px` }"
            >
              <button
                v-if="line.hasChildren"
                class="kdp-yaml-toggle"
                :title="isYamlExpanded(line.key) ? 'Colapsar' : 'Expandir'"
                @click="toggleYamlKey(line.key)"
              >
                <i :data-lucide="isYamlExpanded(line.key) ? 'chevron-down' : 'chevron-right'"></i>
              </button>
              <span v-else class="kdp-yaml-spacer"></span>
              <span class="kdp-yaml-key">{{ line.name }}</span>
              <span v-if="line.value !== undefined" class="kdp-yaml-value">{{ line.value }}</span>
            </div>
          </transition-group>
          <div v-if="!yamlTreeLines.length" class="kdp-yaml-empty">Sin coincidencias</div>
        </div>
      </template>
    </section>

    <section v-else-if="tab === 'env'" class="kdp-body">
      <div v-if="loading" class="kdp-empty">Cargando environments...</div>
      <div v-else-if="error" class="kdp-alert error"><i data-lucide="alert-triangle"></i>{{ error }}</div>
      <template v-else>
        <div v-for="group in envGroups" :key="group.name" class="kdp-section">
          <h3>{{ group.name }}</h3>
          <div class="kdp-env-list">
            <div v-for="row in group.rows" :key="row.id" :class="['kdp-env-row', { readonly: row.valueFrom }]">
              <input v-model.trim="row.name" class="ctrl-input" placeholder="KEY" :disabled="!!row.valueFrom" spellcheck="false" />
              <input v-model="row.value" class="ctrl-input" placeholder="value" :disabled="!!row.valueFrom" spellcheck="false" />
              <button class="btn sm btn-icon" title="Eliminar variable" @click="removeEnvRow(group, row)"><i data-lucide="trash-2"></i></button>
              <small v-if="row.valueFrom" class="kdp-env-source">{{ valueFromText(row.valueFrom) }}</small>
            </div>
            <div v-if="!group.rows.length" class="kdp-empty compact">Sin variables en este contenedor.</div>
          </div>
          <button class="btn sm" @click="addEnvRow(group)"><i data-lucide="plus"></i> Agregar variable</button>
        </div>
        <div class="kdp-env-footer">
          <button class="btn primary" :disabled="savingEnv" @click="saveEnvVars">
            <i :data-lucide="savingEnv ? 'loader-2' : 'save'"></i> {{ savingEnv ? 'Guardando...' : 'Guardar environments' }}
          </button>
        </div>
      </template>
    </section>

    <section v-else-if="tab === 'data'" class="kdp-body">
      <div v-if="loading" class="kdp-empty">Cargando data...</div>
      <div v-else-if="error" class="kdp-alert error"><i data-lucide="alert-triangle"></i>{{ error }}</div>
      <template v-else>
        <div v-if="isSecret && secretImmutable" class="kdp-alert warn">
          <i data-lucide="lock"></i>
          <div>Este Secret esta marcado como immutable; Kubernetes puede rechazar cambios.</div>
        </div>
        <div v-if="dataBinaryKeys.length" class="kdp-section">
          <h3>binaryData</h3>
          <div class="kdp-chips">
            <span v-for="key in dataBinaryKeys" :key="key" class="kdp-chip">{{ key }}</span>
          </div>
        </div>
        <div class="kdp-section">
          <div class="kdp-section-head">
            <h3>{{ isSecret ? 'Secret data' : 'ConfigMap data' }}</h3>
            <button v-if="isSecret" class="btn sm" @click="toggleAllDataReveal">
              <i :data-lucide="allDataRevealed ? 'eye-off' : 'eye'"></i> {{ allDataRevealed ? 'Ocultar' : 'Mostrar' }}
            </button>
          </div>
          <div class="kdp-data-list">
            <div v-for="row in dataRows" :key="row.id" class="kdp-data-row">
              <input v-model.trim="row.name" class="ctrl-input" placeholder="KEY" spellcheck="false" />
              <textarea v-model="row.value" :class="['ctrl-input', { masked: isSecret && !revealedDataKeys.has(row.id) }]" rows="2" placeholder="value" spellcheck="false"></textarea>
              <div class="kdp-data-actions">
                <button v-if="isSecret" class="btn sm btn-icon" :title="revealedDataKeys.has(row.id) ? 'Ocultar valor' : 'Mostrar valor'" @click="toggleDataReveal(row)"><i :data-lucide="revealedDataKeys.has(row.id) ? 'eye-off' : 'eye'"></i></button>
                <button class="btn sm btn-icon" title="Eliminar clave" @click="removeDataRow(row)"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
            <div v-if="!dataRows.length" class="kdp-empty compact">Sin claves todavia.</div>
          </div>
          <button class="btn sm" @click="addDataRow"><i data-lucide="plus"></i> Agregar clave</button>
        </div>
        <div class="kdp-env-footer">
          <button class="btn primary" :disabled="savingData" @click="saveDataMap">
            <i :data-lucide="savingData ? 'loader-2' : 'save'"></i> {{ savingData ? 'Guardando...' : 'Guardar data' }}
          </button>
        </div>
      </template>
    </section>

    <section v-else-if="tab === 'metrics'" class="kdp-body">
      <template v-if="isMetricsSupported">
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
          <div v-if="metrics.items?.length" class="kdp-list kdp-metric-items">
            <div v-for="item in metrics.items" :key="item.name" class="kdp-list-item">
              <span>{{ item.name }}</span>
              <small>CPU {{ item.cpu }} | Memoria {{ item.memory }}</small>
            </div>
          </div>
          <p class="kdp-muted">Fuente: <code>{{ metrics.source || 'metrics.k8s.io' }}</code>.</p>
        </div>
        <div v-else class="kdp-alert warn">
          <i data-lucide="info"></i>
          <div>
            <strong>Metricas no disponibles</strong>
            <p>{{ metricsError || 'No se pudo consultar metrics.k8s.io en el cluster.' }}</p>
            <p>{{ prometheusLabel }}</p>
            <button class="btn sm primary" @click="$emit('open-helm')"><i data-lucide="package-plus"></i> Abrir Helm</button>
          </div>
        </div>
      </template>
      <div v-else class="kdp-alert warn">
        <i data-lucide="info"></i>
        <div>
          <p>Las metricas visuales estan disponibles para Pods, Nodes, Services y workloads con selector.</p>
          <p>{{ prometheusLabel }}</p>
          <button class="btn sm primary" @click="$emit('open-helm')"><i data-lucide="package-plus"></i> Abrir Helm</button>
        </div>
      </div>
    </section>

    <section v-else class="kdp-body">
      <div v-if="eventsLoading" class="kdp-empty">Cargando eventos...</div>
      <div v-else-if="eventsError" class="kdp-alert error"><i data-lucide="alert-triangle"></i>{{ eventsError }}</div>
      <template v-else>
        <div class="kdp-event-summary">
          <div class="kdp-event-card">
            <span>Total</span>
            <strong>{{ relatedEvents.total }}</strong>
          </div>
          <div class="kdp-event-card warn">
            <span>Warnings</span>
            <strong>{{ relatedEvents.warnings }}</strong>
          </div>
        </div>
        <div v-if="!relatedEvents.events.length" class="kdp-empty compact">Sin eventos relacionados para este recurso.</div>
        <div v-else class="kdp-event-list">
          <div v-for="event in relatedEvents.events" :key="event.name || `${event.reason}-${event.lastTimestamp}`" :class="['kdp-event-item', event.type?.toLowerCase()]">
            <div class="kdp-event-top">
              <strong>{{ event.reason || event.type }}</strong>
              <span>{{ formatEventDate(event.lastTimestamp || event.age) }}</span>
            </div>
            <p>{{ event.message || '-' }}</p>
            <small>{{ event.namespace || 'cluster' }} · {{ event.object }} · count {{ event.count || 1 }} · {{ event.source || '-' }}</small>
          </div>
        </div>
      </template>
    </section>
  </aside>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { createIcons, icons } from 'lucide'
import yaml from 'js-yaml'
import { api } from '../composables/useApi'
import { useToast } from '../composables/useToast'

const props = defineProps({
  resourceType: { type: String, required: true },
  resource: { type: Object, required: true },
})
defineEmits(['close', 'open-helm'])
const { toast } = useToast()

const CLUSTER_RESOURCES = new Set([
  'nodes', 'namespaces', 'pvs', 'storageclasses', 'ingressclasses',
  'priorityclasses', 'runtimeclasses', 'mutatingwebhookconfigurations',
  'validatingwebhookconfigurations',
])

const tab = ref('overview')
const loading = ref(false)
const error = ref('')
const yamlText = ref('')
const yamlObject = ref(null)
const yamlSearch = ref('')
const expandedYamlKeys = ref(new Set())
const envGroups = ref([])
const savingEnv = ref(false)
const dataRows = ref([])
const dataBinaryKeys = ref([])
const savingData = ref(false)
const secretImmutable = ref(false)
const revealedDataKeys = ref(new Set())
const metrics = ref(null)
const metricsError = ref('')
const metricsLoading = ref(false)
const prometheus = ref(null)
const relatedEvents = ref({ total: 0, warnings: 0, events: [] })
const eventsLoading = ref(false)
const eventsError = ref('')

const kindLabel = computed(() => props.resourceType === 'pvcs' ? 'PersistentVolumeClaim' : singularTitle(props.resourceType))
const isDeployment = computed(() => props.resourceType === 'deployments')
const isMetricsSupported = computed(() => ['pods', 'nodes', 'deployments', 'statefulsets', 'daemonsets', 'services'].includes(props.resourceType))
const isSecret = computed(() => props.resourceType === 'secrets')
const isDataEditable = computed(() => ['configmaps', 'secrets'].includes(props.resourceType))
const allDataRevealed = computed(() => dataRows.value.length > 0 && dataRows.value.every(row => revealedDataKeys.value.has(row.id)))
const metadata = computed(() => yamlObject.value?.metadata || {})
const spec = computed(() => yamlObject.value?.spec || {})
const status = computed(() => yamlObject.value?.status || {})
const labels = computed(() => Object.entries(metadata.value.labels || {}).map(([key, value]) => `${key}=${value}`))
const containers = computed(() => spec.value.containers || spec.value.template?.spec?.containers || [])
const properties = computed(() => baseProperties())
const ownerText = computed(() => (metadata.value.ownerReferences || []).map(o => `${o.kind}/${o.name}`).join(', '))
const yamlAllLines = computed(() => flattenYaml(yamlObject.value))
const yamlSearchTerm = computed(() => yamlSearch.value.toLowerCase())
const yamlTreeLines = computed(() => filteredYamlLines())
const yamlSearchStatus = computed(() => yamlSearch.value ? `${yamlTreeLines.value.filter(line => line.matches).length} coincidencia(s)` : `${yamlAllLines.value.length} lineas`)
const detailSections = computed(() => resourceSections())
const prometheusLabel = computed(() => {
  if (!prometheus.value) return 'Prometheus no verificado.'
  if (!prometheus.value.available) return 'No se detecto Prometheus en los Services del cluster.'
  const svc = prometheus.value.services?.[0]
  return `Prometheus disponible: ${svc.namespace}/${svc.name}.`
})

watch(() => [props.resourceType, props.resource?.name, props.resource?.namespace], () => loadDetail(true), { immediate: true })
watch(tab, () => nextTick(() => createIcons({ icons })))

async function loadDetail(resetTab = true) {
  if (!props.resource?.name) return
  if (resetTab) tab.value = 'overview'
  loading.value = true
  error.value = ''
  yamlText.value = ''
  yamlObject.value = null
  yamlSearch.value = ''
  expandedYamlKeys.value = new Set()
  envGroups.value = []
  dataRows.value = []
  dataBinaryKeys.value = []
  secretImmutable.value = false
  revealedDataKeys.value = new Set()
  metrics.value = null
  metricsError.value = ''
  prometheus.value = null
  relatedEvents.value = { total: 0, warnings: 0, events: [] }
  eventsError.value = ''
  try {
    const url = CLUSTER_RESOURCES.has(props.resourceType)
      ? `/api/${props.resourceType}/${encodeURIComponent(props.resource.name)}/yaml`
      : `/api/${encodeURIComponent(props.resource.namespace)}/${props.resourceType}/${encodeURIComponent(props.resource.name)}/yaml`
    yamlText.value = await api('GET', url)
    yamlObject.value = yaml.load(yamlText.value)
    syncEnvEditor()
    if (isDataEditable.value) await loadDataEditor()
    initializeYamlExpansion()
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
    nextTick(() => createIcons({ icons }))
  }
  if (isMetricsSupported.value) loadMetrics()
  loadRelatedEvents()
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
    const url = props.resourceType === 'nodes'
      ? `/api/nodes/${encodeURIComponent(props.resource.name)}/metrics`
      : `/api/${encodeURIComponent(props.resource.namespace)}/${props.resourceType}/${encodeURIComponent(props.resource.name)}/metrics`
    metrics.value = await api('GET', url)
  } catch (e) {
    metricsError.value = e.message
  } finally {
    metricsLoading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

async function loadRelatedEvents() {
  eventsLoading.value = true
  eventsError.value = ''
  relatedEvents.value = { total: 0, warnings: 0, events: [] }
  try {
    const params = new URLSearchParams({ kind: kindLabel.value, name: props.resource.name })
    if (props.resource.namespace) params.set('namespace', props.resource.namespace)
    relatedEvents.value = await api('GET', `/api/events/related?${params}`)
  } catch (e) {
    eventsError.value = e.message
  } finally {
    eventsLoading.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function formatEventDate(raw) {
  if (!raw) return '-'
  try { return new Date(raw).toLocaleString() } catch { return raw }
}

function singularTitle(type) {
  return ({ pods: 'Pod', deployments: 'Deployment', statefulsets: 'StatefulSet', daemonsets: 'DaemonSet', replicasets: 'ReplicaSet', jobs: 'Job', cronjobs: 'CronJob', services: 'Service', endpointslices: 'EndpointSlice', endpoints: 'Endpoints', ingresses: 'Ingress', ingressclasses: 'IngressClass', networkpolicies: 'NetworkPolicy', configmaps: 'ConfigMap', secrets: 'Secret', resourcequotas: 'ResourceQuota', limitranges: 'LimitRange', hpas: 'HorizontalPodAutoscaler', pdbs: 'PodDisruptionBudget', priorityclasses: 'PriorityClass', runtimeclasses: 'RuntimeClass', leases: 'Lease', mutatingwebhookconfigurations: 'MutatingWebhookConfiguration', validatingwebhookconfigurations: 'ValidatingWebhookConfiguration', pvcs: 'PersistentVolumeClaim', pvs: 'PersistentVolume', storageclasses: 'StorageClass', namespaces: 'Namespace', nodes: 'Node', events: 'Event' })[type] || type
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
    { title: 'Entrada', rows: compactRows([row('Clase', ingressClassName()), row('TLS', spec.value.tls?.length ? `${spec.value.tls.length} secreto(s)` : 'No'), row('ELB / Address', loadBalancerText())]) },
    { title: 'URLs', items: ingressUrlItems() },
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
function ingressClassName() {
  return spec.value.ingressClassName || metadata.value.annotations?.['kubernetes.io/ingress.class'] || '-'
}
function ingressUrlItems() {
  const address = loadBalancerText().split(', ').find(Boolean) || ''
  const tlsHosts = new Set((spec.value.tls || []).flatMap(tls => tls.hosts || []))
  return (spec.value.rules || []).flatMap(rule => (rule.http?.paths || [{ path: '/' }]).map(path => {
    const host = rule.host || address
    if (!host || host === '*') return null
    const rawPath = path.path || '/'
    const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    const scheme = spec.value.tls?.length && (tlsHosts.has(host) || !tlsHosts.size) ? 'https' : 'http'
    const url = `${scheme}://${host}${normalizedPath === '/' ? '' : normalizedPath}`
    return { title: url, subtitle: `${path.pathType || 'Prefix'} -> ${backendText(path.backend)}`, url }
  })).filter(Boolean)
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

let envRowId = 0
let dataRowId = 0

function syncEnvEditor() {
  envGroups.value = containers.value.map(container => ({
    name: container.name,
    image: container.image,
    rows: (container.env || []).map(envItem => ({
      id: ++envRowId,
      name: envItem.name || '',
      value: envItem.value ?? '',
      valueFrom: envItem.valueFrom ? JSON.parse(JSON.stringify(envItem.valueFrom)) : null,
    })),
  }))
}

function addEnvRow(group) {
  group.rows.push({ id: ++envRowId, name: '', value: '', valueFrom: null })
  nextTick(() => createIcons({ icons }))
}

function removeEnvRow(group, row) {
  const index = group.rows.findIndex(item => item.id === row.id)
  if (index !== -1) group.rows.splice(index, 1)
}

function valueFromText(valueFrom = {}) {
  if (valueFrom.secretKeyRef) return `Secret: ${valueFrom.secretKeyRef.name}/${valueFrom.secretKeyRef.key}`
  if (valueFrom.configMapKeyRef) return `ConfigMap: ${valueFrom.configMapKeyRef.name}/${valueFrom.configMapKeyRef.key}`
  if (valueFrom.fieldRef) return `FieldRef: ${valueFrom.fieldRef.fieldPath}`
  if (valueFrom.resourceFieldRef) return `ResourceRef: ${valueFrom.resourceFieldRef.resource}`
  return 'valueFrom'
}

async function saveEnvVars() {
  if (!isDeployment.value || savingEnv.value) return
  const containersPayload = []
  for (const group of envGroups.value) {
    const seen = new Set()
    const env = []
    for (const row of group.rows) {
      const name = String(row.name || '').trim()
      if (!name && !row.value && !row.valueFrom) continue
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        toast(`Nombre invalido en ${group.name}: ${name || '(vacio)'}`, 'error')
        return
      }
      if (seen.has(name)) {
        toast(`Variable duplicada en ${group.name}: ${name}`, 'error')
        return
      }
      seen.add(name)
      env.push(row.valueFrom ? { name, valueFrom: row.valueFrom } : { name, value: String(row.value ?? '') })
    }
    containersPayload.push({ name: group.name, env })
  }

  savingEnv.value = true
  try {
    await api('PUT', `/api/${encodeURIComponent(props.resource.namespace)}/deployments/${encodeURIComponent(props.resource.name)}/env`, { containers: containersPayload })
    toast('Environments guardados', 'success')
    await loadDetail(false)
    tab.value = 'env'
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    savingEnv.value = false
    nextTick(() => createIcons({ icons }))
  }
}

async function loadDataEditor() {
  const result = await api('GET', `/api/${encodeURIComponent(props.resource.namespace)}/${props.resourceType}/${encodeURIComponent(props.resource.name)}/data`)
  dataBinaryKeys.value = result.binaryKeys || []
  secretImmutable.value = !!result.immutable
  dataRows.value = Object.entries(result.data || {}).map(([name, value]) => ({ id: ++dataRowId, name, value: String(value ?? '') }))
}

function addDataRow() {
  const row = { id: ++dataRowId, name: '', value: '' }
  dataRows.value.push(row)
  if (isSecret.value) revealedDataKeys.value = new Set([...revealedDataKeys.value, row.id])
  nextTick(() => createIcons({ icons }))
}

function removeDataRow(row) {
  dataRows.value = dataRows.value.filter(item => item.id !== row.id)
  const next = new Set(revealedDataKeys.value)
  next.delete(row.id)
  revealedDataKeys.value = next
}

function toggleDataReveal(row) {
  const next = new Set(revealedDataKeys.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  revealedDataKeys.value = next
  nextTick(() => createIcons({ icons }))
}

function toggleAllDataReveal() {
  revealedDataKeys.value = allDataRevealed.value ? new Set() : new Set(dataRows.value.map(row => row.id))
  nextTick(() => createIcons({ icons }))
}

async function saveDataMap() {
  if (!isDataEditable.value || savingData.value) return
  const data = {}
  for (const row of dataRows.value) {
    const name = String(row.name || '').trim()
    if (!name && !row.value) continue
    if (!name) { toast('Hay una clave sin nombre', 'error'); return }
    if (data[name] !== undefined) { toast(`Clave duplicada: ${name}`, 'error'); return }
    data[name] = String(row.value ?? '')
  }
  savingData.value = true
  try {
    await api('PUT', `/api/${encodeURIComponent(props.resource.namespace)}/${props.resourceType}/${encodeURIComponent(props.resource.name)}/data`, { data })
    toast(`${isSecret.value ? 'Secret' : 'ConfigMap'} guardado`, 'success')
    await loadDetail(false)
    tab.value = 'data'
  } catch (e) {
    toast(e.message, 'error')
  } finally {
    savingData.value = false
    nextTick(() => createIcons({ icons }))
  }
}

function initializeYamlExpansion() {
  expandedYamlKeys.value = new Set(yamlAllLines.value.filter(line => line.hasChildren && line.depth < 2).map(line => line.key))
}

function isYamlExpanded(key) { return expandedYamlKeys.value.has(key) }
function toggleYamlKey(key) {
  const next = new Set(expandedYamlKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedYamlKeys.value = next
  nextTick(() => createIcons({ icons }))
}
function expandAllYaml() { expandedYamlKeys.value = new Set(yamlAllLines.value.filter(line => line.hasChildren).map(line => line.key)); nextTick(() => createIcons({ icons })) }
function collapseAllYaml() { expandedYamlKeys.value = new Set(); nextTick(() => createIcons({ icons })) }

function filteredYamlLines() {
  const lines = yamlAllLines.value
  const term = yamlSearchTerm.value
  if (term) {
    const visible = new Set()
    lines.forEach(line => {
      const matches = yamlLineText(line).includes(term)
      line.matches = matches
      if (matches) [line.key, ...line.ancestors].forEach(key => visible.add(key))
    })
    return lines.filter(line => visible.has(line.key))
  }
  lines.forEach(line => { line.matches = false })
  return lines.filter(line => line.ancestors.every(key => expandedYamlKeys.value.has(key)))
}

function yamlLineText(line) {
  return `${line.name} ${line.value ?? ''}`.toLowerCase()
}

function flattenYaml(value, depth = 0, prefix = 'root', ancestors = []) {
  if (!value || typeof value !== 'object') return []
  const rows = []
  Object.entries(value).forEach(([key, child]) => {
    const rowKey = `${prefix}.${key}`
    if (Array.isArray(child)) {
      rows.push({ key: rowKey, depth, name: `${key}:`, value: child.length ? `[${child.length}]` : '[]', hasChildren: child.length > 0, ancestors })
      child.slice(0, 30).forEach((item, idx) => {
        if (item && typeof item === 'object') {
          const itemKey = `${rowKey}.${idx}`
          rows.push({ key: itemKey, depth: depth + 1, name: `- ${item.name || item.kind || idx}:`, hasChildren: true, ancestors: [...ancestors, rowKey] })
          rows.push(...flattenYaml(item, depth + 2, itemKey, [...ancestors, rowKey, itemKey]))
        } else {
          rows.push({ key: `${rowKey}.${idx}`, depth: depth + 1, name: '-', value: formatValue(item), hasChildren: false, ancestors: [...ancestors, rowKey] })
        }
      })
      return
    }
    if (child && typeof child === 'object') {
      rows.push({ key: rowKey, depth, name: `${key}:`, hasChildren: true, ancestors })
      rows.push(...flattenYaml(child, depth + 1, rowKey, [...ancestors, rowKey]))
      return
    }
    rows.push({ key: rowKey, depth, name: `${key}:`, value: formatValue(child), hasChildren: false, ancestors })
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
.kdp-tab svg, .kdp-alert svg, .kdp-header svg, .kdp-prom-status svg, .kdp-yaml-tools svg, .kdp-env-row svg, .kdp-data-row svg { width: 13px; height: 13px; flex-shrink: 0; }
.kdp-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 14px; }
.kdp-section h3 { font-size: 12px; margin: 0 0 8px; color: var(--text); }
.kdp-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.kdp-section-head h3 { margin: 0; }
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
.kdp-open-link { display: inline-flex; align-items: center; gap: 5px; width: fit-content; color: var(--accent); font-size: 12px; text-decoration: none; margin-top: 4px; }
.kdp-open-link:hover { text-decoration: underline; }
.kdp-open-link svg { width: 12px; height: 12px; }
.kdp-yaml-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.kdp-yaml-search { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; }
.kdp-yaml-search input { min-width: 0; flex: 1; height: 28px; font-size: 12px; }
.kdp-yaml-search span { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
.kdp-yaml-actions { display: flex; align-items: center; gap: 4px; }
.kdp-yaml-actions .btn { width: 28px; height: 28px; padding: 0; justify-content: center; }
.kdp-yaml-tree { font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace; font-size: 12px; line-height: 1.65; border: 1px solid var(--border); border-radius: 6px; background: #111; overflow: auto; }
.kdp-yaml-line { display: flex; align-items: center; gap: 6px; min-height: 24px; border-bottom: 1px solid rgba(255,255,255,.035); transition: background .16s ease, opacity .16s ease, transform .16s ease; }
.kdp-yaml-line.match { background: rgba(255, 193, 7, .12); }
.kdp-yaml-toggle { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 4px; background: transparent; color: var(--text-dim); padding: 0; flex-shrink: 0; }
.kdp-yaml-toggle:hover { background: rgba(255,255,255,.08); color: var(--text); }
.kdp-yaml-toggle svg { width: 13px; height: 13px; }
.kdp-yaml-spacer { width: 18px; flex-shrink: 0; }
.kdp-yaml-key { color: #9cdcfe; flex-shrink: 0; }
.kdp-yaml-value { color: #ce9178; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kdp-yaml-empty { padding: 12px; color: var(--text-dim); font-family: var(--font, system-ui); font-size: 12px; }
.kdp-yaml-row-enter-active, .kdp-yaml-row-leave-active { transition: opacity .16s ease, transform .16s ease; }
.kdp-yaml-row-enter-from, .kdp-yaml-row-leave-to { opacity: 0; transform: translateY(-3px); }
.kdp-env-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.kdp-env-row { display: grid; grid-template-columns: minmax(96px, .7fr) minmax(120px, 1fr) 28px; gap: 6px; align-items: start; }
.kdp-env-row.readonly { grid-template-columns: minmax(96px, .7fr) minmax(120px, 1fr) 28px; }
.kdp-env-row input { min-width: 0; height: 28px; font-size: 12px; }
.kdp-env-row input:disabled { opacity: .75; cursor: not-allowed; }
.kdp-env-row .btn-icon { width: 28px; height: 28px; padding: 0; justify-content: center; }
.kdp-env-source { grid-column: 1 / -1; color: var(--text-dim); margin: -2px 0 2px; }
.kdp-env-footer { position: sticky; bottom: -12px; display: flex; justify-content: flex-end; padding: 10px 0 0; background: linear-gradient(to top, var(--bg) 70%, transparent); }
.kdp-data-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.kdp-data-row { display: grid; grid-template-columns: minmax(92px, .55fr) minmax(140px, 1fr) 64px; gap: 6px; align-items: start; }
.kdp-data-row input { min-width: 0; height: 30px; font-size: 12px; }
.kdp-data-row textarea { min-width: 0; resize: vertical; min-height: 32px; max-height: 160px; padding: 6px 8px; font-size: 12px; line-height: 1.35; }
.kdp-data-row textarea.masked { -webkit-text-security: disc; font-family: text-security-disc, system-ui, sans-serif; }
.kdp-data-actions { display: flex; gap: 4px; }
.kdp-data-actions .btn-icon { width: 28px; height: 28px; padding: 0; justify-content: center; }
.kdp-alert { display: flex; align-items: flex-start; gap: 8px; border-radius: 6px; padding: 10px 12px; font-size: 12px; line-height: 1.5; }
.kdp-alert.error { color: var(--red); border: 1px solid var(--red); background: rgba(244,67,54,.1); }
.kdp-alert.warn { color: var(--text); border: 1px solid rgba(255,152,0,.35); background: rgba(255,152,0,.08); }
.kdp-alert p { margin: 4px 0 8px; color: var(--text-dim); }
.kdp-empty, .kdp-muted { color: var(--text-dim); font-size: 12px; }
.kdp-empty.compact { padding: 6px 0; }
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
.kdp-metric-items { margin-top: 10px; }
.kdp-event-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.kdp-event-card { border: 1px solid var(--border); border-radius: 6px; background: var(--bg-row); padding: 10px; }
.kdp-event-card span { display: block; color: var(--text-dim); font-size: 11px; }
.kdp-event-card strong { display: block; margin-top: 4px; font-size: 18px; }
.kdp-event-card.warn strong { color: var(--yellow); }
.kdp-event-list { display: flex; flex-direction: column; gap: 8px; }
.kdp-event-item { border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; background: var(--bg-row); padding: 9px 10px; }
.kdp-event-item.warning { border-left-color: var(--yellow); }
.kdp-event-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.kdp-event-top span { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
.kdp-event-item p { margin: 6px 0; color: var(--text); font-size: 12px; line-height: 1.4; }
.kdp-event-item small { color: var(--text-dim); font-size: 11px; }
code { background: var(--bg-row); padding: 1px 4px; border-radius: 3px; }
</style>