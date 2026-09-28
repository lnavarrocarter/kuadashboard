'use strict';

const { resolveMetricRows } = require('./cloudwatchDashboardData');

// CloudWatch dashboards: console links and a readable summary of a
// dashboard's widgets, built from the JSON body GetDashboard returns.

/** AWS console host for a region's partition (commercial, China, GovCloud). */
function consoleHost(region = 'us-east-1') {
  if (region.startsWith('cn-')) return `https://${region}.console.amazonaws.cn`;
  if (region.startsWith('us-gov-')) return `https://${region}.console.amazonaws-us-gov.com`;
  return `https://${region}.console.aws.amazon.com`;
}

function dashboardConsoleUrl(region, name) {
  const target = region || 'us-east-1';
  return `${consoleHost(target)}/cloudwatch/home?region=${target}#dashboards/dashboard/${encodeURIComponent(name)}`;
}

function markdownTitle(markdown = '') {
  const line = String(markdown).split('\n').map(l => l.trim()).find(Boolean) || '';
  return line.replace(/^#+\s*/, '').replace(/[*_`]/g, '').slice(0, 120) || null;
}

/** Summary of one widget: type, title, region and what it shows. */
function summarizeWidget(widget = {}, defaultRegion = null) {
  const type = widget.type || 'unknown';
  const props = widget.properties || {};
  const summary = {
    type,
    title: props.title || null,
    region: props.region || defaultRegion,
    view: props.view || null,
    position: { x: widget.x ?? null, y: widget.y ?? null, width: widget.width ?? null, height: widget.height ?? null },
  };
  if (type === 'metric') {
    const rows = resolveMetricRows(props.metrics);
    summary.metrics = rows.length;
    summary.namespaces = [...new Set(rows.map(row => row.namespace).filter(Boolean))];
    summary.expressions = rows.filter(row => row.kind === 'expression').length;
    summary.alarmAnnotations = (props.annotations?.alarms || []).length;
    summary.title = summary.title || rows.find(row => row.metricName)?.metricName || null;
  } else if (type === 'log') {
    summary.query = props.query ? String(props.query).trim() : null;
    summary.logGroups = (String(props.query || '').match(/SOURCE\s+'([^']+)'/g) || []).map(s => s.replace(/SOURCE\s+'|'$/g, ''));
  } else if (type === 'alarm') {
    summary.alarms = (props.alarms || []).length;
  } else if (type === 'text') {
    summary.title = summary.title || markdownTitle(props.markdown);
  } else if (type === 'explorer') {
    summary.metrics = (props.metrics || []).length;
  }
  return summary;
}

/** Parses a GetDashboard body and summarizes its widgets. */
function summarizeDashboard(dashboardBody, { defaultRegion = null } = {}) {
  let body;
  try {
    body = typeof dashboardBody === 'string' ? JSON.parse(dashboardBody) : (dashboardBody || {});
  } catch {
    return { valid: false, widgets: [], counts: {}, regions: [], metricCount: 0 };
  }
  // `index` is the widget's position in the definition, which the data routes use.
  const widgets = (body.widgets || [])
    .map((widget, index) => ({ index, ...summarizeWidget(widget, defaultRegion) }))
    .sort((a, b) => (a.position.y ?? 0) - (b.position.y ?? 0) || (a.position.x ?? 0) - (b.position.x ?? 0));
  const counts = {};
  widgets.forEach(widget => { counts[widget.type] = (counts[widget.type] || 0) + 1; });
  return {
    valid: true,
    widgets,
    counts,
    regions: [...new Set(widgets.map(w => w.region).filter(Boolean))].sort(),
    metricCount: widgets.reduce((sum, w) => sum + (w.metrics || 0), 0),
    periodOverride: body.periodOverride || null,
    start: body.start || null,
  };
}

module.exports = { dashboardConsoleUrl, summarizeWidget, summarizeDashboard };
