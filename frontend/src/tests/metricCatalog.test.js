import { afterEach, describe, expect, it } from 'vitest'
import { buildResourceMetricSections, catalogFor, estimateCloudWatchMonthlyCost, formatMetricValue } from '../components/cloud/apm/metricCatalog'
import { settings } from '../composables/useSettings'

describe('metricCatalog', () => {
  it('builds one section per resource type present in the application', () => {
    const sections = buildResourceMetricSections({
      resources: [
        { type: 'lambda' },
        { type: 'lambda' },
        { type: 'sqs' },
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

    // SQS is discoverable and correlated, but no collector reports metrics for it yet:
    // it must still be listed so the gap is visible instead of silently omitted.
    const sqs = sections.find(section => section.resourceType === 'sqs')
    expect(sqs.resourceCount).toBe(1)
    expect(sqs.collectsMetrics).toBe(false)
    expect(sqs.charts).toEqual([])
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
        { type: 'sqs' },
      ],
      metricsByResourceType: [],
    })

    const count = key => sections.find(section => section.key === key).kpis[0]
    expect(count('kubernetes:Service').labelKey).toBe('apm.resourceCountKpi')
    expect(count('kubernetes:Service').value).toBe('3')
    expect(count('kubernetes:Ingress').value).toBe('1')
    expect(count('sqs').value).toBe('1')
    expect(count('sqs').detailKey).toBe('apm.topologyOnly')
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
    expect(ids('kubernetes:Pod')).toEqual(['resourceCount', 'cpu', 'memory', 'logs', 'restarts'])
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
      resources: [{ type: 'sqs' }, { type: 'lambda' }],
      metricsByResourceType: [],
    })
    expect(sections.map(section => section.resourceType)).toEqual(['lambda', 'sqs'])
  })

  it('reports EC2 and S3 metrics now that CloudWatch is collected for them', () => {
    const sections = buildResourceMetricSections({
      resources: [{ type: 'ec2' }, { type: 's3' }],
      metricsByResourceType: [
        { resourceType: 'ec2', kind: '', metricName: 'cpu_percent', sum: 84, count: 2 },
        { resourceType: 's3', kind: '', metricName: 'storage_bytes', sum: 2 * 1024 ** 3, count: 1 },
      ],
    })

    const ec2 = sections.find(section => section.resourceType === 'ec2')
    expect(ec2.collectsMetrics).toBe(true)
    expect(ec2.kpis.find(kpi => kpi.id === 'cpu').value).toBe('42.0%')

    const s3 = sections.find(section => section.resourceType === 's3')
    expect(s3.kpis.find(kpi => kpi.id === 'storage').value).toBe('2.00 GiB')
  })

  it('estimates CloudWatch charges and reads per month at a 30-minute collection interval', () => {
    const estimate = estimateCloudWatchMonthlyCost([
      {
        type: 'elb',
        arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/orders/abcdef0123456789',
        metadata: { targetGroups: ['arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/orders/0123456789abcdef'] },
      },
      { type: 'elb', arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/edge/abcdef0123456789' },
    ])

    expect(estimate.metricsPerCollection).toBe(11)
    expect(estimate.requestsPerMonth).toBe(2880)
    expect(estimate.monthlyUsd).toBeCloseTo(0.1584)
  })

  it('shows ELB request, error, latency and per-target-group health metrics', () => {
    const [section] = buildResourceMetricSections({
      resources: [{ type: 'elb' }],
      metricsByResourceType: [
        { resourceType: 'elb', kind: '', metricName: 'elb_request_count', sum: 100, count: 1 },
        { resourceType: 'elb', kind: '', metricName: 'elb_target_5xx_count', sum: 4, count: 1 },
        { resourceType: 'elb', kind: '', metricName: 'elb_5xx_count', sum: 1, count: 1 },
        { resourceType: 'elb', kind: '', metricName: 'elb_target_response_time_p95_ms', sum: 800, count: 1 },
        { resourceType: 'elb', kind: '', metricName: 'elb_healthy_host_count_orders_api', sum: 3, count: 1 },
        { resourceType: 'elb', kind: '', metricName: 'elb_unhealthy_host_count_orders_api', sum: 1, count: 1 },
      ],
    })

    expect(section.collectsMetrics).toBe(true)
    expect(section.kpis.find(kpi => kpi.id === 'errorRate').value).toBe('5.0%')
    expect(section.kpis.find(kpi => kpi.id === 'latencyP95').value).toBe('800 ms')
    expect(section.kpis.find(kpi => kpi.id === 'elb_healthy_host_count_orders_api').value).toBe('3')
    expect(section.charts.map(chart => chart.metric)).toContain('elb_healthy_host_count_orders_api')
    expect(section.charts.map(chart => chart.metric)).toContain('elb_unhealthy_host_count_orders_api')
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

  it('reports log volume, which the Kubernetes Metrics API never provides', () => {
    const [deployment] = buildResourceMetricSections({
      resources: [{ type: 'kubernetes', kind: 'Deployment' }],
      metricsByResourceType: [
        { resourceType: 'kubernetes', kind: 'Deployment', metricName: 'log_bytes', sum: 8 * 1024 ** 2, count: 2 },
      ],
    })

    expect(deployment.kpis.find(kpi => kpi.id === 'logs').value).toBe('4.0 MiB')
    expect(deployment.charts.some(chart => chart.metric === 'log_bytes')).toBe(true)
  })

  afterEach(() => { settings.lang = 'es' })

  it('formats each metric unit consistently', () => {
    settings.lang = 'en'
    expect(formatMetricValue(null, 'bytes')).toBe('-')
    expect(formatMetricValue(1536 * 1024 ** 2, 'bytes')).toBe('1.50 GiB')
    expect(formatMetricValue(12.345, 'ms')).toBe('12.3 ms')
    expect(formatMetricValue(0.1234, 'cores')).toBe('0.123 cores')
  })

  it('formats numbers in the app language, not the OS locale', () => {
    settings.lang = 'en'
    expect(formatMetricValue(12.345, 'ms')).toBe('12.3 ms')
    expect(formatMetricValue(12345, 'count')).toBe('12,345')
    settings.lang = 'es'
    expect(formatMetricValue(12.345, 'ms')).toBe('12,3 ms')
    expect(formatMetricValue(12345, 'count')).toBe('12.345')
  })
})
