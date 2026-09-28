'use strict';

// Data for rendering CloudWatch dashboard widgets inside KUA. The server builds
// every query from the dashboard definition stored in AWS (the client only
// names a dashboard and a widget index), so no free-form queries are accepted.

const DEFAULT_RANGE_S = 3 * 3600;
const NICE_PERIODS = [60, 300, 900, 1800, 3600, 21600, 86400];
const MAX_POINTS = 360;
const LOGS_AUTO_RUN_BYTES = 1024 ** 3; // ~USD 0.005 per run
const LOGS_PRICE_PER_GB = 0.005;

/** ISO-8601 duration ("-PT3H", "-P7D", "PT0H") in seconds; negative means "ago". */
function parseDuration(value) {
  const match = /^(-)?P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, sign, w, d, h, m, s] = match;
  const seconds = (Number(w || 0) * 7 * 86400) + (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(m || 0) * 60) + Number(s || 0);
  return sign ? -seconds : seconds;
}

/** Default time range of a dashboard (its `start`, e.g. "-P7D"), in seconds. */
function dashboardRangeSeconds(body = {}) {
  const start = parseDuration(body.start);
  return start && start < 0 ? -start : DEFAULT_RANGE_S;
}

/** Period CloudWatch would use: the widget's, or one that keeps the series under ~360 points. */
function choosePeriod(rangeSeconds, widgetPeriod, setPeriodToTimeRange = false) {
  if (setPeriodToTimeRange) return Math.max(60, Math.ceil(rangeSeconds / 60) * 60);
  if (widgetPeriod) return Number(widgetPeriod);
  return NICE_PERIODS.find(p => rangeSeconds / p <= MAX_POINTS) || 86400;
}

/**
 * Resolves the rows of a metric widget: "." repeats the previous row's value at
 * that position and "..." repeats the previous row, replacing its last values.
 */
function resolveMetricRows(metrics = []) {
  const rows = [];
  let previous = [];
  for (const raw of Array.isArray(metrics) ? metrics : []) {
    if (!Array.isArray(raw)) continue;
    const options = raw.find(item => item && typeof item === 'object') || {};
    if (options.expression) {
      rows.push({ kind: 'expression', expression: options.expression, options });
      continue;
    }
    const values = raw.filter(item => typeof item === 'string');
    let resolved;
    if (values[0] === '...') {
      const replacements = values.slice(1);
      resolved = [...previous.slice(0, previous.length - replacements.length), ...replacements];
    } else {
      resolved = values.map((value, i) => (value === '.' ? previous[i] : value));
    }
    if (!resolved[0] || !resolved[1]) continue;
    previous = resolved;
    const dimensions = [];
    for (let i = 2; i + 1 < resolved.length; i += 2) dimensions.push({ Name: resolved[i], Value: resolved[i + 1] });
    rows.push({ kind: 'metric', namespace: resolved[0], metricName: resolved[1], dimensions, options });
  }
  return rows;
}

function metricLabel(row) {
  if (row.options.label) return row.options.label;
  if (row.kind === 'expression') return row.options.id || row.expression;
  const dims = row.dimensions.map(d => d.Value).join(' ');
  return dims ? `${row.metricName} ${dims}` : row.metricName;
}

/** GetMetricData queries plus series metadata (label, color, axis) for a metric widget. */
function buildMetricQueries(widget = {}, { period }) {
  const props = widget.properties || {};
  const rows = resolveMetricRows(props.metrics);
  const used = new Set(rows.map(row => row.options.id).filter(Boolean));
  let counter = 0;
  const nextId = () => {
    let id;
    do { id = `kua${counter++}`; } while (used.has(id));
    return id;
  };
  const queries = [];
  const series = [];
  for (const row of rows) {
    const id = row.options.id || nextId();
    const visible = row.options.visible !== false;
    const rowPeriod = Number(row.options.period) || period;
    if (row.kind === 'expression') {
      queries.push({ Id: id, Expression: row.expression, Label: row.options.label || undefined, Period: rowPeriod, ReturnData: visible });
    } else {
      queries.push({
        Id: id,
        MetricStat: {
          Metric: { Namespace: row.namespace, MetricName: row.metricName, Dimensions: row.dimensions },
          Period: rowPeriod,
          Stat: row.options.stat || props.stat || 'Average',
        },
        Label: row.options.label || undefined,
        ReturnData: visible,
      });
    }
    if (visible) {
      series.push({ id, label: metricLabel(row), color: row.options.color || null, yAxis: row.options.yAxis === 'right' ? 'right' : 'left', expression: row.kind === 'expression' });
    }
  }
  return { queries, series };
}

function alarmNameFromArn(arn) {
  const index = String(arn).indexOf(':alarm:');
  return index >= 0 ? String(arn).slice(index + 7) : String(arn);
}

/** Queries that draw an alarm's metric (single metric or metric math), like the console does for alarm annotations. */
function alarmQueries(alarm, prefix) {
  if (Array.isArray(alarm.Metrics) && alarm.Metrics.length) {
    return alarm.Metrics.map(m => ({
      Id: `${prefix}_${m.Id}`,
      ...(m.Expression
        ? { Expression: m.Expression.replace(/\b([a-z][A-Za-z0-9_]*)\b/g, id => (alarm.Metrics.some(x => x.Id === id) ? `${prefix}_${id}` : id)) }
        : { MetricStat: { ...m.MetricStat } }),
      Label: m.Label || undefined,
      ReturnData: !!m.ReturnData,
      ...(m.Period ? { Period: m.Period } : {}),
    }));
  }
  return [{
    Id: `${prefix}_m`,
    MetricStat: {
      Metric: { Namespace: alarm.Namespace, MetricName: alarm.MetricName, Dimensions: alarm.Dimensions || [] },
      Period: alarm.Period || 300,
      Stat: alarm.ExtendedStatistic || alarm.Statistic || 'Average',
    },
    Label: alarm.AlarmName,
    ReturnData: true,
  }];
}

function toPoints(result) {
  return (result.Timestamps || [])
    .map((t, i) => ({ t: new Date(t).getTime(), v: result.Values[i] }))
    .filter(p => Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
}

/**
 * Runs a metric widget. GetMetricData pages with NextToken; expressions that
 * return several series (SEARCH, SQL GROUP BY) come back as extra results.
 */
async function fetchMetricWidget(widget, { client, commands, start, end, now = Date.now() }) {
  const props = widget.properties || {};
  const rangeSeconds = Math.max(60, Math.round((end - start) / 1000));
  const period = choosePeriod(rangeSeconds, props.period, props.setPeriodToTimeRange);
  const { queries, series } = buildMetricQueries(widget, { period });
  const horizontal = (props.annotations?.horizontal || []).filter(a => Number.isFinite(Number(a.value)))
    .map(a => ({ value: Number(a.value), label: a.label || null, color: a.color || null, yAxis: a.yAxis === 'right' ? 'right' : 'left' }));

  const alarms = [];
  const alarmArns = props.annotations?.alarms || [];
  if (alarmArns.length) {
    const described = await client.send(new commands.DescribeAlarmsCommand({ AlarmNames: alarmArns.map(alarmNameFromArn) }));
    (described.MetricAlarms || []).forEach((alarm, i) => {
      const prefix = `alarm${i}`;
      const extra = alarmQueries(alarm, prefix);
      queries.push(...extra);
      extra.filter(q => q.ReturnData).forEach(q => series.push({ id: q.Id, label: alarm.AlarmName, color: null, yAxis: 'left', alarm: true }));
      if (Number.isFinite(alarm.Threshold)) horizontal.push({ value: alarm.Threshold, label: `${alarm.AlarmName} (${alarm.ComparisonOperator || ''})`, color: '#d62728', yAxis: 'left' });
      alarms.push({ name: alarm.AlarmName, state: alarm.StateValue, reason: alarm.StateReason || null, threshold: alarm.Threshold ?? null });
    });
  }
  if (!queries.length) return { period, series: [], horizontal, alarms, rangeSeconds };

  // A period longer than the range (e.g. 30-day totals on a 3h dashboard) still
  // needs one full period of data, as the console does.
  const queryStart = Math.min(start, end - period * 1000);
  const results = new Map();
  let token;
  do {
    const response = await client.send(new commands.GetMetricDataCommand({
      StartTime: new Date(queryStart), EndTime: new Date(end), MetricDataQueries: queries, ScanBy: 'TimestampAscending', NextToken: token,
    }));
    // SQL GROUP BY and SEARCH return several results with the same Id and different labels.
    for (const result of response.MetricDataResults || []) {
      const key = `${result.Id}\u0000${result.Label || ''}`;
      const entry = results.get(key) || { id: result.Id, label: result.Label, points: [] };
      entry.points.push(...toPoints(result));
      results.set(key, entry);
    }
    token = response.NextToken;
  } while (token);

  const byId = new Map(series.map(s => [s.id, s]));
  const out = [];
  for (const result of results.values()) {
    const meta = byId.get(result.id) || { id: result.id, label: result.label, color: null, yAxis: 'left' };
    // Multi-series expressions label each series; keep the widget's label only for single results.
    const label = meta.expression || meta.alarm ? (result.label || meta.label) : meta.label;
    out.push({ ...meta, label, points: result.points.sort((a, b) => a.t - b.t) });
  }
  return { period, series: out, horizontal, alarms, rangeSeconds, generatedAt: new Date(now).toISOString() };
}

/** Splits a dashboard log query ("SOURCE 'a' | SOURCE 'b' | fields …") into log groups and the Logs Insights query. */
function splitLogQuery(query = '') {
  const logGroups = [];
  let rest = String(query).trim();
  const sourceRe = /^SOURCE\s+(?:'([^']+)'|"([^"]+)")\s*(?:\|\s*)?/i;
  let match;
  while ((match = sourceRe.exec(rest))) {
    logGroups.push(match[1] || match[2]);
    rest = rest.slice(match[0].length).trim();
  }
  return { logGroups, queryString: rest.replace(/^\|\s*/, '') };
}

/**
 * Rough bytes a Logs Insights query will scan over the range: the group's
 * stored bytes spread over its retention (or age). Stored data is compressed,
 * so the real scan is usually larger; the UI calls this an estimate.
 */
function estimateLogScan(groups = [], rangeSeconds, now = Date.now()) {
  const items = groups.map(group => {
    if (!group.found) return { name: group.name, found: false, estimatedBytes: 0 };
    const ageDays = Math.max(1, (now - (group.creationTime || now)) / 86400000);
    const spanDays = Math.max(1, Math.min(group.retentionInDays || ageDays, ageDays));
    const perDay = (group.storedBytes || 0) / spanDays;
    return { name: group.name, found: true, storedBytes: group.storedBytes || 0, estimatedBytes: Math.round(perDay * (rangeSeconds / 86400)) };
  });
  const estimatedBytes = items.reduce((sum, item) => sum + item.estimatedBytes, 0);
  return {
    logGroups: items,
    estimatedBytes,
    estimatedCostUsd: Math.round((estimatedBytes / 1024 ** 3) * LOGS_PRICE_PER_GB * 10000) / 10000,
    autoRun: estimatedBytes <= LOGS_AUTO_RUN_BYTES && items.some(item => item.found),
  };
}

/** GetQueryResults → ordered fields (without @ptr) and plain rows. */
function normalizeQueryResults(response = {}) {
  const fields = [];
  const rows = (response.results || []).map(row => {
    const record = {};
    for (const cell of row || []) {
      if (!cell?.field || cell.field === '@ptr') continue;
      if (!fields.includes(cell.field)) fields.push(cell.field);
      record[cell.field] = cell.value;
    }
    return record;
  });
  const stats = response.statistics || {};
  return {
    status: response.status || 'Unknown',
    fields,
    rows,
    statistics: { bytesScanned: stats.bytesScanned ?? null, recordsMatched: stats.recordsMatched ?? null, recordsScanned: stats.recordsScanned ?? null },
  };
}

/** Alarm widget: current state of each alarm. */
async function fetchAlarmWidget(widget, { client, commands }) {
  const names = (widget.properties?.alarms || []).map(alarmNameFromArn);
  if (!names.length) return { alarms: [] };
  const response = await client.send(new commands.DescribeAlarmsCommand({ AlarmNames: names, AlarmTypes: ['MetricAlarm', 'CompositeAlarm'] }));
  const alarms = [...(response.MetricAlarms || []), ...(response.CompositeAlarms || [])].map(alarm => ({
    name: alarm.AlarmName, state: alarm.StateValue, reason: alarm.StateReason || null, updated: alarm.StateUpdatedTimestamp || null,
  }));
  return { alarms, missing: names.filter(name => !alarms.some(alarm => alarm.name === name)) };
}

module.exports = {
  LOGS_AUTO_RUN_BYTES,
  parseDuration,
  dashboardRangeSeconds,
  choosePeriod,
  resolveMetricRows,
  buildMetricQueries,
  alarmNameFromArn,
  alarmQueries,
  fetchMetricWidget,
  splitLogQuery,
  estimateLogScan,
  normalizeQueryResults,
  fetchAlarmWidget,
};
