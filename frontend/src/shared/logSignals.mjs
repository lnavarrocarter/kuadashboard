// Deterministic, sanitized log signals shared by every provider (Kubernetes log
// tabs, cached CloudWatch groups, and future GCP/Vercel adapters) and by the
// frontend and the Node backend. No ML: levels, recurring error signatures,
// failure keywords and references to other resources are extracted with
// explicit rules, and every sample is sanitized before it is kept anywhere.
// References are evidence for *suggested* relationships only; a human must
// confirm them before they change a graph (KUA unified plan, Phase 16).

// Raising it re-analyzes cached sources on their next read.
export const SIGNALS_VERSION = 3

// ─── Sanitization and sensitive data ────────────────────────────────────────

export const SENSITIVE_TYPES = ['password', 'token', 'api_key', 'secret', 'authorization', 'bearer', 'aws_key', 'jwt', 'url_credentials', 'url_query', 'email', 'card', 'rut', 'ip_address']

const SECRET_KEY_TYPES = [
  [/^(password|passwd|pwd)$/i, 'password'],
  [/^(api[_-]?key|apikey|x-api-key)$/i, 'api_key'],
  [/^(secret|client[_-]?secret)$/i, 'secret'],
  [/token/i, 'token'],
]

function secretKeyType(key) {
  return SECRET_KEY_TYPES.find(([pattern]) => pattern.test(key))?.[1] || 'secret'
}

function luhnValid(digits) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  return sum % 10 === 0
}

function rutValid(body, dv) {
  let sum = 0
  let factor = 2
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * factor; factor = factor === 7 ? 2 : factor + 1 }
  const expected = 11 - (sum % 11)
  return String(dv).toUpperCase() === (expected === 11 ? '0' : expected === 10 ? 'K' : String(expected))
}

// [type, pattern, replacement]; a replacement function may return the match unchanged (not sensitive).
const SECRET_PATTERNS = [
  ['authorization', /\bauthorization\b\s*:?\s*(?!\[redacted\]).+/gi, () => 'Authorization: [redacted]'],
  ['bearer', /\bbearer\s+(?!\[redacted\])[a-z0-9._~+/=-]{8,}/gi, () => 'Bearer [redacted]'],
  ['secret_key', /\b(api[_-]?key|apikey|x-api-key|token|access[_-]?token|refresh[_-]?token|password|passwd|pwd|secret|client[_-]?secret)\b(["']?)\s*[:=]\s*(?!\[redacted\])("[^"]*"|'[^']*'|\S+)/gi, (_, key, quote) => `${key}${quote}: [redacted]`],
  ['aws_key', /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, () => '[aws-key]'],
  ['jwt', /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, () => '[jwt]'],
  ['url_credentials', /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@[]+:[^\s/@]+@/gi, (_, scheme) => `${scheme}[credentials]@`],
  ['url_query', /(https?:\/\/[^\s?#"']+)\?(?!\[query\])[^\s#"']*/gi, (_, url) => `${url}?[query]`],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => '[email]'],
  ['card', /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)(?:[ -]?\d{4}){2}[ -]?\d{3,4}\b/g, match => (luhnValid(match.replace(/\D/g, '')) ? '[card]' : match)],
  ['rut', /\b(\d{1,2}\.\d{3}\.\d{3}|\d{7,8})-([\dkK])\b/g, (match, body, dv) => (rutValid(body.replace(/\./g, ''), dv) ? '[rut]' : match)],
]

const MARKERS = [
  ['authorization', /Authorization: \[redacted\]/g],
  ['bearer', /Bearer \[redacted\]/g],
  ['aws_key', /\[aws-key\]/g],
  ['jwt', /\[jwt\]/g],
  ['url_credentials', /\[credentials\]@/g],
  ['url_query', /\?\[query\]/g],
  ['email', /\[email\]/g],
  ['card', /\[card\]/g],
  ['rut', /\[rut\]/g],
]
const SECRET_MARKER_RE = /\b(api[_-]?key|apikey|x-api-key|token|access[_-]?token|refresh[_-]?token|password|passwd|pwd|secret|client[_-]?secret)\b["']?: \[redacted\]/gi
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g

/**
 * Redacts secret-shaped substrings and reports what was found, by type.
 * Already-redacted text is recognized by its markers, so counting also works
 * on events stored sanitized. IP addresses are reported but kept.
 */
export function sanitizeWithFindings(line) {
  let text = String(line ?? '')
  const findings = {}
  const add = (type, n = 1) => { if (n) findings[type] = (findings[type] || 0) + n }
  for (const [type, pattern] of MARKERS) add(type, (text.match(pattern) || []).length)
  for (const match of text.matchAll(SECRET_MARKER_RE)) add(secretKeyType(match[1]))
  for (const [type, pattern, replace] of SECRET_PATTERNS) {
    text = text.replace(pattern, (...args) => {
      const replaced = replace(...args)
      if (replaced !== args[0]) add(type === 'secret_key' ? secretKeyType(args[1]) : type)
      return replaced
    })
  }
  const ips = (text.match(IPV4_RE) || []).filter(ip => !ip.startsWith('127.') && ip !== '0.0.0.0')
  add('ip_address', ips.length)
  return { text: text.trim(), findings }
}

/** Redacts common secret-shaped substrings before a line is ever kept as evidence. */
export function sanitizeLogLine(line) {
  return sanitizeWithFindings(line).text
}

// ANSI color/style sequences (Nest, Winston and other colored loggers).
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g

/**
 * The application message of a line: unwraps container runtime JSON
 * ({"time","stream","log": "..."} from Docker, containerd and Container
 * Insights) and drops ANSI colors, so signatures and samples describe the
 * error and not the wrapper (pod names, timestamps, escape codes).
 */
export function messageText(line) {
  let text = String(line || '')
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.includes('"log"')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed.log === 'string') text = parsed.log
    } catch { /* not JSON: keep the line */ }
  }
  return text.replace(ANSI_RE, '').trim()
}

/** Normalizes a line into a signature (strips ids, numbers, timestamps) to group recurring errors. */
export function errorSignature(line) {
  return String(line || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?\S*/g, '<timestamp>')
    .replace(/\b(?:i|sg|subnet|vpc|eni)-[0-9a-f]{8,17}\b/g, '<id>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

const ERROR_RE = /\b(error|exception|fatal|panic|traceback|unhandled|critical|crit|failed|failure)\b|task timed out|status:\s*(error|timeout)/i
const WARN_RE = /\b(warn|warning)\b/i
const QUIET_ERROR_RE = /"?errors?"?\s*[:=]\s*(0|\[\]|null|false)\b|\bno errors?\b|\b0 errors?\b/i
const JSON_LEVEL_KEYS = ['level', 'severity', 'loglevel', 'log_level', 'levelname', 'lvl']

/** error | warn | info for one line (JSON level fields win over keywords). */
export function lineLevel(line) {
  const text = String(line || '')
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed)
      for (const key of Object.keys(json)) {
        if (!JSON_LEVEL_KEYS.includes(key.toLowerCase())) continue
        const value = String(json[key]).toLowerCase()
        if (/^(error|err|fatal|critical|crit|alert|emerg|panic)$/.test(value) || Number(value) >= 50) return 'error'
        if (/^(warn|warning)$/.test(value) || Number(value) === 40) return 'warn'
        return 'info'
      }
      if (json.type === 'platform.report' && ['error', 'timeout', 'failure'].includes(String(json.record?.status || '').toLowerCase())) return 'error'
    } catch { /* not JSON */ }
  }
  // Lambda text format: "<ts>\t<requestId>\tERROR\t..."
  const lambdaLevel = text.match(/^\S+\t[0-9a-f-]{36}\t([A-Z]+)\t/)
  if (lambdaLevel) return /ERROR|FATAL/.test(lambdaLevel[1]) ? 'error' : lambdaLevel[1] === 'WARN' ? 'warn' : 'info'
  if (ERROR_RE.test(text) && !QUIET_ERROR_RE.test(text)) return 'error'
  if (WARN_RE.test(text)) return 'warn'
  return 'info'
}

export const FAILURE_KEYWORDS = {
  timeout: /\btimed?[\s-]?out\b|\btimeout\b|ETIMEDOUT|deadline exceeded/i,
  out_of_memory: /out of memory|OOMKilled|MemoryError|heap out of memory|signal: killed|Runtime exited with error: signal: killed/i,
  throttling: /throttl|rate exceeded|TooManyRequests|ProvisionedThroughputExceeded|SlowDown/i,
  access_denied: /AccessDenied|not authorized to perform|UnauthorizedOperation|\b403 Forbidden\b/i,
  connection: /ECONNREFUSED|ECONNRESET|connection refused|connection reset|EAI_AGAIN|ENOTFOUND|getaddrinfo|socket hang up/i,
  cold_start: /Init Duration:|"initDurationMs"/,
  crash: /Runtime\.ExitError|Runtime exited|segmentation fault|core dumped|CrashLoopBackOff/i,
}

export function failureKeywords(line) {
  const text = String(line || '')
  return Object.keys(FAILURE_KEYWORDS).filter(key => FAILURE_KEYWORDS[key].test(text))
}

// ─── Categories ─────────────────────────────────────────────────────────────

// One primary category per event, first match wins. `pattern` is valid both in
// JavaScript and in Logs Insights (used with (?i)), so every category has an
// equivalent query. Failure categories only apply to error/warning lines, so
// "timeout set to 30s" at info level is not a timeout.
export const CATEGORIES = [
  { id: 'timeout', group: 'failure', pattern: 'timed? ?out|timeout|ETIMEDOUT|deadline exceeded' },
  { id: 'out_of_memory', group: 'failure', pattern: 'out of memory|OOMKilled|MemoryError|heap out of memory|signal: killed' },
  { id: 'throttling', group: 'failure', pattern: 'throttl|rate exceeded|TooManyRequests|ProvisionedThroughputExceeded|SlowDown|\\b429\\b' },
  { id: 'access_denied', group: 'failure', pattern: 'AccessDenied|not authorized to perform|is not authorized|UnauthorizedOperation|403 Forbidden|InvalidClientTokenId|ExpiredToken' },
  { id: 'connection', group: 'failure', pattern: 'ECONNREFUSED|ECONNRESET|connection refused|connection reset|EAI_AGAIN|ENOTFOUND|getaddrinfo|socket hang up|EPIPE' },
  { id: 'crash', group: 'failure', pattern: 'Runtime\\.ExitError|Runtime exited|segmentation fault|core dumped|CrashLoopBackOff|uncaughtException|unhandled ?rejection' },
  { id: 'configuration', group: 'failure', pattern: 'Runtime\\.ImportModuleError|Cannot find module|ModuleNotFoundError|ImportError|environment variable|missing required|ConfigurationError|InvalidParameterValue' },
  { id: 'database', group: 'failure', pattern: 'ConditionalCheckFailed|TransactionCanceled|deadlock|duplicate key|SQLSTATE|too many connections|could not connect to server|ER_[A-Z_]+' },
  { id: 'code_exception', group: 'failure', pattern: 'TypeError|ReferenceError|SyntaxError|NullPointerException|KeyError|AttributeError|IndexError|ValueError|Traceback|Cannot read propert|NoneType' },
  { id: 'not_found', group: 'client', pattern: 'ResourceNotFound|NoSuchKey|NoSuchBucket|\\b404\\b|not found' },
  { id: 'validation', group: 'client', pattern: 'ValidationException|ValidationError|Bad Request|\\b400\\b|invalid (input|request|parameter|payload)|schema validation' },
  { id: 'cold_start', group: 'platform', pattern: 'Init Duration|initDurationMs' },
  { id: 'platform', group: 'platform', pattern: '^(START|END|INIT_START|REPORT) RequestId|platform\\.(start|end|report|initStart|runtimeDone)' },
  { id: 'debug', group: 'noise', pattern: '\\bDEBUG\\b|"level": ?"debug"|\\bTRACE\\b' },
]
export const FALLBACK_CATEGORIES = ['other_error', 'other_warning', 'info']
const CATEGORY_RES = CATEGORIES.map(c => ({ ...c, re: new RegExp(c.pattern, 'i') }))

/** Primary category of a line, given its level. */
export function categorize(line, level = lineLevel(line)) {
  const text = String(line || '')
  for (const category of CATEGORY_RES) {
    if ((category.group === 'failure' || category.group === 'client') && level === 'info') continue
    if (category.re.test(text)) return category.id
  }
  return level === 'error' ? 'other_error' : level === 'warn' ? 'other_warning' : 'info'
}

/** Logs Insights query that lists a category's events (also runs locally). */
export function categoryQuery(id, { limit = 200 } = {}) {
  const category = CATEGORIES.find(c => c.id === id)
  const head = 'fields @timestamp, @logStream, @message'
  if (category) return `${head}\n| filter @message like /(?i)(${category.pattern})/\n| sort @timestamp desc\n| limit ${limit}`
  if (id === 'other_error') return `${head}\n| filter @message like /(?i)(error|exception|fatal|fail)/\n| sort @timestamp desc\n| limit ${limit}`
  if (id === 'other_warning') return `${head}\n| filter @message like /(?i)warn/\n| sort @timestamp desc\n| limit ${limit}`
  return `${head}\n| sort @timestamp desc\n| limit ${limit}`
}

// ─── References to other resources ──────────────────────────────────────────

const K8S_DNS_RE = /\b([a-z0-9]([a-z0-9-]*[a-z0-9])?)\.([a-z0-9]([a-z0-9-]*[a-z0-9])?)\.svc(?:\.cluster\.local)?\b/gi
const BARE_HOST_RE = /https?:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)(?::\d+)?\//gi
const ARN_RE = /\barn:aws[a-z-]*:(lambda|sqs|sns|states|dynamodb|s3|events|kinesis|firehose|secretsmanager|rds|ecs|apigateway|execute-api):([a-z0-9-]*):(\d{12})?:([^\s"',)\]}]+)/g
const SQS_URL_RE = /https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d{12})\/([A-Za-z0-9_-]+(?:\.fifo)?)/g
const APIGW_HOST_RE = /\b([a-z0-9]{10})\.execute-api\.([a-z0-9-]+)\.amazonaws\.com\b/g
const HOST_URL_RE = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi
const CORRELATION_ID_RE = /\b(?:x-request-id|x-correlation-id|correlation[_-]?id|trace[_-]?id|request[_-]?id)\b\s*[:=]\s*([a-zA-Z0-9-]{8,64})/gi

const ARN_TYPES = { lambda: 'lambda', sqs: 'sqs', sns: 'sns', states: 'stepfunctions', dynamodb: 'dynamodb', s3: 's3', events: 'eventbridge', kinesis: 'kinesis', firehose: 'firehose', secretsmanager: 'secrets', rds: 'rds', ecs: 'ecs', apigateway: 'apigateway', 'execute-api': 'apigateway' }

function arnResourceName(service, resource) {
  if (service === 'lambda') return resource.replace(/^function:/, '').split(':')[0]
  if (service === 'states') return resource.replace(/^(stateMachine|execution):/, '').split(':')[0]
  if (service === 'dynamodb') return resource.replace(/^table\//, '').split('/')[0]
  if (service === 'events') return resource.replace(/^(rule|event-bus)\//, '').split('/').pop()
  if (service === 's3') return resource.split('/')[0]
  return resource.split(/[:/]/).pop()
}

/** Finds internal Kubernetes DNS names and bare hostnames referenced in log lines, deduped with counts. */
export function extractServiceReferences(lines = []) {
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

/**
 * References to cloud resources in one (sanitized) line:
 * { kind, type, name, target } where `target` is a stable key (ARN, queue, host…).
 */
export function lineReferences(line) {
  const text = String(line || '')
  const found = new Map()
  const add = ref => { if (ref.name && !found.has(`${ref.kind}:${ref.target}`)) found.set(`${ref.kind}:${ref.target}`, ref) }
  for (const match of text.matchAll(ARN_RE)) {
    const [, service, region, account, resource] = match
    const arn = match[0].replace(/[.:;]+$/, '')
    add({ kind: 'arn', type: ARN_TYPES[service] || service, name: arnResourceName(service, resource), target: arn, region: region || null, account: account || null })
  }
  for (const match of text.matchAll(SQS_URL_RE)) {
    add({ kind: 'sqs_url', type: 'sqs', name: match[3], target: `sqs:${match[1]}:${match[2]}:${match[3]}`, region: match[1], account: match[2] })
  }
  for (const match of text.matchAll(APIGW_HOST_RE)) {
    add({ kind: 'apigateway_host', type: 'apigateway', name: match[1], target: `${match[1]}.execute-api.${match[2]}`, region: match[2] })
  }
  for (const match of text.matchAll(K8S_DNS_RE)) {
    add({ kind: 'kubernetes_dns', type: 'kubernetes', name: match[1], namespace: match[3], target: `${match[1]}.${match[3]}` })
  }
  for (const match of text.matchAll(HOST_URL_RE)) {
    const host = match[1].toLowerCase()
    if (/amazonaws\.com$|\.svc(\.cluster\.local)?$|^localhost$/.test(host)) continue
    add({ kind: 'host', type: 'host', name: host, target: host })
  }
  return [...found.values()]
}

/** Groups recurring error lines by a normalized signature so one-off noise doesn't dominate. */
export function extractRecurringErrors(lines = [], { minOccurrences = 2 } = {}) {
  const groups = new Map()
  for (const rawLine of lines) {
    if (!/error|exception|fatal|panic/i.test(rawLine)) continue
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

/** Distinct correlation/request/trace ids observed. */
export function extractCorrelationIds(lines = []) {
  const ids = new Set()
  for (const rawLine of lines) {
    for (const match of sanitizeLogLine(rawLine).matchAll(CORRELATION_ID_RE)) ids.add(match[1])
  }
  return [...ids]
}

/**
 * Signals of one event: { level, keywords, signature, sample, references }.
 * `signature`/`sample` are only set for errors and warnings; the sample is sanitized.
 */
export function eventSignals(message) {
  const level = lineLevel(message)
  const { text: sanitized, findings } = sanitizeWithFindings(message)
  // Signature and sample come from the application message, not its wrapper.
  const appText = level === 'info' ? null : sanitizeLogLine(messageText(message))
  return {
    level,
    category: categorize(message, level),
    sensitive: findings,
    structured: String(message || '').trim().startsWith('{'),
    keywords: failureKeywords(message),
    signature: level === 'info' ? null : errorSignature(appText),
    sample: level === 'info' ? null : appText.slice(0, 240),
    references: lineReferences(sanitized),
  }
}

/** Confidence for a relationship seen N times in logs (never 1: humans confirm). */
export function referenceConfidence(occurrences) {
  return Math.min(0.35 + occurrences * 0.1, 0.85)
}
