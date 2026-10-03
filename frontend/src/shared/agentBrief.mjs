/**
 * shared/agentBrief.mjs
 * Turns what KUA already computed (an Advisor report, the log intelligence of
 * a log group) into a self-contained Markdown brief that any coding agent or
 * LLM (Claude Code, Codex, ChatGPT, Cursor…) can act on: context, the task,
 * every finding with its evidence and affected resources, snippets, queries,
 * docs and how to verify the fix.
 *
 * Pure and deterministic: no API calls. Texts come from the caller's `t`
 * (i18n keys agentBrief.*, advisor.*, awsLogs.*), so the frontend renders it in
 * the UI language and the backend (MCP server) can reuse it with its own `t`.
 * Log samples and signatures reach this module already sanitized by KUA.
 */

const SEVERITY_ORDER = ['high', 'medium', 'low']

/** Inline code that survives names containing backticks. */
function code(value) {
  return `\`${String(value ?? '').replace(/`/g, "'")}\``
}

/** Fenced block whose fence is longer than any backtick run inside. */
function fence(text, language = '') {
  const body = String(text ?? '')
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map(match => match[0].length))
  const marks = '`'.repeat(longest + 1)
  return `${marks}${language}\n${body}\n${marks}`
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

function header(t, { title, generatedAt, context }) {
  const lines = [`# ${title}`, '', `> ${t('agentBrief.generatedBy', { date: generatedAt })}`, '']
  const entries = Object.entries(context || {}).filter(([, value]) => value != null && value !== '')
  if (entries.length) {
    lines.push(`## ${t('agentBrief.context')}`, '')
    for (const [label, value] of entries) lines.push(`- **${label}:** ${code(value)}`)
    lines.push('')
  }
  return lines
}

function task(t, rulesKeys) {
  return [
    `## ${t('agentBrief.task')}`,
    '',
    t('agentBrief.taskIntro'),
    '',
    ...rulesKeys.map((key, i) => `${i + 1}. ${t(key)}`),
    '',
  ]
}

const COMMON_RULES = [
  'agentBrief.rule.verify',
  'agentBrief.rule.order',
  'agentBrief.rule.iac',
  'agentBrief.rule.confirm',
  'agentBrief.rule.secrets',
  'agentBrief.rule.report',
]

function countBySeverity(items) {
  return SEVERITY_ORDER.map(severity => [severity, items.filter(item => item.severity === severity).length])
    .filter(([, count]) => count)
}

/** Labels of the report scope, ready for the Context section. */
function scopeContext(t, scope) {
  if (!scope) return {}
  return {
    [t('agentBrief.field.provider')]: scope.provider,
    [t('agentBrief.field.region')]: scope.region,
    [t('agentBrief.field.project')]: scope.projectId,
    [t('agentBrief.field.namespace')]: scope.namespace,
    [t('agentBrief.field.application')]: scope.applicationId,
    [t('agentBrief.field.excludes')]: scope.excludes,
  }
}

/**
 * Brief for an Advisor report (lib/advisor/core.js buildReport output).
 * @param report  { generatedAt, scope, findings, unavailable }
 * @param options { t, context?: { label: value }, lens?: 'technical' | 'product', now? }
 */
export function advisorBrief(report, { t, context = {}, lens = 'technical', now = Date.now() } = {}) {
  if (typeof t !== 'function') throw new Error('t is required')
  const findings = report?.findings || []
  const generatedAt = report?.generatedAt || new Date(now).toISOString()
  const lines = header(t, {
    title: t(lens === 'product' ? 'agentBrief.advisorTitleProduct' : 'agentBrief.advisorTitle'),
    generatedAt,
    context: { ...scopeContext(t, report?.scope), ...context },
  })

  lines.push(...task(t, COMMON_RULES))

  const counts = countBySeverity(findings).map(([severity, count]) => `${count} ${t(`advisor.severity.${severity}`)}`)
  lines.push(`## ${t('agentBrief.findings', { n: findings.length })}`, '')
  if (counts.length) lines.push(t('agentBrief.summary', { list: counts.join(', ') }), '')
  if (!findings.length) lines.push(t('agentBrief.noFindings'), '')

  findings.forEach((finding, index) => {
    const params = { count: finding.count, ...finding.params }
    lines.push(
      `### ${index + 1}. [${t(`advisor.severity.${finding.severity}`).toUpperCase()}] ${oneLine(t(`advisor.rule.${finding.id}.title`, params))}`,
      '',
      `- **${t('agentBrief.field.rule')}:** ${code(finding.id)} · **${t('agentBrief.field.category')}:** ${t(`advisor.cat.${finding.category}`)}`,
      '',
      oneLine(t(`advisor.rule.${finding.id}.body`, params)),
      '',
    )
    if (finding.resources?.length) {
      lines.push(`**${t('agentBrief.resources', { n: finding.count })}**`, '')
      for (const resource of finding.resources) {
        const name = `${resource.namespace ? `${resource.namespace}/` : ''}${resource.name}`
        lines.push(`- ${resource.kind ? `${resource.kind} ` : ''}${code(name)}${resource.detail ? ` — ${oneLine(resource.detail)}` : ''}`)
      }
      if (finding.truncated) lines.push(`- ${t('advisor.more', { n: finding.count - finding.resources.length })}`)
      lines.push('')
    }
    if (finding.docs) lines.push(`${t('agentBrief.docs')}: ${finding.docs}`, '')
  })

  if (report?.unavailable?.length) {
    lines.push(`## ${t('agentBrief.notChecked')}`, '', t('agentBrief.notCheckedHint'), '')
    for (const item of report.unavailable) {
      lines.push(`- ${code(item.action || item.source)}${item.error ? ` — ${oneLine(item.error)}` : ''}`)
    }
    lines.push('')
  }

  lines.push(`## ${t('agentBrief.verify')}`, '', t(lens === 'product' ? 'agentBrief.verifyProduct' : 'agentBrief.verifyAdvisor'), '')
  return `${lines.join('\n').trimEnd()}\n`
}

function percent(value) {
  return value == null ? '—' : `${value}%`
}

/**
 * Brief for the log intelligence of a log group (GET log-intelligence output:
 * last24h, last7d, recommendations, signatures, references…).
 * @param data    log intelligence of the group
 * @param options { t, group, context?: { label: value }, now? }
 */
export function logsBrief(data, { t, group, context = {}, now = Date.now() } = {}) {
  if (typeof t !== 'function') throw new Error('t is required')
  const recommendations = data?.recommendations || []
  const lines = header(t, {
    title: t('agentBrief.logsTitle', { group }),
    generatedAt: new Date(now).toISOString(),
    context: { [t('agentBrief.field.logGroup')]: group, ...context },
  })

  lines.push(...task(t, ['agentBrief.rule.logsLocate', ...COMMON_RULES]))

  if (data?.last24h || data?.last7d) {
    lines.push(
      `## ${t('agentBrief.activity')}`,
      '',
      `| | ${t('agentBrief.field.events')} | ${t('agentBrief.field.errors')} | ${t('agentBrief.field.warnings')} | ${t('agentBrief.field.errorRate')} |`,
      '|---|---:|---:|---:|---:|',
    )
    for (const [label, window] of [['24 h', data.last24h], ['7 d', data.last7d]]) {
      if (window) lines.push(`| ${label} | ${window.events ?? 0} | ${window.errors ?? 0} | ${window.warnings ?? 0} | ${percent(window.errorRatePercent)} |`)
    }
    lines.push('', t('agentBrief.analyzed', { n: data.eventsAnalyzed ?? 0 }), '')
  }

  lines.push(`## ${t('agentBrief.recommendations', { n: recommendations.length })}`, '')
  if (!recommendations.length) lines.push(t('agentBrief.noRecommendations'), '')

  recommendations.forEach((rec, index) => {
    lines.push(
      `### ${index + 1}. [${t(`awsLogs.intel.severity_${rec.severity}`).toUpperCase()}] ${oneLine(t(`awsLogs.rec.${rec.id}.title`, rec.params))}`,
      '',
      `- **${t('agentBrief.field.kind')}:** ${t(`awsLogs.intel.kind_${rec.kind}`)}${rec.category ? ` · **${t('agentBrief.field.category')}:** ${t(`awsLogs.cat.${rec.category}`)}` : ''} · **${t('agentBrief.field.confidence')}:** ${Math.round((rec.confidence || 0) * 100)}%`,
      '',
      oneLine(t(`awsLogs.rec.${rec.id}.body`, rec.params)),
      '',
    )
    const evidence = rec.evidence || {}
    if (evidence.signatures?.length) {
      lines.push(`**${t('agentBrief.evidence')}**`, '')
      for (const signature of evidence.signatures) {
        lines.push(`- ${code(signature.signature)} × ${signature.occurrences}`)
        if (signature.sample && signature.sample !== signature.signature) lines.push(`  - ${t('agentBrief.sample')}: ${code(oneLine(signature.sample))}`)
      }
      lines.push('')
    }
    if (evidence.sensitive7d && Object.keys(evidence.sensitive7d).length) {
      lines.push(`**${t('agentBrief.sensitive')}**`, '')
      for (const [type, count] of Object.entries(evidence.sensitive7d)) lines.push(`- ${t(`awsLogs.sens.${type}`)}: ${count}`)
      lines.push('')
    }
    for (const action of rec.actions || []) {
      if (action.type === 'query') lines.push(`**${t('agentBrief.query')}**`, '', fence(action.query), '')
      else if (action.type === 'snippet') lines.push(`**${t('agentBrief.snippet', { language: action.language })}**`, '', fence(action.code, action.language), '')
      else if (action.type === 'link') lines.push(`${t('agentBrief.docs')}: ${action.url}`, '')
    }
  })

  const signatures = data?.signatures || []
  if (signatures.length) {
    lines.push(`## ${t('agentBrief.signatures')}`, '')
    for (const signature of signatures.slice(0, 15)) {
      lines.push(`- [${t(`awsLogs.cat.${signature.category || 'other_error'}`)}] ${code(signature.signature)} × ${signature.occurrences}`)
    }
    lines.push('')
  }

  const references = data?.references || []
  if (references.length) {
    lines.push(`## ${t('agentBrief.dependencies')}`, '', t('agentBrief.dependenciesHint'), '')
    for (const reference of references.slice(0, 20)) {
      lines.push(`- ${reference.type} ${code(`${reference.name}${reference.namespace ? `.${reference.namespace}` : ''}`)} × ${reference.occurrences}`)
    }
    lines.push('')
  }

  lines.push(`## ${t('agentBrief.verify')}`, '', t('agentBrief.verifyLogs'), '')
  return `${lines.join('\n').trimEnd()}\n`
}

/** File name for a downloaded brief: kua-brief-<slug>-<yyyy-mm-dd>.md */
export function briefFileName(subject, now = Date.now()) {
  const slug = String(subject || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report'
  return `kua-brief-${slug}-${new Date(now).toISOString().slice(0, 10)}.md`
}
