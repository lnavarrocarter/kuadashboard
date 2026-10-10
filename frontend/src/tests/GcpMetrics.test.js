import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { CR_METRICS, VM_METRICS, FN_METRICS, createMetricsPanel, loadMetricSet, loadMetric } from '../components/cloud/gcpMetrics'
import GcpMetricsChart from '../components/cloud/GcpMetricsChart.vue'

vi.mock('chart.js', () => ({ Chart: class { static register() {} destroy() {} }, LineController: {}, LineElement: {}, PointElement: {}, LinearScale: {}, CategoryScale: {}, Filler: {}, Tooltip: {} }))

const svc = { name: 'api', region: 'europe-west1' }

describe('GCP metric contracts (G07)', () => {
  it('totals are summed, percentiles merged and filters carry the region', () => {
    const byKey = Object.fromEntries(CR_METRICS.map(m => [m.key, m]))
    expect(byKey.requests.reducer).toBe('REDUCE_SUM')
    expect(byKey.instances.reducer).toBe('REDUCE_SUM')
    expect(byKey.latency).toMatchObject({ aligner: 'ALIGN_DELTA', reducer: 'REDUCE_PERCENTILE_99' })
    for (const m of CR_METRICS) expect(m.filter(svc)).toContain('resource.labels.location="europe-west1"')
    expect(FN_METRICS[0].filter({ name: 'f', location: 'us-east1' })).toContain('resource.labels.region="us-east1"')
    expect(VM_METRICS[0].filter({ instanceId: '1', zone: 'us-central1-a' })).toContain('resource.labels.zone="us-central1-a"')
  })

  it('CPU ratios become percentages once', async () => {
    const panel = createMetricsPanel()
    await loadMetric(async () => ({ points: [{ x: 'a', y: 0.25 }], seriesCount: 1 }), panel, VM_METRICS[0], { instanceId: '1' })
    expect(panel.data.cpu[0].y).toBe(25)
  })
})

describe('per-metric states (G06)', () => {
  it('a failed query is an error for that metric only; empty stays empty', async () => {
    const panel = createMetricsPanel()
    const fetchSeries = vi.fn(async metric => {
      if (metric.includes('request_latencies')) throw Object.assign(new Error('denied'), { details: { errorInfo: { kind: 'permission' } } })
      if (metric.includes('instance_count')) return { points: [], seriesCount: 0 }
      return { points: [{ x: '2026-10-10T10:00:00Z', y: 2 }], seriesCount: 1, lastSampleAt: '2026-10-10T10:00:00Z' }
    })
    await loadMetricSet(fetchSeries, panel, CR_METRICS, svc)
    expect(panel.state.requests.status).toBe('ok')
    expect(panel.state.latency).toMatchObject({ status: 'error', errorKind: 'permission' })
    expect(panel.state.instances.status).toBe('empty')
    expect(panel.error).toBeNull()

    // Retry only reloads the failed metric
    fetchSeries.mockClear()
    await loadMetric(async () => ({ points: [{ x: 'b', y: 120 }], seriesCount: 1 }), panel, CR_METRICS[1], svc)
    expect(panel.state.latency.status).toBe('ok')
    expect(panel.state.requests.status).toBe('ok')
  })

  it('the chart shows the error with Retry, and "no samples" for an empty series', async () => {
    const err = mount(GcpMetricsChart, { props: { label: 'Latency', state: { status: 'error', error: 'denied', errorKind: 'permission' } } })
    expect(err.text()).toContain('Insufficient permission')
    expect(err.text()).not.toContain('No data')
    await err.find('button').trigger('click')
    expect(err.emitted('retry')).toHaveLength(1)
    const empty = mount(GcpMetricsChart, { props: { label: 'Instances', points: [], state: { status: 'empty' } } })
    expect(empty.text()).toContain('No samples in this range')
  })
})
