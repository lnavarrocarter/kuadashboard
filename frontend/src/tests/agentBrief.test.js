import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import { advisorBrief, briefFileName, logsBrief } from '../shared/agentBrief.mjs'
import { translate } from '../composables/useI18n'
import { settings } from '../composables/useSettings'
import AdvisorPanel from '../components/advisor/AdvisorPanel.vue'

const en = (key, params) => translate('en', key, params)
const es = (key, params) => translate('es', key, params)
const NOW = Date.parse('2026-10-02T10:00:00Z')

function report() {
  return {
    generatedAt: '2026-10-02T09:00:00Z',
    scope: { provider: 'aws', region: 'us-east-1' },
    categories: ['security', 'infrastructure'],
    summary: {},
    findings: [
      {
        id: 'aws.root_mfa', category: 'security', severity: 'high', count: 1, params: {},
        docs: 'https://docs.aws.amazon.com/root-mfa', resources: [{ kind: 'Account', name: 'root' }], truncated: false,
      },
      {
        id: 'aws.orphan_volumes', category: 'infrastructure', severity: 'low', count: 12, params: {}, docs: null,
        resources: [{ kind: 'EBS', name: 'vol-`odd`', detail: '20 GiB\n gp3' }], truncated: true,
      },
    ],
    unavailable: [{ source: 'rds', action: 'rds:DescribeDBInstances', error: 'AccessDenied' }],
  }
}

function intel() {
  return {
    eventsAnalyzed: 1200,
    last24h: { events: 300, errors: 30, warnings: 4, errorRatePercent: 10 },
    last7d: { events: 1200, errors: 90, warnings: 20, errorRatePercent: 7.5 },
    recommendations: [
      {
        id: 'fix_timeout_lambda', kind: 'fix', category: 'timeout', severity: 'medium', confidence: 0.8,
        params: { count: 14, count24h: 3 },
        evidence: { signatures: [{ signature: 'Task timed out after <n> seconds', occurrences: 14, sample: 'Task timed out after 3.00 seconds' }] },
        actions: [
          { type: 'filter', category: 'timeout' },
          { type: 'query', query: 'fields @timestamp\n| filter @message like /timeout/' },
          { type: 'snippet', language: 'javascript', code: 'const md = "```inside```"' },
          { type: 'link', url: 'https://docs.aws.amazon.com/lambda/timeout' },
        ],
      },
      {
        id: 'sanitize_at_source', kind: 'sanitize', severity: 'high', confidence: 0.85,
        params: { types: 'email', count: 3 }, evidence: { sensitive7d: { email: 3 } }, actions: [],
      },
    ],
    signatures: [{ signature: 'Task timed out after <n> seconds', occurrences: 14, category: 'timeout', level: 'error' }],
    references: [{ kind: 'arn', target: 'arn:aws:sqs:x', type: 'sqs', name: 'orders', occurrences: 5 }],
  }
}

describe('advisorBrief', () => {
  it('builds a self-contained Markdown brief with context, task, findings and verification', () => {
    const md = advisorBrief(report(), { t: en, context: { Account: '123456789012' }, now: NOW })

    expect(md).toMatch(/^# KUA brief: good-practice findings\n/)
    expect(md).toContain('- **Provider:** `aws`')
    expect(md).toContain('- **Region:** `us-east-1`')
    expect(md).toContain('- **Account:** `123456789012`')
    expect(md).toContain('## Your task')
    expect(md).toContain(en('agentBrief.rule.confirm'))
    expect(md).toContain('## Findings (2)')
    expect(md).toContain('By severity: 1 high, 1 low.')
    expect(md).toContain(`### 1. [HIGH] ${en('advisor.rule.aws.root_mfa.title', { count: 1 })}`)
    expect(md).toContain('- **Rule:** `aws.root_mfa` · **Category:** Security')
    expect(md).toContain('Documentation: https://docs.aws.amazon.com/root-mfa')
    expect(md).toContain('### 2. [LOW]')
    expect(md).toContain('- EBS `vol-\'odd\'` — 20 GiB gp3')
    expect(md).toContain('- …and 11 more')
    expect(md).toContain('## Not checked')
    expect(md).toContain('- `rds:DescribeDBInstances` — AccessDenied')
    expect(md).toContain('## How to verify')
    expect(md.endsWith('\n')).toBe(true)
    expect(md).not.toMatch(/\{\w+\}/)
  })

  it('renders in Spanish with the Spanish translator and says when everything passes', () => {
    const md = advisorBrief({ ...report(), findings: [], unavailable: [] }, { t: es, now: NOW })
    expect(md).toContain('# Brief de KUA: hallazgos de buenas prácticas')
    expect(md).toContain('## Hallazgos (0)')
    expect(md).toContain(es('agentBrief.noFindings'))
    expect(md).not.toContain('## Sin revisar')
  })

  it('uses the product wording for the product lens', () => {
    const md = advisorBrief({ findings: [], scope: { provider: 'aws', applicationId: 'app-1' } }, { t: en, lens: 'product', now: NOW })
    expect(md).toContain('# KUA brief: product findings')
    expect(md).toContain('- **Application:** `app-1`')
    expect(md).toContain(en('agentBrief.verifyProduct'))
  })

  it('requires a translator', () => {
    expect(() => advisorBrief(report(), {})).toThrow('t is required')
  })
})

describe('logsBrief', () => {
  it('includes activity, recommendations with evidence, queries, snippets and dependencies', () => {
    const md = logsBrief(intel(), { t: en, group: '/aws/lambda/orders', now: NOW })

    expect(md).toContain('# KUA brief: log intelligence for /aws/lambda/orders')
    expect(md).toContain('- **Log group:** `/aws/lambda/orders`')
    expect(md).toContain(`1. ${en('agentBrief.rule.logsLocate')}`)
    expect(md).toContain('| 24 h | 300 | 30 | 4 | 10% |')
    expect(md).toContain('| 7 d | 1200 | 90 | 20 | 7.5% |')
    expect(md).toContain('## Recommendations (2)')
    expect(md).toContain(`[MEDIUM] ${en('awsLogs.rec.fix_timeout_lambda.title', { count: 14, count24h: 3 })}`)
    expect(md).toContain('**Confidence:** 80%')
    expect(md).toContain('- `Task timed out after <n> seconds` × 14')
    expect(md).toContain('  - sample: `Task timed out after 3.00 seconds`')
    expect(md).toContain('```\nfields @timestamp\n| filter @message like /timeout/\n```')
    // A snippet containing ``` gets a longer fence so the Markdown stays valid
    expect(md).toContain('````javascript\nconst md = "```inside```"\n````')
    expect(md).toContain('Documentation: https://docs.aws.amazon.com/lambda/timeout')
    expect(md).toContain(`- ${en('awsLogs.sens.email')}: 3`)
    expect(md).toContain('## Resources mentioned in the logs')
    expect(md).toContain('- sqs `orders` × 5')
    expect(md).not.toContain('View events')
  })

  it('handles a group without data', () => {
    const md = logsBrief(null, { t: en, group: 'g', now: NOW })
    expect(md).toContain('## Recommendations (0)')
    expect(md).toContain(en('agentBrief.noRecommendations'))
    expect(md).not.toContain('## Activity')
  })
})

describe('briefFileName', () => {
  it('slugs the subject and dates the file', () => {
    expect(briefFileName('/aws/lambda/Orders API', NOW)).toBe('kua-brief-aws-lambda-orders-api-2026-10-02.md')
    expect(briefFileName('', NOW)).toBe('kua-brief-report-2026-10-02.md')
  })
})

describe('AdvisorPanel agent brief', () => {
  let writeText

  beforeEach(() => {
    settings.lang = 'en'
    try { localStorage.clear() } catch { /* jsdom */ }
    writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  afterEach(() => { delete navigator.clipboard })

  it('copies the brief with the extra context', async () => {
    const wrapper = mount(AdvisorPanel, { props: { report: report(), briefContext: { Account: '123456789012' } } })
    await wrapper.get('[data-test="agent-brief-copy"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledTimes(1)
    const md = writeText.mock.calls[0][0]
    expect(md).toContain('# KUA brief: good-practice findings')
    expect(md).toContain('- **Account:** `123456789012`')
  })

  it('hides the brief actions when there are no findings', () => {
    const wrapper = mount(AdvisorPanel, { props: { report: { ...report(), findings: [] } } })
    expect(wrapper.find('[data-test="agent-brief"]').exists()).toBe(false)
  })
})
