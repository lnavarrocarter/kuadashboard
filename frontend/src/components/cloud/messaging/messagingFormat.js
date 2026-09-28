// Formatting shared by the SQS, SNS and SES tabs.

export function localeFor(lang) {
  return lang === 'es' ? 'es' : 'en-US'
}

export function formatCount(value, lang = 'en') {
  if (value == null) return '—'
  return Number(value).toLocaleString(localeFor(lang))
}

// 345600 → "4 d", 5400 → "1.5 h", 90 → "1.5 min", 20 → "20 s"
export function formatDuration(seconds) {
  if (seconds == null) return '—'
  const s = Number(seconds)
  const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  if (s >= 86400) return `${fmt(s / 86400)} d`
  if (s >= 3600) return `${fmt(s / 3600)} h`
  if (s >= 60) return `${fmt(s / 60)} min`
  return `${s} s`
}

export function formatDate(ms, lang = 'en') {
  if (!ms) return '—'
  return new Date(ms).toLocaleString(localeFor(lang), { dateStyle: 'short', timeStyle: 'short' })
}

export function filterRows(rows, query) {
  if (!query) return rows
  const q = query.toLowerCase()
  return rows.filter(row => JSON.stringify(row).toLowerCase().includes(q))
}

// Last segment of an ARN (queue, topic or function name).
export function arnName(arn = '') {
  return String(arn).split(':').pop()
}

// Sort order for health columns: worst first when sorting descending.
export const HEALTH_RANK = { unknown: 0, ok: 1, warning: 2, critical: 3 }
