// Presentation helpers for the CloudWatch Logs tab (inventory, local cache, S3 backup).

const HOUR_MS = 60 * 60 * 1000

export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let n = value / 1024
  let unit = 0
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit += 1 }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[unit]}`
}

// Cache windows are whole hours; show days when they are whole days.
export function formatWindow(ms) {
  const hours = Math.round((Number(ms) || 0) / HOUR_MS)
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24} d`
  if (hours >= 48) return `${(hours / 24).toFixed(1)} d`
  return `${hours} h`
}

export function formatTime(ts, lang = 'es') {
  if (!ts) return '—'
  return new Date(ts).toLocaleString(lang === 'en' ? 'en-US' : 'es-ES', { dateStyle: 'short', timeStyle: 'medium' })
}

export function filterGroups(groups, { search = '', kind = 'all', cachedOnly = false } = {}) {
  const q = search.trim().toLowerCase()
  return (groups || []).filter(group =>
    (kind === 'all' || group.kind === kind) &&
    (!cachedOnly || group.cache) &&
    (!q || group.name.toLowerCase().includes(q) || (group.service || '').includes(q)))
}

export function kindCounts(groups) {
  const counts = { all: 0, aws: 0, machine: 0, custom: 0 }
  for (const group of groups || []) {
    counts.all += 1
    counts[group.kind] = (counts[group.kind] || 0) + 1
  }
  return counts
}

export function backupSummary(coverage) {
  const summary = { continuous: 0, export: 0, none: 0, atRisk: 0, unprotectedBytes: 0 }
  for (const row of coverage || []) {
    summary[row.method] = (summary[row.method] || 0) + 1
    if (row.risk) summary.atRisk += 1
    if (row.method === 'none') summary.unprotectedBytes += row.storedBytes || 0
  }
  return summary
}

// Export tasks write to <prefix>/<taskId>/<stream>/<n>.gz
export function exportTaskPrefix(task) {
  if (!task?.bucket) return null
  const prefix = String(task.prefix || 'exportedlogs').replace(/\/+$/, '')
  return { bucket: task.bucket, prefix: `${prefix}/${task.taskId}/` }
}

// Parent "folder" of an S3 prefix (for the archive breadcrumb).
export function parentPrefix(prefix) {
  const parts = String(prefix || '').split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `${parts.join('/')}/` : ''
}

export function cacheUsage(summary) {
  if (!summary?.budgetBytes) return 0
  return Math.min(100, Math.round((summary.totalBytes / summary.budgetBytes) * 100))
}

export const LOG_RANGES = [
  { minutes: 15, label: '15 m' },
  { minutes: 60, label: '1 h' },
  { minutes: 360, label: '6 h' },
  { minutes: 1440, label: '24 h' },
  { minutes: 4320, label: '3 d' },
  { minutes: 10080, label: '7 d' },
]

const DURATION_UNITS = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
const TIME_TEXT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/

// Logs Insights (and the local engine) return times as UTC "YYYY-MM-DD HH:mm:ss.SSS".
function parseResultTime(value) {
  if (typeof value === 'number') return value
  const text = String(value || '').trim()
  if (!TIME_TEXT.test(text)) return NaN
  return Date.parse(`${text.replace(' ', 'T').replace(/Z$/, '')}Z`)
}

/**
 * Turns query results with a time column and numeric columns into chart
 * buckets: { timeField, column, numeric, binMs, buckets: [{ start, value }] }.
 * The bin size comes from bin(5m)-style field names, or the smallest gap.
 */
export function timeSeriesFromRows(fields = [], rows = [], preferredColumn = '') {
  if (!fields?.length || !rows?.length || rows.length < 2) return null
  const timeField = fields.find(f => /^bin\(/i.test(f)) ||
    fields.find(f => rows.every(r => r[f] == null || (typeof r[f] === 'string' && Number.isFinite(parseResultTime(r[f])))) && rows.some(r => r[f] != null))
  if (!timeField) return null
  const numeric = fields.filter(f => f !== timeField && rows.every(r => r[f] == null || r[f] === '' || Number.isFinite(Number(r[f]))) && rows.some(r => r[f] != null && r[f] !== ''))
  if (!numeric.length) return null
  const column = numeric.includes(preferredColumn) ? preferredColumn : numeric[0]
  const points = rows
    .map(r => ({ start: parseResultTime(r[timeField]), value: Number(r[column]) || 0 }))
    .filter(p => Number.isFinite(p.start))
    .sort((a, b) => a.start - b.start)
  if (points.length < 2) return null
  const declared = String(timeField).match(/^bin\((\d+)\s*([smhd])\)$/i)
  const gaps = points.slice(1).map((p, i) => p.start - points[i].start).filter(g => g > 0)
  const binMs = declared ? Number(declared[1]) * DURATION_UNITS[declared[2].toLowerCase()] : Math.min(...gaps)
  if (!Number.isFinite(binMs) || binMs <= 0) return null
  // Fill empty bins so gaps in activity are visible.
  const byStart = new Map(points.map(p => [p.start, p.value]))
  const buckets = []
  for (let t = points[0].start; t <= points[points.length - 1].start && buckets.length < 2000; t += binMs) {
    buckets.push({ start: t, value: byStart.get(t) || 0 })
  }
  return { timeField, column, numeric, binMs, buckets }
}

export const HISTORY_OPTIONS = [
  { hours: 0, key: 'none' },
  { hours: 1, key: '1h' },
  { hours: 6, key: '6h' },
  { hours: 24, key: '24h' },
  { hours: 72, key: '3d' },
  { hours: null, key: 'window' },
]
