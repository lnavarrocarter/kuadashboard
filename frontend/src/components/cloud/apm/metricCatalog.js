import { apmResourceIcon, apmResourceLabel } from './resourcePresentation'

// Single provider-agnostic source of truth for which metrics each resource type exposes.
// Adding EC2, Cloud SQL, an Ingress collector or any future provider means adding one entry
// here; no Observability component needs to change.

export const METRIC_FORMATS = Object.freeze({
  number: 'number',
  bytes: 'bytes',
  ms: 'ms',
  percent: 'percent',
  cores: 'cores',
  pair: 'pair',
})

const LAMBDA_CATALOG = {
  kpis: [
    {
      id: 'invocations',
      labelKey: 'apm.observedInvocations',
      metric: 'invocations_observed',
      aggregate: 'sum',
      format: METRIC_FORMATS.number,
      detailKey: 'apm.reportLines',
    },
    {
      id: 'errorRate',
      labelKey: 'apm.observedErrorRate',
      metric: 'errors_observed',
      overMetric: 'invocations_observed',
      aggregate: 'ratio',
      format: METRIC_FORMATS.percent,
      detailKey: 'apm.signals',
      detailMetric: 'errors_observed',
    },
    {
      id: 'duration',
      labelKey: 'apm.averageDuration',
      metric: 'duration_ms',
      aggregate: 'average',
      format: METRIC_FORMATS.ms,
      detailKey: 'apm.lambdaExecution',
    },
  ],
  charts: [
    { metric: 'invocations_observed', labelKey: 'apm.observedInvocations', unit: '', color: '#58a6ff' },
    { metric: 'errors_observed', labelKey: 'apm.observedErrors', unit: '', color: '#f85149' },
    { metric: 'duration_ms', labelKey: 'apm.lambdaDuration', unit: 'ms', color: '#d29922' },
  ],
}

const KUBERNETES_WORKLOAD_CATALOG = {
  kpis: [
    {
      id: 'readyPods',
      labelKey: 'apm.readyPods',
      metric: 'pods_ready',
      overMetric: 'pods_total',
      aggregate: 'pair',
      format: METRIC_FORMATS.pair,
      detailKey: 'apm.restarts',
      detailMetric: 'restarts_delta',
    },
    {
      id: 'cpu',
      labelKey: 'apm.averageCpu',
      metric: 'cpu_cores',
      aggregate: 'average',
      format: METRIC_FORMATS.cores,
      detailKey: 'apm.metricsApi',
    },
    {
      id: 'memory',
      labelKey: 'apm.averageMemory',
      metric: 'memory_bytes',
      aggregate: 'average',
      format: METRIC_FORMATS.bytes,
      detailKey: 'apm.metricsApi',
    },
  ],
  charts: [
    { metric: 'cpu_cores', labelKey: 'apm.kubernetesCpu', unit: '', color: '#3fb950' },
    { metric: 'memory_bytes', labelKey: 'apm.kubernetesMemory', unit: 'bytes', color: '#a371f7' },
    { metric: 'pods_ready', labelKey: 'apm.readyPods', unit: '', color: '#39c5cf' },
  ],
}

// Types Architecture already discovers and correlates, but no collector reports metrics for yet.
// They are listed on purpose so the UI can show the inventory and explain the gap instead of
// silently omitting them.
const TOPOLOGY_ONLY = { kpis: [], charts: [] }

export const RESOURCE_METRIC_CATALOG = Object.freeze({
  lambda: LAMBDA_CATALOG,
  kubernetes: KUBERNETES_WORKLOAD_CATALOG,
  sqs: TOPOLOGY_ONLY,
  eventbridge: TOPOLOGY_ONLY,
  stepfunctions: TOPOLOGY_ONLY,
  ecs: TOPOLOGY_ONLY,
  s3: TOPOLOGY_ONLY,
  sns: TOPOLOGY_ONLY,
  dynamodb: TOPOLOGY_ONLY,
  'gcp-cloud-run': TOPOLOGY_ONLY,
  'gcp-function': TOPOLOGY_ONLY,
  'vercel-project': TOPOLOGY_ONLY,
})

// Only Kubernetes kinds that own Pods report usage; an Ingress or ConfigMap never will.
const KUBERNETES_METRIC_KINDS = Object.freeze(['Deployment', 'StatefulSet', 'DaemonSet', 'Service', 'Pod'])

export function catalogFor(resourceType, kind = '') {
  if (resourceType === 'kubernetes') {
    return KUBERNETES_METRIC_KINDS.includes(kind) ? KUBERNETES_WORKLOAD_CATALOG : TOPOLOGY_ONLY
  }
  return RESOURCE_METRIC_CATALOG[resourceType] || TOPOLOGY_ONLY
}

export function formatMetricValue(value, format) {
  if (value == null || Number.isNaN(value)) return '-'
  if (format === METRIC_FORMATS.bytes) {
    if (!value) return '-'
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`
    return `${(value / 1024 ** 2).toFixed(1)} MiB`
  }
  if (format === METRIC_FORMATS.ms) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ms`
  if (format === METRIC_FORMATS.cores) return `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} cores`
  if (format === METRIC_FORMATS.percent) return `${value.toFixed(1)}%`
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function metricValue(metricsByName, name, aggregate) {
  const entry = metricsByName[name]
  if (!entry) return null
  return aggregate === 'average' ? (entry.count ? entry.sum / entry.count : null) : entry.sum
}

function kpiValue(kpi, metricsByName) {
  if (kpi.aggregate === 'ratio') {
    const over = metricValue(metricsByName, kpi.overMetric, 'sum')
    const value = metricValue(metricsByName, kpi.metric, 'sum')
    if (!over) return null
    return ((value || 0) / over) * 100
  }
  if (kpi.aggregate === 'pair') {
    const total = metricValue(metricsByName, kpi.overMetric, 'sum')
    if (!total) return null
    const value = metricValue(metricsByName, kpi.metric, 'sum') || 0
    return `${value.toLocaleString()} / ${total.toLocaleString()}`
  }
  return metricValue(metricsByName, kpi.metric, kpi.aggregate)
}

function sectionKey(resourceType, kind) {
  return kind ? `${resourceType}:${kind}` : resourceType
}

// One metric name can now be charted several times (once per resource type/kind),
// so series are cached under a composite key instead of the bare metric name.
export function seriesKey(chart) {
  return `${chart.metric}@${sectionKey(chart.resourceType, chart.kind)}`
}

/**
 * Builds one section per resource type (per Kubernetes kind) actually present in the
 * application, each carrying its own KPIs and chart definitions from the catalog.
 */
export function buildResourceMetricSections({ resources = [], metricsByResourceType = [] } = {}) {
  const groups = new Map()
  for (const resource of resources) {
    const resourceType = resource.type
    if (!resourceType) continue
    const kind = resourceType === 'kubernetes' ? (resource.kind || '') : ''
    const key = sectionKey(resourceType, kind)
    const group = groups.get(key) || { resourceType, kind, resourceCount: 0 }
    group.resourceCount += 1
    groups.set(key, group)
  }

  const metricsByKey = new Map()
  for (const row of metricsByResourceType) {
    const kind = row.resourceType === 'kubernetes' ? (row.kind || '') : ''
    const key = sectionKey(row.resourceType, kind)
    const bucket = metricsByKey.get(key) || {}
    bucket[row.metricName] = row
    metricsByKey.set(key, bucket)
  }

  return [...groups.values()]
    .map(group => {
      const key = sectionKey(group.resourceType, group.kind)
      const catalog = catalogFor(group.resourceType, group.kind)
      const metricsByName = metricsByKey.get(key) || {}
      const kpis = catalog.kpis.map(kpi => {
        const value = kpiValue(kpi, metricsByName)
        return {
          id: kpi.id,
          labelKey: kpi.labelKey,
          detailKey: kpi.detailKey,
          detailValue: kpi.detailMetric ? metricValue(metricsByName, kpi.detailMetric, 'sum') || 0 : null,
          value: kpi.aggregate === 'pair' ? (value ?? '-') : formatMetricValue(value, kpi.format),
        }
      })
      return {
        key,
        resourceType: group.resourceType,
        kind: group.kind,
        label: apmResourceLabel({ type: group.resourceType, kind: group.kind }),
        icon: apmResourceIcon({ type: group.resourceType, kind: group.kind }),
        resourceCount: group.resourceCount,
        collectsMetrics: catalog.charts.length > 0,
        hasData: Object.keys(metricsByName).length > 0,
        kpis,
        charts: catalog.charts.map(chart => ({ ...chart, resourceType: group.resourceType, kind: group.kind })),
      }
    })
    .sort((left, right) => {
      if (left.collectsMetrics !== right.collectsMetrics) return left.collectsMetrics ? -1 : 1
      return left.label.localeCompare(right.label)
    })
}
