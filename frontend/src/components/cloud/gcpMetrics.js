// Cloud Monitoring chart contracts for the GCP detail panels (UX audit G06/G07).
//
// Each metric states unit, alignment, how series combine and its scope:
//   - totals are summed across series (REDUCE_SUM), never averaged;
//   - percentiles are computed over the merged distribution (ALIGN_DELTA +
//     REDUCE_PERCENTILE_99), not as a mean of per-series p99;
//   - filters include the region/zone so homonyms elsewhere stay out;
//   - ratios (0–1) are scaled to % once, here, via the scale factor.
// Every metric loads on its own: a failed query is an error state for that
// chart, not an empty series, and can be retried alone.

const crFilter = s => `resource.type="cloud_run_revision" AND resource.labels.service_name="${s.name}"${s.region ? ` AND resource.labels.location="${s.region}"` : ''}`
const vmFilter = s => `resource.type="gce_instance" AND resource.labels.instance_id="${s.instanceId || s.name}"${s.zone ? ` AND resource.labels.zone="${s.zone}"` : ''}`
const sqlFilter = s => `resource.type="cloudsql_database" AND resource.labels.database_id=ends_with(":${s.name}")`
const fnFilter = f => `resource.type="cloud_function" AND resource.labels.function_name="${f.name}"${f.location ? ` AND resource.labels.region="${f.location}"` : ''}`

export const CR_METRICS = [
  { key: 'requests', metric: 'run.googleapis.com/request_count', filter: crFilter,
    aligner: 'ALIGN_RATE', reducer: 'REDUCE_SUM', label: 'gcpv.metricRequestRate', unit: 'req/s', note: 'gcpv.audit.agg.sumRevisions', color: '#818cf8' },
  { key: 'latency', metric: 'run.googleapis.com/request_latencies', filter: crFilter,
    aligner: 'ALIGN_DELTA', reducer: 'REDUCE_PERCENTILE_99', label: 'gcpv.metricLatencyP99', unit: 'ms', note: 'gcpv.audit.agg.p99Merged', color: '#f59e0b' },
  { key: 'instances', metric: 'run.googleapis.com/container/instance_count', filter: crFilter,
    aligner: 'ALIGN_MEAN', reducer: 'REDUCE_SUM', label: 'gcpv.audit.metric.avgInstances', unit: '', note: 'gcpv.audit.agg.avgInstances', color: '#34d399' },
]

export const VM_METRICS = [
  { key: 'cpu', metric: 'compute.googleapis.com/instance/cpu/utilization', filter: vmFilter,
    aligner: 'ALIGN_MEAN', reducer: 'REDUCE_MEAN', scale: 100, label: 'gcpv.metricCpu', unit: '%', note: 'gcpv.audit.agg.meanPerPeriod', color: '#f87171' },
  { key: 'netIn', metric: 'compute.googleapis.com/instance/network/received_bytes_count', filter: vmFilter,
    aligner: 'ALIGN_RATE', reducer: 'REDUCE_SUM', label: 'ec2d.networkIn', unit: 'B/s', note: 'gcpv.audit.agg.sumInterfaces', color: '#818cf8' },
  { key: 'diskRead', metric: 'compute.googleapis.com/instance/disk/read_bytes_count', filter: vmFilter,
    aligner: 'ALIGN_RATE', reducer: 'REDUCE_SUM', label: 'ec2d.diskRead', unit: 'B/s', note: 'gcpv.audit.agg.sumDevices', color: '#34d399' },
]

export const SQL_METRICS = [
  { key: 'cpu', metric: 'cloudsql.googleapis.com/database/cpu/utilization', filter: sqlFilter,
    aligner: 'ALIGN_MEAN', reducer: 'REDUCE_MEAN', scale: 100, label: 'gcpv.metricCpu', unit: '%', note: 'gcpv.audit.agg.meanPerPeriod', color: '#f87171' },
  { key: 'connections', metric: 'cloudsql.googleapis.com/database/network/connections', filter: sqlFilter,
    aligner: 'ALIGN_MEAN', reducer: 'REDUCE_SUM', label: 'gcpv.metricConnections', unit: '', note: 'gcpv.audit.agg.sumDatabases', color: '#818cf8' },
  { key: 'diskBytes', metric: 'cloudsql.googleapis.com/database/disk/bytes_used', filter: sqlFilter,
    aligner: 'ALIGN_MEAN', reducer: 'REDUCE_SUM', label: 'gcpv.metricDiskUsed', unit: 'B', note: 'gcpv.audit.agg.meanPerPeriod', color: '#34d399' },
]

export const FN_METRICS = [
  { key: 'executions', metric: 'cloudfunctions.googleapis.com/function/execution_count', filter: fnFilter,
    aligner: 'ALIGN_RATE', reducer: 'REDUCE_SUM', label: 'gcpv.metricExecutions', unit: 'req/s', note: 'gcpv.audit.agg.sumStatuses', color: '#818cf8' },
  { key: 'duration', metric: 'cloudfunctions.googleapis.com/function/execution_times', filter: fnFilter,
    aligner: 'ALIGN_DELTA', reducer: 'REDUCE_PERCENTILE_99', scale: 1e-6, label: 'gcpv.metricDurationP99', unit: 'ms', note: 'gcpv.audit.agg.p99Merged', color: '#f59e0b' },
  { key: 'active', metric: 'cloudfunctions.googleapis.com/function/active_instances', filter: fnFilter,
    aligner: 'ALIGN_MEAN', reducer: 'REDUCE_SUM', label: 'gcpv.metricActiveInstances', unit: '', note: 'gcpv.audit.agg.avgInstances', color: '#34d399' },
]

export function createMetricsPanel() {
  return { loading: false, error: null, hours: 1, data: {}, state: {} }
}

export function scalePoints(points = [], scale = 1) {
  return scale === 1 ? points : points.map(p => ({ ...p, y: p.y * scale }))
}

// Loads one metric into panel.data/panel.state. Errors stay on that metric.
export async function loadMetric(fetchSeries, panel, m, target) {
  panel.state = { ...panel.state, [m.key]: { status: 'loading' } }
  try {
    const res = await fetchSeries(m.metric, m.filter(target), {
      hours: panel.hours, aligner: m.aligner, period: m.period || '60', reducer: m.reducer,
    })
    const points = scalePoints(res?.points || [], m.scale || 1)
    // Several series (unexpected without groupBy) are reported, not merged.
    const multi = (res?.seriesCount || 0) > 1 && !points.length
    panel.data = { ...panel.data, [m.key]: points }
    panel.state = { ...panel.state, [m.key]: {
      status: multi ? 'multi' : points.length ? 'ok' : 'empty',
      lastSampleAt: res?.lastSampleAt || null,
      interval: res?.interval || null,
      seriesCount: res?.seriesCount || 0,
      partial: !!res?.partial,
    } }
  } catch (e) {
    panel.data = { ...panel.data, [m.key]: [] }
    panel.state = { ...panel.state, [m.key]: { status: 'error', error: e.message, errorKind: e.details?.errorInfo?.kind || 'unknown' } }
  }
}

export async function loadMetricSet(fetchSeries, panel, metrics, target) {
  panel.loading = true; panel.error = null; panel.data = {}; panel.state = {}
  try { await Promise.all(metrics.map(m => loadMetric(fetchSeries, panel, m, target))) }
  finally { panel.loading = false }
}
