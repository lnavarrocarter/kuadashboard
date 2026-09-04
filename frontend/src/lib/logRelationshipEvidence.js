// Deterministic, sanitized extraction of relationship evidence from already-classified log lines.
// No ML, no raw payload persistence: every candidate must be confirmed/rejected by a human through
// the existing suggested/rejected relationship review flow before it changes the Architecture graph.

const SECRET_PATTERNS = [
  [/\bauthorization\b\s*:?\s*.*/gi, 'Authorization: [redacted]'],
  [/\b(api[_-]?key|apikey|x-api-key|token|password|secret)\b\s*[:=]\s*\S+/gi, (_, key) => `${key}: [redacted]`],
]
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~-]+/gi
const URL_CREDENTIALS_RE = /\b(https?|postgres(?:ql)?|mysql|redis):\/\/[^/\s@]+@/gi
const URL_QUERY_RE = /(\bhttps?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?)\?[^\s#]*/gi
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

const K8S_DNS_RE = /\b([a-z0-9]([a-z0-9-]*[a-z0-9])?)\.([a-z0-9]([a-z0-9-]*[a-z0-9])?)\.svc(?:\.cluster\.local)?\b/gi
const BARE_HOST_RE = /https?:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)(?::\d+)?\//gi
const ERROR_LINE_RE = /\berror\b|\bexception\b|\bfatal\b|\bpanic\b|\bfail(?:ed|ure)?\b|\btimeout\b|\boomkilled\b|\bcrash(?:ed)?\b|\brefused\b|\bunavailable\b|\bdenied\b/i
const ERROR_KEYWORD_RE = /\b(error|exception|fatal|panic|fail(?:ed|ure)?|timeout|oomkilled|crash(?:ed)?|refused|unavailable|denied)\b/gi
const WARNING_KEYWORD_RE = /\bwarn(?:ing)?\b|\bdegraded\b|\bback[- ]?off\b/gi
const CORRELATION_ID_RE = /\b(?:x-request-id|x-correlation-id|correlation[_-]?id|trace[_-]?id|request[_-]?id)\b\s*[:=]\s*([a-zA-Z0-9-]{8,64})/gi

/** Redacts common secret-shaped substrings from a log line before it is ever kept as evidence. */
function sanitizeLogLine(line) {
  let sanitized = String(line || '')
  for (const [pattern, replacement] of SECRET_PATTERNS) sanitized = sanitized.replace(pattern, replacement)
  sanitized = sanitized
    .replace(BEARER_TOKEN_RE, 'Bearer [redacted]')
    .replace(URL_CREDENTIALS_RE, '$1://[redacted]@')
    .replace(URL_QUERY_RE, '$1?[redacted]')
    .replace(EMAIL_RE, '[redacted-email]')
  return sanitized.trim()
}

/** Normalizes a line into a signature (strips numbers/uuids/timestamps) to group recurring errors. */
function errorSignature(line) {
  return String(line || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?\S*/g, '<timestamp>')
    .replace(/\b\d+\b/g, '<n>')
    .trim()
    .slice(0, 160)
}

/** Finds internal Kubernetes DNS names and bare hostnames referenced in the log stream, deduped with counts. */
function extractServiceReferences(lines = []) {
  const references = new Map()
  for (const rawLine of lines) {
    const line = sanitizeLogLine(rawLine)
    for (const match of line.matchAll(K8S_DNS_RE)) {
      const service = match[1]
      const namespace = match[3]
      const key = `${service}.${namespace}`
      const entry = references.get(key) || { service, namespace, occurrences: 0, sample: line.slice(0, 200) }
      entry.occurrences += 1
      references.set(key, entry)
    }
    for (const match of line.matchAll(BARE_HOST_RE)) {
      const host = match[1]
      if (host === 'localhost' || /^\d+$/.test(host)) continue
      const key = `${host}.`
      if (references.has(`${host}.${host}`)) continue
      const entry = references.get(key) || { service: host, namespace: null, occurrences: 0, sample: line.slice(0, 200) }
      entry.occurrences += 1
      references.set(key, entry)
    }
  }
  return [...references.values()].sort((left, right) => right.occurrences - left.occurrences)
}

/** Groups recurring error lines by a normalized signature so one-off noise doesn't dominate. */
function extractRecurringErrors(lines = [], { minOccurrences = 2 } = {}) {
  const groups = new Map()
  for (const rawLine of lines) {
    if (!ERROR_LINE_RE.test(rawLine)) continue
    const line = sanitizeLogLine(rawLine)
    const signature = errorSignature(line)
    if (!signature) continue
    const entry = groups.get(signature) || { signature, occurrences: 0, sample: line.slice(0, 200) }
    entry.occurrences += 1
    groups.set(signature, entry)
  }
  return [...groups.values()]
    .filter(entry => entry.occurrences >= minOccurrences)
    .sort((left, right) => right.occurrences - left.occurrences)
}

/** Distinct correlation/request/trace ids observed, useful evidence context without cross-log joins. */
function extractCorrelationIds(lines = []) {
  const ids = new Set()
  for (const rawLine of lines) {
    for (const match of sanitizeLogLine(rawLine).matchAll(CORRELATION_ID_RE)) ids.add(match[1])
  }
  return [...ids]
}

/**
 * Produces aggregate signals for the Intelligent topology panel.
 * Raw log payloads stay in the terminal tab; only counts and redacted signatures leave this helper.
 */
function extractLogSignals(lines = [], { minOccurrences = 2 } = {}) {
  const normalizedLines = lines.map(line => sanitizeLogLine(line)).filter(Boolean)
  const keywordCounts = new Map()
  let errorCount = 0
  let warningCount = 0
  for (const line of normalizedLines) {
    const errors = line.match(ERROR_KEYWORD_RE) || []
    const warnings = line.match(WARNING_KEYWORD_RE) || []
    if (errors.length) errorCount += 1
    else if (warnings.length) warningCount += 1
    for (const keyword of errors) {
      const key = keyword.toLowerCase().replace('failed', 'fail').replace('failure', 'fail')
      keywordCounts.set(key, (keywordCounts.get(key) || 0) + 1)
    }
  }
  const recurringErrors = extractRecurringErrors(normalizedLines, { minOccurrences })
  return {
    lineCount: normalizedLines.length,
    errorCount,
    warningCount,
    errorRatePercent: normalizedLines.length ? Number(((errorCount / normalizedLines.length) * 100).toFixed(1)) : 0,
    keywordCounts: [...keywordCounts.entries()]
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((left, right) => right.count - left.count),
    recurringErrors,
    repeatedErrorCount: recurringErrors.reduce((sum, item) => sum + item.occurrences, 0),
  }
}

function confidenceFromOccurrences(occurrences) {
  return Math.min(0.35 + occurrences * 0.1, 0.85)
}

/**
 * Matches extracted service references against known Kubernetes nodes in the same Architecture graph,
 * returning reviewable suggestions. Never returns a match confidence of 1: a suggestion always requires
 * explicit human acceptance through the existing edge review flow.
 */
function suggestGraphRelationships({ lines = [], sourceNode, nodes = [] } = {}) {
  if (!sourceNode) return []
  const references = extractServiceReferences(lines)
  const candidates = nodes.filter(node =>
    node.id !== sourceNode.id &&
    node.provider === 'kubernetes' &&
    ['service', 'deployment', 'statefulset', 'daemonset'].includes(node.resourceType))
  const suggestions = []
  for (const reference of references) {
    const match = candidates.find(node =>
      String(node.name).toLowerCase() === reference.service.toLowerCase() &&
      (!reference.namespace || !node.namespace || node.namespace.toLowerCase() === reference.namespace.toLowerCase()))
    if (!match) continue
    suggestions.push({
      targetNodeId: match.id,
      targetName: match.name,
      occurrences: reference.occurrences,
      confidence: confidenceFromOccurrences(reference.occurrences),
      sample: reference.sample,
    })
  }
  return suggestions
}

export {
  sanitizeLogLine,
  extractServiceReferences,
  extractRecurringErrors,
  extractCorrelationIds,
  extractLogSignals,
  suggestGraphRelationships,
}
