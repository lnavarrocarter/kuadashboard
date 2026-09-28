// Shared helpers for CloudWatch dashboard widgets.

// CloudWatch's default series colors, so widgets match the AWS console and the
// explicit `color` values dashboards already use.
export const CLOUDWATCH_PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
]

export function seriesColor(series, index) {
  return series.color || CLOUDWATCH_PALETTE[index % CLOUDWATCH_PALETTE.length]
}

export function formatNumber(value, lang = 'en') {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  const abs = Math.abs(n)
  const locale = lang === 'es' ? 'es' : 'en-US'
  if (abs >= 1e9) return `${(n / 1e9).toLocaleString(locale, { maximumFractionDigits: 1 })}B`
  if (abs >= 1e6) return `${(n / 1e6).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
  if (abs >= 1e4) return `${(n / 1e3).toLocaleString(locale, { maximumFractionDigits: 1 })}k`
  return n.toLocaleString(locale, { maximumFractionDigits: abs < 10 ? 2 : 1 })
}

export function formatBytes(value) {
  if (value == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = Number(value)
  let unit = 0
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1 }
  return `${n.toFixed(n >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export function lastValue(points = []) {
  return points.length ? points[points.length - 1].v : null
}

/** Time range presets (seconds) offered by the dashboard view. */
export const RANGE_PRESETS = [3600, 3 * 3600, 12 * 3600, 86400, 3 * 86400, 7 * 86400, 30 * 86400]

export function rangeLabel(seconds) {
  if (seconds % 86400 === 0) return seconds / 86400 === 7 ? '1w' : `${seconds / 86400}d`
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  return `${Math.round(seconds / 60)}m`
}

/** First column whose values are all numeric (for log bar charts). */
export function numericField(fields, rows) {
  return fields.find(field => rows.length && rows.every(row => row[field] == null || row[field] === '' || Number.isFinite(Number(row[field]))))
}
