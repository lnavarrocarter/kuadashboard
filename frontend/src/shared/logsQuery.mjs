// CloudWatch Logs Insights query language (subset) for KUA.
// Shared by the frontend (validation, autocomplete, query builder) and the
// Node backend (runs queries over cached or sampled events without Logs
// Insights' per-GB charge). Supported commands: fields, display, filter,
// parse, stats, sort, limit, dedup.

export const DEFAULT_LIMIT = 1000
export const MAX_LIMIT = 10000

export class QueryError extends Error {
  constructor(code, params = {}, message = code) {
    super(message)
    this.code = code
    this.params = params
  }
}

// ─── Reference data (help panel and autocomplete) ───────────────────────────

export const COMMANDS = [
  { name: 'fields', syntax: 'fields @timestamp, @message, expr as alias', example: 'fields @timestamp, @logStream, @message' },
  { name: 'filter', syntax: 'filter <condition>', example: 'filter @message like /ERROR|Exception/' },
  { name: 'parse', syntax: 'parse @message "text * text *" as a, b  |  parse @message /(?<a>\\d+)/', example: 'parse @message "status=* " as status' },
  { name: 'stats', syntax: 'stats count(*) as n, avg(x) by field, bin(5m)', example: 'stats count(*) as errors by bin(5m)' },
  { name: 'sort', syntax: 'sort field [asc|desc]', example: 'sort @timestamp desc' },
  { name: 'limit', syntax: 'limit n', example: 'limit 50' },
  { name: 'display', syntax: 'display field1, field2', example: 'display @timestamp, status' },
  { name: 'dedup', syntax: 'dedup field1, field2', example: 'dedup @logStream' },
]

export const OPERATORS = ['=', '!=', '<', '<=', '>', '>=', 'like', 'not like', '=~', 'in', 'not in', 'and', 'or', 'not']

export const AGGREGATES = {
  count: 'count(*) | count(field)',
  count_distinct: 'count_distinct(field)',
  sum: 'sum(field)',
  avg: 'avg(field)',
  min: 'min(field)',
  max: 'max(field)',
  pct: 'pct(field, 95)',
  stddev: 'stddev(field)',
  earliest: 'earliest(field)',
  latest: 'latest(field)',
}

export const FUNCTIONS = {
  ispresent: 'ispresent(field)',
  isempty: 'isempty(field)',
  isblank: 'isblank(field)',
  coalesce: 'coalesce(a, b, ...)',
  strlen: 'strlen(text)',
  tolower: 'tolower(text)',
  toupper: 'toupper(text)',
  trim: 'trim(text)',
  concat: 'concat(a, b, ...)',
  substr: 'substr(text, start, length)',
  replace: 'replace(text, search, replacement)',
  strcontains: 'strcontains(text, search)',
  abs: 'abs(n)',
  ceil: 'ceil(n)',
  floor: 'floor(n)',
  bin: 'bin(5m)',
  datefloor: 'datefloor(@timestamp, 1h)',
  frommillis: 'fromMillis(ms)',
  tomillis: 'toMillis(@timestamp)',
}

export const BUILTIN_FIELDS = ['@timestamp', '@message', '@logStream', '@log']
export const LAMBDA_FIELDS = ['@type', '@requestId', '@duration', '@billedDuration', '@memorySize', '@maxMemoryUsed', '@initDuration']

export const TEMPLATES = [
  { id: 'recent', kinds: ['any'], query: 'fields @timestamp, @logStream, @message\n| sort @timestamp desc\n| limit 100' },
  { id: 'errors', kinds: ['any'], query: 'fields @timestamp, @logStream, @message\n| filter @message like /(?i)(error|exception|fail)/\n| sort @timestamp desc\n| limit 100' },
  { id: 'errorsPerBin', kinds: ['any'], query: 'filter @message like /(?i)(error|exception)/\n| stats count(*) as errors by bin(5m)\n| sort bin(5m) desc' },
  { id: 'topMessages', kinds: ['any'], query: 'stats count(*) as occurrences by @message\n| sort occurrences desc\n| limit 20' },
  { id: 'perStream', kinds: ['any', 'machine'], query: 'stats count(*) as events, latest(@timestamp) as lastSeen by @logStream\n| sort events desc' },
  { id: 'jsonLevel', kinds: ['json'], query: 'fields @timestamp, level, message\n| filter level = "error" or level = "ERROR"\n| sort @timestamp desc\n| limit 100' },
  { id: 'lambdaSlowest', kinds: ['lambda'], query: 'filter @type = "REPORT"\n| fields @timestamp, @requestId, @duration, @maxMemoryUsed\n| sort @duration desc\n| limit 20' },
  { id: 'lambdaLatency', kinds: ['lambda'], query: 'filter @type = "REPORT"\n| stats count(*) as invocations, avg(@duration) as avgMs, pct(@duration, 95) as p95Ms, max(@duration) as maxMs by bin(15m)' },
  { id: 'lambdaColdStarts', kinds: ['lambda'], query: 'filter @type = "REPORT" and ispresent(@initDuration)\n| stats count(*) as coldStarts, avg(@initDuration) as avgInitMs by bin(1h)' },
  { id: 'lambdaMemory', kinds: ['lambda'], query: 'filter @type = "REPORT"\n| stats max(@memorySize) as allocatedMB, max(@maxMemoryUsed) as maxUsedMB, avg(@maxMemoryUsed) as avgUsedMB' },
  { id: 'httpStatus', kinds: ['any'], query: 'parse @message /(?:HTTP\\/[\\d.]+"?\\s+|status["\\x27:=\\s]+)(?<status>[1-5]\\d\\d)\\b/\n| filter ispresent(status)\n| stats count(*) as requests by status\n| sort requests desc' },
]

// ─── Pipeline splitting ─────────────────────────────────────────────────────

function regexCanStart(before) {
  const trimmed = before.replace(/\s+$/, '')
  if (!trimmed) return true
  if (/[(,=~[!<>|]$/.test(trimmed)) return true
  if (/(?:^|\s)(like|and|or|not|in)$/i.test(trimmed)) return true
  return /^\s*parse(\s+\S+)?$/i.test(trimmed)
}

/** Splits on `|` outside strings, regexes and backticks; keeps offsets for error positions. */
export function splitPipeline(text) {
  const segments = []
  let start = 0
  let quote = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') { i++; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '/' && regexCanStart(text.slice(start, i))) { quote = '/'; continue }
    if (ch === '|') {
      segments.push({ text: text.slice(start, i), offset: start })
      start = i + 1
    }
  }
  segments.push({ text: text.slice(start), offset: start })
  return segments.filter(s => s.text.trim())
}

// ─── Tokenizer and expression parser ────────────────────────────────────────

const KEYWORDS = new Set(['and', 'or', 'not', 'like', 'in', 'as', 'by', 'asc', 'desc'])
const DURATION_UNITS = { ms: 1, s: 1000, sec: 1000, m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000, w: 604800000 }

function tokenize(src, offset = 0) {
  const tokens = []
  let i = 0
  const push = (type, value, start, raw) => tokens.push({ type, value, pos: offset + start, raw: raw ?? src.slice(start, i) })
  const prevAllowsRegex = () => {
    const prev = tokens[tokens.length - 1]
    return !prev || prev.type === 'op' || (prev.type === 'punct' && prev.value !== ')' && prev.value !== ']') || (prev.type === 'kw' && ['like', 'and', 'or', 'not', 'in'].includes(prev.value))
  }
  while (i < src.length) {
    const ch = src[i]
    const start = i
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '"' || ch === "'") {
      let value = ''
      i++
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\' && i + 1 < src.length) { value += src[i + 1]; i += 2; continue }
        value += src[i++]
      }
      if (i >= src.length) throw new QueryError('unterminatedString', { pos: offset + start }, `Unterminated string at ${offset + start}`)
      i++
      push('string', value, start)
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end < 0) throw new QueryError('unterminatedString', { pos: offset + start }, `Unterminated field name at ${offset + start}`)
      i = end + 1
      push('ident', src.slice(start + 1, end), start)
      continue
    }
    if (ch === '/' && prevAllowsRegex()) {
      let body = ''
      i++
      while (i < src.length && src[i] !== '/') {
        if (src[i] === '\\' && i + 1 < src.length) { body += src[i] + src[i + 1]; i += 2; continue }
        body += src[i++]
      }
      if (i >= src.length) throw new QueryError('unterminatedRegex', { pos: offset + start }, `Unterminated regex at ${offset + start}`)
      i++
      let flags = ''
      while (i < src.length && /[a-z]/i.test(src[i])) flags += src[i++]
      push('regex', compileRegex(body, flags, offset + start), start)
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      while (i < src.length && /[0-9.]/.test(src[i])) i++
      const unit = src.slice(i).match(/^(ms|sec|min|hr|s|m|h|d|w)(?![\w])/)
      if (unit) {
        i += unit[1].length
        push('duration', Number(src.slice(start, i - unit[1].length)) * DURATION_UNITS[unit[1]], start)
      } else {
        push('number', Number(src.slice(start, i)), start)
      }
      continue
    }
    if (/[@A-Za-z_]/.test(ch)) {
      while (i < src.length && /[\w@.\-]/.test(src[i]) && !(src[i] === '-' && !/[\w]/.test(src[i + 1] || ''))) i++
      // a trailing '-' belongs to arithmetic, not to the name
      const word = src.slice(start, i)
      const lower = word.toLowerCase()
      if (KEYWORDS.has(lower)) push('kw', lower, start)
      else push('ident', word, start)
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<>', '<=', '>=', '=~'].includes(two)) { i += 2; push('op', two === '==' ? '=' : two === '<>' ? '!=' : two, start); continue }
    if ('=<>+-*/%'.includes(ch)) { i++; push('op', ch, start); continue }
    if ('(),[]'.includes(ch)) { i++; push('punct', ch, start); continue }
    throw new QueryError('unexpectedChar', { char: ch, pos: offset + start }, `Unexpected character "${ch}" at ${offset + start}`)
  }
  return tokens
}

function compileRegex(body, flags, pos) {
  let source = body
  let finalFlags = flags.replace(/[^gimsuy]/g, '').replace('g', '')
  if (source.startsWith('(?i)')) { source = source.slice(4); if (!finalFlags.includes('i')) finalFlags += 'i' }
  try { return new RegExp(source, finalFlags) } catch (err) {
    throw new QueryError('badRegex', { pos, error: err.message }, `Invalid regex at ${pos}: ${err.message}`)
  }
}

class Parser {
  constructor(tokens, src) {
    this.tokens = tokens
    this.i = 0
    this.src = src
  }
  peek(offset = 0) { return this.tokens[this.i + offset] }
  next() { return this.tokens[this.i++] }
  done() { return this.i >= this.tokens.length }
  is(type, value) {
    const t = this.peek()
    return !!t && t.type === type && (value === undefined || t.value === value)
  }
  expect(type, value) {
    const t = this.next()
    if (!t || t.type !== type || (value !== undefined && t.value !== value)) {
      const pos = t ? t.pos : null
      throw new QueryError('expected', { expected: value ?? type, found: t ? t.raw : 'end', pos }, `Expected ${value ?? type} but found ${t ? t.raw : 'end of query'}`)
    }
    return t
  }

  expression() { return this.or() }
  or() {
    let left = this.and()
    while (this.is('kw', 'or')) { this.next(); left = { type: 'or', left, right: this.and() } }
    return left
  }
  and() {
    let left = this.not()
    while (this.is('kw', 'and')) { this.next(); left = { type: 'and', left, right: this.not() } }
    return left
  }
  not() {
    if (this.is('kw', 'not') && !(this.peek(1)?.type === 'kw' && ['like', 'in'].includes(this.peek(1).value))) {
      this.next()
      return { type: 'not', expr: this.not() }
    }
    return this.comparison()
  }
  comparison() {
    const left = this.additive()
    const t = this.peek()
    if (!t) return left
    let negate = false
    if (t.type === 'kw' && t.value === 'not' && ['like', 'in'].includes(this.peek(1)?.value)) { this.next(); negate = true }
    const op = this.peek()
    if (op?.type === 'kw' && op.value === 'like') {
      this.next()
      const pattern = this.next()
      if (!pattern || !['string', 'regex'].includes(pattern.type)) throw new QueryError('likeOperand', { pos: pattern?.pos ?? null }, 'like expects "text" or /regex/')
      return wrapNot({ type: 'like', left, pattern: pattern.value }, negate)
    }
    if (op?.type === 'kw' && op.value === 'in') {
      this.next()
      this.expect('punct', '[')
      const items = []
      if (!this.is('punct', ']')) {
        do { items.push(this.additive()) } while (this.is('punct', ',') && this.next())
      }
      this.expect('punct', ']')
      return wrapNot({ type: 'in', left, items }, negate)
    }
    if (op?.type === 'op' && ['=', '!=', '<', '<=', '>', '>=', '=~'].includes(op.value)) {
      this.next()
      if (op.value === '=~') {
        const pattern = this.next()
        if (!pattern || pattern.type !== 'regex') throw new QueryError('likeOperand', { pos: pattern?.pos ?? null }, '=~ expects /regex/')
        return { type: 'like', left, pattern: pattern.value }
      }
      return { type: 'cmp', op: op.value, left, right: this.additive() }
    }
    return left
  }
  additive() {
    let left = this.multiplicative()
    while (this.is('op', '+') || this.is('op', '-')) { const op = this.next().value; left = { type: 'arith', op, left, right: this.multiplicative() } }
    return left
  }
  multiplicative() {
    let left = this.unary()
    while (this.is('op', '*') || this.is('op', '/') || this.is('op', '%')) { const op = this.next().value; left = { type: 'arith', op, left, right: this.unary() } }
    return left
  }
  unary() {
    if (this.is('op', '-')) { this.next(); return { type: 'arith', op: '-', left: { type: 'lit', value: 0 }, right: this.unary() } }
    return this.primary()
  }
  primary() {
    const t = this.next()
    if (!t) throw new QueryError('unexpectedEnd', {}, 'The query ends unexpectedly')
    if (t.type === 'number' || t.type === 'string' || t.type === 'duration') return { type: 'lit', value: t.value, duration: t.type === 'duration' }
    if (t.type === 'regex') return { type: 'lit', value: t.value }
    if (t.type === 'punct' && t.value === '(') {
      const expr = this.expression()
      this.expect('punct', ')')
      return expr
    }
    if (t.type === 'op' && t.value === '*') return { type: 'star' }
    if (t.type === 'ident') {
      if (this.is('punct', '(')) {
        this.next()
        const args = []
        if (!this.is('punct', ')')) {
          do { args.push(this.expression()) } while (this.is('punct', ',') && this.next())
        }
        this.expect('punct', ')')
        const name = t.value.toLowerCase()
        if (!(name in FUNCTIONS) && !(name in AGGREGATES) && name !== 'percentile') {
          throw new QueryError('unknownFunction', { name: t.value, pos: t.pos, suggestion: closest(name, [...Object.keys(FUNCTIONS), ...Object.keys(AGGREGATES)]) }, `Unknown function ${t.value}`)
        }
        return { type: 'call', name: name === 'percentile' ? 'pct' : name, args, pos: t.pos }
      }
      return { type: 'field', name: t.value }
    }
    throw new QueryError('unexpectedToken', { token: t.raw, pos: t.pos }, `Unexpected "${t.raw}" at ${t.pos}`)
  }
}

function wrapNot(node, negate) { return negate ? { type: 'not', expr: node } : node }

function closest(word, options) {
  let best = null
  let bestScore = Infinity
  for (const option of options) {
    const score = levenshtein(word.toLowerCase(), option.toLowerCase())
    if (score < bestScore) { bestScore = score; best = option }
  }
  return bestScore <= 2 ? best : null
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

// "expr [as alias], expr [as alias]" → [{ expr, name }]
function parseProjectionList(parser, segmentText, segmentOffset, stopAt = null) {
  const items = []
  while (!parser.done() && !(stopAt && parser.is('kw', stopAt))) {
    const startIndex = parser.i
    const expr = parser.expression()
    const first = parser.tokens[startIndex]
    const last = parser.tokens[parser.i - 1]
    let name = segmentText.slice(first.pos - segmentOffset, last.pos - segmentOffset + last.raw.length).trim()
    if (parser.is('kw', 'as')) { parser.next(); name = parser.expect('ident').value }
    items.push({ expr, name })
    if (parser.is('punct', ',')) { parser.next(); continue }
    if (!parser.done() && !(stopAt && parser.is('kw', stopAt))) {
      const t = parser.peek()
      throw new QueryError('unexpectedToken', { token: t.raw, pos: t.pos }, `Unexpected "${t.raw}" at ${t.pos}`)
    }
  }
  return items
}

function parseGlob(pattern, pos) {
  const parts = pattern.split('*')
  if (parts.length < 2) throw new QueryError('parseNoCapture', { pos }, 'parse patterns need at least one *')
  const escaped = parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // A trailing * takes the rest of the text; the others stop at the next literal.
  const last = escaped.pop()
  const source = escaped.join('(.*?)') + (last === '' ? '(.*)' : `(.*?)${last}`)
  return { regex: new RegExp(source), captures: parts.length - 1 }
}

function parseCommand(segment) {
  const raw = segment.text
  const leading = raw.match(/^\s*/)[0].length
  const text = raw.trim()
  const offset = segment.offset + leading
  const nameMatch = text.match(/^([A-Za-z_]+)\b\s*/)
  if (!nameMatch) throw new QueryError('expectedCommand', { pos: offset }, `Expected a command at ${offset}`)
  const name = nameMatch[1].toLowerCase()
  const bodyOffset = offset + nameMatch[0].length
  const body = text.slice(nameMatch[0].length)
  const known = COMMANDS.map(c => c.name)
  if (!known.includes(name)) {
    throw new QueryError('unknownCommand', { name: nameMatch[1], pos: offset, suggestion: closest(name, known) }, `Unknown command "${nameMatch[1]}"`)
  }
  if (name === 'parse') return parseParseCommand(body, bodyOffset)
  const parser = new Parser(tokenize(body, bodyOffset), body)
  let command
  switch (name) {
    case 'fields':
    case 'display': {
      const items = parseProjectionList(parser, body, bodyOffset)
      if (!items.length) throw new QueryError('emptyCommand', { name, pos: offset }, `${name} needs at least one field`)
      command = { type: name, items }
      break
    }
    case 'filter': {
      if (parser.done()) throw new QueryError('emptyCommand', { name, pos: offset }, 'filter needs a condition')
      command = { type: 'filter', expr: parser.expression() }
      break
    }
    case 'stats': {
      const aggs = parseProjectionList(parser, body, bodyOffset, 'by')
      if (!aggs.length) throw new QueryError('emptyCommand', { name, pos: offset }, 'stats needs an aggregate such as count(*)')
      for (const agg of aggs) {
        if (!containsAggregate(agg.expr)) throw new QueryError('statsNeedsAggregate', { name: agg.name, pos: offset }, `"${agg.name}" is not an aggregate (count, avg, sum…)`)
      }
      let by = []
      if (parser.is('kw', 'by')) { parser.next(); by = parseProjectionList(parser, body, bodyOffset) }
      command = { type: 'stats', aggs, by }
      break
    }
    case 'sort': {
      const keys = []
      while (!parser.done()) {
        const startIndex = parser.i
        const expr = parser.expression()
        const first = parser.tokens[startIndex]
        const last = parser.tokens[parser.i - 1]
        const keyName = body.slice(first.pos - bodyOffset, last.pos - bodyOffset + last.raw.length).trim()
        let desc = false
        if (parser.is('kw', 'desc')) { parser.next(); desc = true } else if (parser.is('kw', 'asc')) parser.next()
        keys.push({ expr, name: keyName, desc })
        if (parser.is('punct', ',')) parser.next()
        else if (!parser.done()) { const t = parser.peek(); throw new QueryError('unexpectedToken', { token: t.raw, pos: t.pos }, `Unexpected "${t.raw}"`) }
      }
      if (!keys.length) throw new QueryError('emptyCommand', { name, pos: offset }, 'sort needs a field')
      command = { type: 'sort', keys }
      break
    }
    case 'limit': {
      const t = parser.expect('number')
      if (!parser.done()) { const extra = parser.peek(); throw new QueryError('unexpectedToken', { token: extra.raw, pos: extra.pos }, `Unexpected "${extra.raw}"`) }
      command = { type: 'limit', n: Math.max(1, Math.min(MAX_LIMIT, Math.floor(t.value))) }
      break
    }
    case 'dedup': {
      const items = parseProjectionList(parser, body, bodyOffset)
      command = { type: 'dedup', items }
      break
    }
  }
  if (!parser.done()) {
    const t = parser.peek()
    const suggestion = t.type === 'ident' ? closest(t.value, ['like', 'and', 'or', 'not', 'in', 'as', 'by', 'asc', 'desc']) : null
    throw new QueryError('unexpectedToken', { token: t.raw, pos: t.pos, suggestion }, `Unexpected "${t.raw}"`)
  }
  return command
}

function parseParseCommand(body, offset) {
  const match = body.match(/^(?:(`[^`]+`|[@\w.\-]+)\s+)?("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/(?:[^/\\]|\\.)+\/[a-z]*)\s*(?:as\s+(.+))?$/is)
  if (!match) throw new QueryError('parseSyntax', { pos: offset }, 'Use: parse @message "text * text" as a, b  or  parse @message /(?<name>...)/')
  const field = (match[1] || '@message').replace(/`/g, '')
  const pattern = match[2]
  const names = match[3] ? match[3].split(',').map(n => n.trim()).filter(Boolean) : []
  if (pattern.startsWith('/')) {
    const end = pattern.lastIndexOf('/')
    const regex = compileRegex(pattern.slice(1, end), pattern.slice(end + 1), offset)
    const groups = [...regex.source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map(m => m[1])
    if (!groups.length && !names.length) throw new QueryError('parseNoCapture', { pos: offset }, 'The regex needs named groups (?<name>...)')
    return { type: 'parse', field, regex, names: groups.length ? groups : names, named: groups.length > 0 }
  }
  const glob = parseGlob(pattern.slice(1, -1).replace(/\\(.)/g, '$1'), offset)
  if (names.length !== glob.captures) {
    throw new QueryError('parseNames', { expected: glob.captures, found: names.length, pos: offset }, `The pattern has ${glob.captures} * but ${names.length} names after "as"`)
  }
  return { type: 'parse', field, regex: glob.regex, names, named: false }
}

function containsAggregate(node) {
  if (!node) return false
  if (node.type === 'call' && node.name in AGGREGATES) return true
  return ['left', 'right', 'expr'].some(key => containsAggregate(node[key])) || (node.args || []).some(containsAggregate)
}

/** Parses a whole query. Throws QueryError (code, params.pos) on the first problem. */
export function parseQuery(text) {
  const source = String(text || '')
  if (!source.trim()) throw new QueryError('emptyQuery', {}, 'Write a query or pick a template')
  return splitPipeline(source).map(parseCommand)
}

/** { ok, error } without throwing; error has code, params and message. */
export function validateQuery(text) {
  try {
    const commands = parseQuery(text)
    return { ok: true, error: null, commands }
  } catch (err) {
    if (err instanceof QueryError) return { ok: false, error: { code: err.code, params: err.params, message: err.message } }
    return { ok: false, error: { code: 'internal', params: {}, message: err.message } }
  }
}

// ─── Records ────────────────────────────────────────────────────────────────

const REPORT_FIELDS = {
  RequestId: ['@requestId', String],
  Duration: ['@duration', Number],
  'Billed Duration': ['@billedDuration', Number],
  'Memory Size': ['@memorySize', Number],
  'Max Memory Used': ['@maxMemoryUsed', Number],
  'Init Duration': ['@initDuration', Number],
}

function flatten(value, prefix, target, depth) {
  for (const [key, inner] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && depth < 3) flatten(inner, name, target, depth + 1)
    else target[name] = Array.isArray(inner) || (inner && typeof inner === 'object') ? JSON.stringify(inner) : inner
  }
}

/** Fields Logs Insights discovers automatically: JSON keys and Lambda platform lines. */
export function eventRecord(event, logGroup = '') {
  const message = String(event.message ?? '')
  const record = { '@timestamp': Number(event.timestamp), '@message': message, '@logStream': event.logStreamName || '', '@log': logGroup }
  const trimmed = message.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const json = JSON.parse(trimmed)
      if (json && typeof json === 'object') {
        flatten(json, '', record, 0)
        // Lambda JSON log format
        if (typeof json.type === 'string' && json.type.startsWith('platform.')) record['@type'] = json.type.replace('platform.', '').toUpperCase()
        if (json.record?.metrics) {
          const m = json.record.metrics
          if (m.durationMs != null) record['@duration'] = m.durationMs
          if (m.billedDurationMs != null) record['@billedDuration'] = m.billedDurationMs
          if (m.memorySizeMB != null) record['@memorySize'] = m.memorySizeMB
          if (m.maxMemoryUsedMB != null) record['@maxMemoryUsed'] = m.maxMemoryUsedMB
          if (m.initDurationMs != null) record['@initDuration'] = m.initDurationMs
        }
        if (json.record?.requestId) record['@requestId'] = json.record.requestId
        else if (json.requestId) record['@requestId'] = json.requestId
      }
    } catch { /* not JSON */ }
    return record
  }
  const platform = trimmed.match(/^(START|END|REPORT|INIT_START) RequestId: ([\w-]+)/)
  if (platform) {
    record['@type'] = platform[1]
    record['@requestId'] = platform[2]
    if (platform[1] === 'REPORT') {
      for (const part of trimmed.split('\t')) {
        const [key, value] = part.split(/:\s*/, 2)
        const spec = REPORT_FIELDS[key?.replace(/^REPORT /, '').trim()]
        if (spec && value != null) record[spec[0]] = spec[1] === Number ? parseFloat(value) : value.trim()
      }
    }
    return record
  }
  // Lambda text format: "<timestamp>\t<requestId>\t<LEVEL>\t<message>"
  const textLine = message.match(/^\d{4}-\d\d-\d\dT[\d:.]+Z\t([0-9a-f-]{36})\t([A-Z]+)\t/)
  if (textLine) {
    record['@requestId'] = textLine[1]
    record['@level'] = textLine[2]
  }
  return record
}

/** Field names present in a sample of events, most frequent first. */
export function discoverFields(events, { logGroup = '', max = 60 } = {}) {
  const counts = new Map()
  for (const event of (events || []).slice(0, 500)) {
    for (const key of Object.keys(eventRecord(event, logGroup))) counts.set(key, (counts.get(key) || 0) + 1)
  }
  const builtin = new Set(BUILTIN_FIELDS)
  const extra = [...counts.entries()].filter(([key]) => !builtin.has(key)).sort((a, b) => b[1] - a[1]).map(([key]) => key)
  return [...BUILTIN_FIELDS, ...extra].slice(0, max)
}

// ─── Evaluation ─────────────────────────────────────────────────────────────

function isNumeric(value) {
  return typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
}

function compare(a, b) {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b)
  const x = String(a)
  const y = String(b)
  return x < y ? -1 : x > y ? 1 : 0
}

function missing(value) { return value === undefined || value === null }

export function formatTimestamp(ms) {
  if (!Number.isFinite(Number(ms))) return ms
  return new Date(Number(ms)).toISOString().replace('T', ' ').replace('Z', '')
}

function evaluate(node, record) {
  switch (node.type) {
    case 'lit': return node.value
    case 'field': return record[node.name]
    case 'star': return '*'
    case 'and': return truthy(evaluate(node.left, record)) && truthy(evaluate(node.right, record))
    case 'or': return truthy(evaluate(node.left, record)) || truthy(evaluate(node.right, record))
    case 'not': return !truthy(evaluate(node.expr, record))
    case 'like': {
      const value = evaluate(node.left, record)
      if (missing(value)) return false
      return node.pattern instanceof RegExp ? node.pattern.test(String(value)) : String(value).includes(node.pattern)
    }
    case 'in': {
      const value = evaluate(node.left, record)
      if (missing(value)) return false
      return node.items.some(item => compare(value, evaluate(item, record)) === 0)
    }
    case 'cmp': {
      const left = evaluate(node.left, record)
      const right = evaluate(node.right, record)
      if (missing(left) || missing(right)) return false
      const c = compare(left, right)
      return { '=': c === 0, '!=': c !== 0, '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[node.op]
    }
    case 'arith': {
      const left = evaluate(node.left, record)
      const right = evaluate(node.right, record)
      if (!isNumeric(left) || !isNumeric(right)) return undefined
      const a = Number(left)
      const b = Number(right)
      return { '+': a + b, '-': a - b, '*': a * b, '/': b === 0 ? undefined : a / b, '%': b === 0 ? undefined : a % b }[node.op]
    }
    case 'call': return callFunction(node, record)
    default: return undefined
  }
}

function truthy(value) { return value !== undefined && value !== null && value !== false && value !== '' && value !== 0 }

function callFunction(node, record) {
  if (node.name in AGGREGATES) throw new QueryError('aggregateOutsideStats', { name: node.name, pos: node.pos }, `${node.name}() can only be used in stats`)
  const args = node.args.map(arg => evaluate(arg, record))
  const s = v => (missing(v) ? undefined : String(v))
  switch (node.name) {
    case 'ispresent': return !missing(args[0])
    case 'isempty': return missing(args[0]) || args[0] === ''
    case 'isblank': return missing(args[0]) || String(args[0]).trim() === ''
    case 'coalesce': return args.find(v => !missing(v) && v !== '')
    case 'strlen': return missing(args[0]) ? undefined : String(args[0]).length
    case 'tolower': return s(args[0])?.toLowerCase()
    case 'toupper': return s(args[0])?.toUpperCase()
    case 'trim': return s(args[0])?.trim()
    case 'concat': return args.map(v => (missing(v) ? '' : String(v))).join('')
    case 'substr': return s(args[0])?.substr(Number(args[1]) || 0, args[2] === undefined ? undefined : Number(args[2]))
    case 'replace': return s(args[0])?.split(String(args[1] ?? '')).join(String(args[2] ?? ''))
    case 'strcontains': return missing(args[0]) ? false : String(args[0]).includes(String(args[1] ?? ''))
    case 'abs': return isNumeric(args[0]) ? Math.abs(Number(args[0])) : undefined
    case 'ceil': return isNumeric(args[0]) ? Math.ceil(Number(args[0])) : undefined
    case 'floor': return isNumeric(args[0]) ? Math.floor(Number(args[0])) : undefined
    case 'bin': return binTime(record['@timestamp'], node.args[0])
    case 'datefloor': return binTime(args[0], node.args[1])
    case 'frommillis': return isNumeric(args[0]) ? formatTimestamp(Number(args[0])) : undefined
    case 'tomillis': return isNumeric(args[0]) ? Number(args[0]) : Date.parse(`${args[0]}Z`)
    default: return undefined
  }
}

function binTime(ts, durationNode) {
  const size = durationNode?.type === 'lit' && durationNode.duration ? durationNode.value : null
  if (!size) throw new QueryError('binDuration', {}, 'bin() needs a duration such as 5m, 1h or 1d')
  if (!isNumeric(ts)) return undefined
  return formatTimestamp(Math.floor(Number(ts) / size) * size)
}

function aggregate(node, rows) {
  if (node.type === 'call' && node.name in AGGREGATES) {
    const [arg, extra] = node.args
    const values = arg && arg.type !== 'star' ? rows.map(r => evaluate(arg, r)).filter(v => !missing(v)) : null
    const numbers = () => values.filter(isNumeric).map(Number)
    switch (node.name) {
      case 'count': return values ? values.length : rows.length
      case 'count_distinct': return new Set(values.map(String)).size
      case 'sum': return numbers().reduce((a, b) => a + b, 0)
      case 'avg': { const n = numbers(); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : undefined }
      case 'min':
      case 'max': {
        const n = numbers()
        const value = n.length ? (node.name === 'min' ? n.reduce((a, b) => Math.min(a, b)) : n.reduce((a, b) => Math.max(a, b))) : values.slice().sort(compare)[node.name === 'min' ? 0 : values.length - 1]
        return arg?.type === 'field' && arg.name === '@timestamp' ? formatTimestamp(value) : value
      }
      case 'stddev': {
        const n = numbers()
        if (!n.length) return undefined
        const mean = n.reduce((a, b) => a + b, 0) / n.length
        return Math.sqrt(n.reduce((a, b) => a + (b - mean) ** 2, 0) / n.length)
      }
      case 'pct': {
        const n = numbers().sort((a, b) => a - b)
        if (!n.length) return undefined
        const p = Number(extra ? evaluate(extra, {}) : 50)
        return n[Math.min(n.length - 1, Math.max(0, Math.ceil((p / 100) * n.length) - 1))]
      }
      case 'earliest':
      case 'latest': {
        let best = null
        for (const row of rows) {
          const value = evaluate(arg, row)
          if (missing(value)) continue
          if (!best || (node.name === 'earliest' ? row['@timestamp'] < best.ts : row['@timestamp'] > best.ts)) best = { ts: row['@timestamp'], value }
        }
        return arg.type === 'field' && arg.name === '@timestamp' && best ? formatTimestamp(best.value) : best?.value
      }
    }
  }
  switch (node.type) {
    case 'lit': return node.value
    case 'arith': {
      const a = aggregate(node.left, rows)
      const b = aggregate(node.right, rows)
      return evaluate({ type: 'arith', op: node.op, left: { type: 'lit', value: a }, right: { type: 'lit', value: b } }, {})
    }
    case 'call': return callFunction({ ...node, args: node.args.map(arg => ({ type: 'lit', value: aggregate(arg, rows) })) }, {})
    default: return rows.length ? evaluate(node, rows[0]) : undefined
  }
}

function roundNumber(value) {
  return typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value
}

/**
 * Runs a query over events ({ timestamp, message, logStreamName }).
 * Returns { fields, rows, statistics } like GetQueryResults (normalized).
 */
export function runQuery(text, events, { logGroup = '' } = {}) {
  const commands = parseQuery(text)
  // Newest first unless the query sorts (also what "limit" keeps).
  let rows = (events || []).map(event => eventRecord(event, logGroup)).sort((a, b) => b['@timestamp'] - a['@timestamp'])
  const recordsScanned = rows.length
  let projection = null
  let display = null
  let aggregated = false
  let limit = null

  for (const command of commands) {
    switch (command.type) {
      case 'fields':
        for (const row of rows) for (const item of command.items) if (item.expr.type !== 'field' || item.name !== item.expr.name) row[item.name] = evaluate(item.expr, row)
        projection = [...new Set([...(projection || []), ...command.items.map(item => item.name)])]
        break
      case 'display':
        for (const row of rows) for (const item of command.items) if (item.expr.type !== 'field' || item.name !== item.expr.name) row[item.name] = evaluate(item.expr, row)
        display = command.items.map(item => item.name)
        break
      case 'filter':
        rows = rows.filter(row => truthy(evaluate(command.expr, row)))
        break
      case 'parse':
        for (const row of rows) {
          const match = missing(row[command.field]) ? null : String(row[command.field]).match(command.regex)
          if (!match) continue
          command.names.forEach((name, index) => { row[name] = command.named ? match.groups?.[name] : match[index + 1] })
        }
        break
      case 'dedup': {
        const seen = new Set()
        rows = rows.filter(row => {
          const key = JSON.stringify(command.items.map(item => evaluate(item.expr, row)))
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        break
      }
      case 'stats': {
        const groups = new Map()
        for (const row of rows) {
          const keys = command.by.map(item => evaluate(item.expr, row))
          const key = JSON.stringify(keys)
          if (!groups.has(key)) groups.set(key, { keys, rows: [] })
          groups.get(key).rows.push(row)
        }
        if (!command.by.length && !groups.size) groups.set('[]', { keys: [], rows: [] })
        rows = [...groups.values()].map(group => {
          const out = {}
          command.by.forEach((item, index) => { out[item.name] = group.keys[index] })
          for (const agg of command.aggs) out[agg.name] = roundNumber(aggregate(agg.expr, group.rows))
          return out
        })
        projection = [...command.by.map(item => item.name), ...command.aggs.map(item => item.name)]
        display = null
        aggregated = true
        break
      }
      case 'sort':
        rows = rows.slice().sort((a, b) => {
          for (const key of command.keys) {
            // after stats, "sort bin(5m)" refers to the column of that name
            const x = key.name in a ? a[key.name] : evaluate(key.expr, a)
            const y = key.name in b ? b[key.name] : evaluate(key.expr, b)
            if (missing(x) && missing(y)) continue
            if (missing(x)) return 1
            if (missing(y)) return -1
            const c = compare(x, y)
            if (c) return key.desc ? -c : c
          }
          return 0
        })
        break
      case 'limit':
        limit = command.n
        rows = rows.slice(0, command.n)
        break
    }
  }

  const recordsMatched = rows.length
  rows = rows.slice(0, limit ?? DEFAULT_LIMIT)
  const fields = display || projection || ['@timestamp', '@message']
  return {
    status: 'Complete',
    fields,
    rows: rows.map(row => Object.fromEntries(fields.map(field => {
      const value = row[field]
      return [field, field === '@timestamp' || field === '@ingestionTime' ? formatTimestamp(value) : roundNumber(value)]
    }))),
    statistics: { recordsScanned, recordsMatched, bytesScanned: null },
    truncated: recordsMatched > rows.length,
  }
}

// ─── Builder and autocomplete helpers ───────────────────────────────────────

function quoteValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function fieldRef(name) {
  return /^[@A-Za-z_][\w@.\-]*$/.test(name) ? name : `\`${name}\``
}

/** One filter condition from the builder (field, operator, value). */
export function buildCondition(field, op, value = '') {
  const f = fieldRef(field)
  switch (op) {
    case 'contains': return `${f} like ${quoteValue(value)}`
    case 'notContains': return `${f} not like ${quoteValue(value)}`
    case 'regex': return `${f} like /${String(value).replace(/\//g, '\\/')}/`
    case 'regexI': return `${f} like /(?i)${String(value).replace(/\//g, '\\/')}/`
    case 'present': return `ispresent(${f})`
    case 'absent': return `not ispresent(${f})`
    case 'in': return `${f} in [${String(value).split(',').map(v => v.trim()).filter(Boolean).map(v => (isNumeric(v) ? v : quoteValue(v))).join(', ')}]`
    default: return `${f} ${op} ${isNumeric(value) ? value : quoteValue(value)}`
  }
}

/** Appends a pipeline stage (e.g. 'filter x = 1') to a query. */
export function appendStage(query, stage) {
  const base = String(query || '').replace(/\s+$/, '')
  return base ? `${base}\n| ${stage}` : stage
}

export const BUILDER_OPERATORS = ['contains', 'notContains', '=', '!=', '>', '>=', '<', '<=', 'regexI', 'regex', 'in', 'present', 'absent']

/**
 * Autocomplete for the editor. Returns the range to replace and the
 * suggestions for the word at the cursor: commands at the start of a stage,
 * aggregates in stats, fields/functions elsewhere.
 */
export function suggest(query, cursor, { fields = BUILTIN_FIELDS, limit = 12 } = {}) {
  const before = String(query || '').slice(0, cursor)
  const stage = before.slice(before.lastIndexOf('|') + 1)
  const word = stage.match(/[@\w.`]*$/)[0]
  const from = cursor - word.length
  const head = stage.slice(0, stage.length - word.length)
  const prefix = word.replace(/`/g, '').toLowerCase()
  const command = head.trim().split(/\s+/)[0]?.toLowerCase() || ''
  const items = []
  const add = (label, insert, kind, detail = '') => {
    if (!prefix || label.toLowerCase().startsWith(prefix) || (kind === 'field' && label.toLowerCase().includes(prefix))) items.push({ label, insert, kind, detail })
  }
  if (!head.trim()) {
    for (const c of COMMANDS) add(c.name, `${c.name} `, 'command', c.syntax)
  } else if (command === 'stats' && !/\bby\b/i.test(head)) {
    for (const [name, sig] of Object.entries(AGGREGATES)) add(name, name === 'count' ? 'count(*)' : `${name}(`, 'aggregate', sig)
    if (/\)\s*$/.test(head)) add('as', 'as ', 'keyword')
    if (/\)\s*$/.test(head) || /\w\s*$/.test(head)) add('by', 'by ', 'keyword')
  } else {
    for (const field of fields) add(field, fieldRef(field), 'field')
    if (command === 'sort') { add('asc', 'asc', 'keyword'); add('desc', 'desc', 'keyword') }
    if (command === 'stats') add('bin(5m)', 'bin(5m)', 'function', FUNCTIONS.bin)
    if (command === 'filter' && /[\w@`)\]"']\s+$/.test(head)) {
      for (const op of ['like', 'not like', 'in', 'and', 'or']) add(op, `${op} `, 'operator')
    }
    for (const [name, sig] of Object.entries(FUNCTIONS)) if (name !== 'bin' || command === 'stats') add(name, `${name}(`, 'function', sig)
  }
  return { from, to: cursor, items: items.slice(0, limit) }
}

/** Templates that fit a log group (kind/service from the inventory, JSON detected in a sample). */
export function templatesFor({ service = null, kind = null, json = false } = {}) {
  return TEMPLATES.filter(t => t.kinds.includes('any')
    || (service === 'lambda' && t.kinds.includes('lambda'))
    || (kind === 'machine' && t.kinds.includes('machine'))
    || (json && t.kinds.includes('json')))
}
