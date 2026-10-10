'use strict';
// Cloud Monitoring timeSeries.list for the detail charts (GCP UX audit G06/G07).
// - Aligner/reducer are whitelisted; the caller states how series combine
//   (REDUCE_SUM for totals, REDUCE_PERCENTILE_* over merged distributions).
// - Series keep their identity: one series → `points`; several series (a
//   groupBy) are returned separately and never flattened into one curve.
// - A point without a numeric value is skipped, not drawn as 0.

const ALIGNERS = new Set(['ALIGN_MEAN', 'ALIGN_MAX', 'ALIGN_MIN', 'ALIGN_SUM', 'ALIGN_RATE', 'ALIGN_DELTA',
  'ALIGN_PERCENTILE_99', 'ALIGN_PERCENTILE_95', 'ALIGN_PERCENTILE_50']);
const REDUCERS = new Set(['REDUCE_NONE', 'REDUCE_MEAN', 'REDUCE_SUM', 'REDUCE_MAX', 'REDUCE_MIN', 'REDUCE_COUNT',
  'REDUCE_PERCENTILE_99', 'REDUCE_PERCENTILE_95', 'REDUCE_PERCENTILE_50']);

function timeSeriesParams({ metric, filter = '', hours = 1, aligner = 'ALIGN_MEAN', period = 60, reducer = 'REDUCE_MEAN', groupBy = [] }, now = new Date()) {
  if (!metric || !/^[a-z0-9_./-]+$/i.test(metric)) throw Object.assign(new Error('Invalid metric type'), { code: 400 });
  if (!ALIGNERS.has(aligner)) throw Object.assign(new Error(`Unsupported aligner ${aligner}`), { code: 400 });
  if (!REDUCERS.has(reducer)) throw Object.assign(new Error(`Unsupported reducer ${reducer}`), { code: 400 });
  const h = Math.min(Math.max(Number(hours) || 1, 0.25), 24 * 7);
  const p = Math.min(Math.max(Number(period) || 60, 60), 3600);
  const start = new Date(now.getTime() - h * 3600 * 1000);
  const params = new URLSearchParams({
    filter: filter ? `metric.type="${metric}" AND ${filter}` : `metric.type="${metric}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': now.toISOString(),
    'aggregation.alignmentPeriod': `${p}s`,
    'aggregation.perSeriesAligner': aligner,
    'aggregation.crossSeriesReducer': reducer,
  });
  for (const field of [].concat(groupBy || []).filter(Boolean)) params.append('aggregation.groupByFields', field);
  return { params, interval: { start: start.toISOString(), end: now.toISOString() }, periodSeconds: p };
}

function pointValue(value = {}) {
  if (typeof value.doubleValue === 'number') return value.doubleValue;
  if (value.int64Value != null) return Number(value.int64Value);
  if (value.distributionValue && value.distributionValue.mean != null) return Number(value.distributionValue.mean);
  return null;
}

function normalizeTimeSeries(data = {}, { interval = null } = {}) {
  const series = (data.timeSeries || []).map(ts => {
    const points = (ts.points || [])
      .map(pt => ({ x: pt.interval?.endTime, y: pointValue(pt.value) }))
      .filter(pt => pt.x && Number.isFinite(pt.y))
      .sort((a, b) => new Date(a.x) - new Date(b.x));
    return { metricLabels: ts.metric?.labels || {}, resourceLabels: ts.resource?.labels || {}, unit: ts.unit || '', points };
  });
  const lastSampleAt = series.flatMap(s => s.points.map(p => p.x)).sort().at(-1) || null;
  return {
    status: series.some(s => s.points.length) ? 'ok' : 'empty',
    points: series.length === 1 ? series[0].points : [],
    series,
    seriesCount: series.length,
    partial: !!data.nextPageToken,
    unit: series[0]?.unit || '',
    interval,
    lastSampleAt,
  };
}

module.exports = { timeSeriesParams, normalizeTimeSeries, pointValue };
