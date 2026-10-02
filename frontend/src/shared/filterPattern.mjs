// CloudWatch Logs filter pattern syntax, evaluated locally so searching the
// cache gives the same answer as FilterLogEvents. Supported:
//   terms            ERROR timeout          (all terms, case-sensitive)
//   phrases          "Task timed out"
//   optional terms   ?ERROR ?WARN           (at least one)
//   excluded terms   ERROR -healthcheck
//   JSON             { $.level = "error" && $.latency > 500 }   (=, !=, <, <=, >, >=,
//                    wildcards in strings, IS NULL, NOT EXISTS, IS TRUE/FALSE, && || ( ))
//   space-delimited  [ip, user, ts, request, status_code = 5*, bytes > 1000]   (… as ...)
// Anything else reports `unsupported` instead of silently matching nothing.

function wildcardRegex(value) {
  return new RegExp(`^${String(value).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
}

function compareValues(actual, op, expected) {
  if (actual === undefined || actual === null) return op === '!=' ? true : false
  if (typeof expected === 'number') {
    const n = Number(actual)
    if (!Number.isFinite(n)) return op === '!='
    return { '=': n === expected, '!=': n !== expected, '<': n < expected, '<=': n <= expected, '>': n > expected, '>=': n >= expected }[op]
  }
  const text = typeof actual === 'string' ? actual : JSON.stringify(actual)
  const matches = String(expected).includes('*') ? wildcardRegex(expected).test(text) : text === String(expected)
  return op === '=' ? matches : op === '!=' ? !matches : false
}

// ─── Terms ──

function tokenizeTerms(pattern) {
  const tokens = []
  const re = /([?-]?)(?:"((?:[^"\\]|\\.)*)"|(\S+))/g
  let match
  while ((match = re.exec(pattern))) tokens.push({ mode: match[1] || '', text: match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3] })
  return tokens
}

function compileTerms(pattern) {
  const tokens = tokenizeTerms(pattern)
  const required = tokens.filter(t => !t.mode).map(t => t.text)
  const optional = tokens.filter(t => t.mode === '?').map(t => t.text)
  const excluded = tokens.filter(t => t.mode === '-').map(t => t.text)
  return message => required.every(t => message.includes(t)) &&
    (!optional.length || optional.some(t => message.includes(t))) &&
    !excluded.some(t => message.includes(t))
}

// ─── JSON patterns ──

function jsonPath(object, path) {
  let current = object
  for (const part of path.replace(/^\$\.?/, '').split(/\.|\[(\d+)\]/).filter(p => p !== undefined && p !== '')) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }
  return current
}

function compileJson(body) {
  const tokens = body.match(/&&|\|\||\(|\)|"(?:[^"\\]|\\.)*"|\$[\w.[\]]*|!=|<=|>=|=|<|>|IS\s+NULL|NOT\s+EXISTS|IS\s+TRUE|IS\s+FALSE|-?\d+(?:\.\d+)?|[^\s()]+/gi) || []
  let i = 0
  const peek = () => tokens[i]
  const next = () => tokens[i++]
  function primary() {
    const token = next()
    if (token === '(') { const expr = or(); if (next() !== ')') throw new Error('Missing )'); return expr }
    if (!token?.startsWith('$')) throw new Error(`Expected a $.field, found ${token ?? 'end'}`)
    const op = next()
    if (/^IS\s+NULL$/i.test(op)) return o => jsonPath(o, token) === null
    if (/^NOT\s+EXISTS$/i.test(op)) return o => jsonPath(o, token) === undefined
    if (/^IS\s+TRUE$/i.test(op)) return o => jsonPath(o, token) === true
    if (/^IS\s+FALSE$/i.test(op)) return o => jsonPath(o, token) === false
    if (!['=', '!=', '<', '<=', '>', '>='].includes(op)) throw new Error(`Unsupported operator ${op}`)
    const raw = next()
    if (raw === undefined) throw new Error('Missing value')
    const value = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : (Number.isFinite(Number(raw)) ? Number(raw) : raw)
    return o => compareValues(jsonPath(o, token), op, value)
  }
  function and() {
    let left = primary()
    while (peek() === '&&') { next(); const l = left; const r = primary(); left = o => l(o) && r(o) }
    return left
  }
  function or() {
    let left = and()
    while (peek() === '||') { next(); const l = left; const r = and(); left = o => l(o) || r(o) }
    return left
  }
  const expr = or()
  if (i < tokens.length) throw new Error(`Unexpected ${tokens[i]}`)
  return message => {
    const text = message.trim()
    if (!text.startsWith('{')) return false
    try { return !!expr(JSON.parse(text)) } catch { return false }
  }
}

// ─── Space-delimited patterns ──

function splitFields(message) {
  const fields = []
  const re = /"([^"]*)"|\[([^\]]*)\]|(\S+)/g
  let match
  while ((match = re.exec(message))) fields.push(match[1] ?? match[2] ?? match[3])
  return fields
}

function compileSpaceDelimited(body) {
  const specs = body.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    if (part === '...') return { ellipsis: true }
    const condition = part.match(/^([\w.-]+)\s*(!=|<=|>=|=|<|>)\s*(.+)$/)
    if (!condition) return { name: part }
    const raw = condition[3].trim().replace(/^"(.*)"$/, '$1')
    return { name: condition[1], op: condition[2], value: Number.isFinite(Number(raw)) && !raw.includes('*') ? Number(raw) : raw }
  })
  const ellipsisAt = specs.findIndex(s => s.ellipsis)
  return message => {
    const fields = splitFields(message)
    let aligned
    if (ellipsisAt < 0) {
      if (fields.length !== specs.length) return false
      aligned = specs.map((spec, index) => [spec, fields[index]])
    } else {
      const before = specs.slice(0, ellipsisAt)
      const after = specs.slice(ellipsisAt + 1)
      if (fields.length < before.length + after.length) return false
      aligned = [...before.map((spec, index) => [spec, fields[index]]), ...after.map((spec, index) => [spec, fields[fields.length - after.length + index]])]
    }
    return aligned.every(([spec, value]) => !spec.op || compareValues(value, spec.op, spec.value))
  }
}

/**
 * Compiles a filter pattern. Returns { match(message) → boolean, kind, error }.
 * When the pattern cannot be compiled, `match` returns false and `error` says why.
 */
export function compileFilterPattern(pattern) {
  const text = String(pattern ?? '').trim()
  if (!text) return { kind: 'all', match: () => true, error: null }
  try {
    if (text.startsWith('{')) {
      if (!text.endsWith('}')) throw new Error('JSON patterns must end with }')
      return { kind: 'json', match: compileJson(text.slice(1, -1)), error: null }
    }
    if (text.startsWith('[')) {
      if (!text.endsWith(']')) throw new Error('Space-delimited patterns must end with ]')
      return { kind: 'space', match: compileSpaceDelimited(text.slice(1, -1)), error: null }
    }
    return { kind: 'terms', match: compileTerms(text), error: null }
  } catch (err) {
    return { kind: 'invalid', match: () => false, error: err.message }
  }
}
