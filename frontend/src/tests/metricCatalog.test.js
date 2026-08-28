import { describe, expect, it } from 'vitest'
import { buildResourceMetricSections, catalogFor, formatMetricValue } from '../components/cloud/apm/metricCatalog'

describe('metricCatalog', () => {
  it('builds one section per resource type present in the application', () => {
    const sections = buildResourceMetricSections({
      resources: [
        { type: 'lambda' },
        { type: 'lambda' },
        { type: 's3' },
      ],
      metricsByResourceType: [
        { resourceType: 'lambda', kind: '', metricName: 'invocations_observed', sum: 200, count: 4 },
        { resourceType: 'lambda', kind: '', metricName: 'errors_observed', sum: 10, count: 4 },
      ],
    })

    const lambda = sections.find(section => section.resourceType === 'lambda')
    expect(lambda.resourceCount).toBe(2)
    expect(lambda.collectsMetrics).toBe(true)
    expect(lambda.kpis.find(kpi => kpi.id === 'invocations').value).toBe('200')
    expect(lambda.kpis.find(kpi => kpi.id === 'errorRate').value).toBe('5.0%')

    // S3 is discoverable and correlated, but no collector reports metrics for it yet:
    // it must still be listed so the gap is visible instead of silently omitted.
    const s3 = sections.find(section => section.resourceType === 's3')
    expect(s3.resourceCount).toBe(1)
    expect(s3.collectsMetrics).toBe(false)
    expect(s3.charts).toEqual([])
  })

  it('splits Kubernetes sections per kind and only gives metric charts to pod-owning kinds', () => {
    const sections = buildResourceMetricSections({
      resources: [
        { type: 'kubernetes', kind: 'Deployment' },
        { type: 'kubernetes', kind: 'Deployment' },
        { type: 'kubernetes', kind: 'ConfigMap' },
      ],
      metricsByResourceType: [
        { resourceType: 'kubernetes', kind: 'Deployment', metricName: 'pods_ready', sum: 5, count: 5 },
        { resourceType: 'kubernetes', kind: 'Deployment', metricName: 'pods_total', sum: 6, count: 6 },
        { resourceType: 'kubernetes', kind: 'Deployment', metricName: 'memory_bytes', sum: 4 * 1024 ** 3, count: 2 },
      ],
    })

    const deployments = sections.find(section => section.kind === 'Deployment')
    expect(deployments.label).toBe('Kubernetes Deployment')
    expect(deployments.resourceCount).toBe(2)
    expect(deployments.kpis.find(kpi => kpi.id === 'readyPods').value).toBe('5 / 6')
    expect(deployments.kpis.find(kpi => kpi.id === 'memory').value).toBe('2.00 GiB')
    expect(deployments.charts.every(chart => chart.kind === 'Deployment')).toBe(true)

    const configMaps = sections.find(section => section.kind === 'ConfigMap')
    expect(configMaps.collectsMetrics).toBe(false)
    expect(configMaps.charts).toEqual([])
  })

  it('every section leads with its own resource count, including topology-only types', () => {
    const sections = buildResourceMetricSections({
      resources: [
        { type: 'kubernetes', kind: 'Service' },
        { type: 'kubernetes', kind: 'Service' },
        { type: 'kubernetes', kind: 'Service' },
        { type: 'kubernetes', kind: 'Ingress' },
        { type: 's3' },
      ],
      metricsByResourceType: [],
    })

    const count = key => sections.find(section => section.key === key).kpis[0]
    expect(count('kubernetes:Service').labelKey).toBe('apm.resourceCountKpi')
    expect(count('kubernetes:Service').value).toBe('3')
    expect(count('kubernetes:Ingress').value).toBe('1')
    expect(count('s3').value).toBe('1')
    expect(count('s3').detailKey).toBe('apm.topologyOnly')
    expect(count('kubernetes:Ingress').detailKey).toBe(null)
  })

  it('does not repeat pod counters on kinds where they would restate the section itself', () => {
    const sections = buildResourceMetricSections({
      resources: [
        { type: 'kubernetes', kind: 'Pod' },
        { type: 'kubernetes', kind: 'Service' },
        { type: 'kubernetes', kind: 'Node' },
      ],
      metricsByResourceType: [],
    })
    const ids = key => sections.find(section => section.key === key).kpis.map(kpi => kpi.id)

    // A Pod is one Pod: a ready/total pair here would just restate the resource count.
    expect(ids('kubernetes:Pod')).toEqual(['resourceCount', 'cpu', 'memory', 'restarts'])
    // A Service adds routing, not usage of its own, so CPU/memory are not duplicated from workloads.
    expect(ids('kubernetes:Service')).toEqual(['resourceCount', 'routedPods'])
    expect(ids('kubernetes:Node')).toEqual(['resourceCount', 'cpu', 'memory', 'hostedPods', 'cpuCapacity', 'memoryCapacity'])
  })

  it('reports ingress routing inventory, since no ingress controller traffic is guaranteed', () => {
    const [ingress] = buildResourceMetricSections({
      resources: [{ type: 'kubernetes', kind: 'Ingress' }],
      metricsByResourceType: [
        { resourceType: 'kubernetes', kind: 'Ingress', metricName: 'ingress_rules', sum: 2, count: 1 },
        { resourceType: 'kubernetes', kind: 'Ingress', metricName: 'ingress_tls_hosts', sum: 1, count: 1 },
      ],
    })

    expect(ingress.collectsMetrics).toBe(true)
    expect(ingress.kpis.find(kpi => kpi.id === 'rules').value).toBe('2')
    expect(ingress.kpis.find(kpi => kpi.id === 'tls').value).toBe('1')
    // Inventory has no meaningful time series, so it must not render empty charts.
    expect(ingress.charts).toEqual([])
  })

  it('sorts sections that report metrics before topology-only ones', () => {
    const sections = buildResourceMetricSections({
      resources: [{ type: 's3' }, { type: 'lambda' }],
      metricsByResourceType: [],
    })
    expect(sections.map(section => section.resourceType)).toEqual(['lambda', 's3'])
  })

  it('never reports a value when the metric is missing, instead of showing a misleading zero', () => {
    const sections = buildResourceMetricSections({
      resources: [{ type: 'lambda' }],
      metricsByResourceType: [],
    })
    // The inventory count is always answerable; the collected metrics are not.
    const collected = sections[0].kpis.filter(kpi => kpi.id !== 'resourceCount')
    expect(collected.every(kpi => kpi.value === '-')).toBe(true)
    expect(sections[0].hasData).toBe(false)
  })

  it('treats unknown and future resource types as topology-only instead of throwing', () => {
    expect(catalogFor('some-future-cloud-service').charts).toEqual([])
    expect(catalogFor('kubernetes', 'ConfigMap').charts).toEqual([])
    expect(catalogFor('kubernetes', 'Deployment').charts.length).toBeGreaterThan(0)
  })

  it('formats each metric unit consistently', () => {
    expect(formatMetricValue(null, 'bytes')).toBe('-')
    expect(formatMetricValue(1536 * 1024 ** 2, 'bytes')).toBe('1.50 GiB')
    expect(formatMetricValue(12.345, 'ms')).toBe('12.3 ms')
    expect(formatMetricValue(0.1234, 'cores')).toBe('0.123 cores')
  })
})
