import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ApmTopologyGraph from '../components/cloud/apm/ApmTopologyGraph.vue'
import LogIntelligencePanel from '../components/cloud/logs/LogIntelligencePanel.vue'
import { runQuery, validateQuery } from '../shared/logsQuery.mjs'
import {
  CATEGORIES, categorize, categoryQuery, errorSignature, eventSignals, failureKeywords, lineLevel, lineReferences, sanitizeLogLine, sanitizeWithFindings,
} from '../shared/logSignals.mjs'

describe('shared log signals', () => {
  it('sanitizes credentials, tokens, emails and URL queries', () => {
    const line = sanitizeLogLine('user ana@corp.io key AKIAABCDEFGHIJKLMNOP jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fw https://u:p@api.corp.io/x?token=1 password="s3cr3t"')
    expect(line).not.toMatch(/ana@corp\.io|AKIAABCD|eyJhbGci|u:p@|token=1|s3cr3t/)
    expect(line).toContain('[email]')
    expect(line).toContain('https://[credentials]@api.corp.io/x?[query]')
  })

  it('classifies levels from JSON fields, Lambda format and keywords', () => {
    expect(lineLevel('{"level":"error","msg":"x"}')).toBe('error')
    expect(lineLevel('{"severity":"WARNING"}')).toBe('warn')
    expect(lineLevel('{"level":30,"msg":"error in name only"}')).toBe('info')
    expect(lineLevel('2026-10-01T00:00:00.000Z\t11111111-1111-1111-1111-111111111111\tERROR\tboom')).toBe('error')
    expect(lineLevel('Task timed out after 3.00 seconds')).toBe('error')
    expect(lineLevel('processed batch, errors: 0')).toBe('info')
    expect(lineLevel('WARN disk at 80%')).toBe('warn')
  })

  it('normalizes signatures and detects failure keywords', () => {
    expect(errorSignature('ERROR i-0abc12345678def00 failed after 300 ms (0xdeadbeef)')).toBe('ERROR <id> failed after <n> ms (<hex>)')
    expect(failureKeywords('Task timed out; ECONNREFUSED; Rate exceeded')).toEqual(['timeout', 'throttling', 'connection'])
  })

  it('extracts references to AWS resources, queues, APIs, Kubernetes services and hosts', () => {
    const refs = lineReferences('to arn:aws:lambda:us-east-1:111111111111:function:billing:prod, https://sqs.us-east-1.amazonaws.com/111111111111/jobs.fifo, abcd123456.execute-api.us-east-1.amazonaws.com, http://pay.orders.svc.cluster.local:80/x and https://api.stripe.com/v1')
    expect(refs.map(r => [r.type, r.name])).toEqual([
      ['lambda', 'billing'], ['sqs', 'jobs.fifo'], ['apigateway', 'abcd123456'], ['kubernetes', 'pay'], ['host', 'api.stripe.com'],
    ])
  })

  it('keeps samples only for errors and warnings', () => {
    expect(eventSignals('INFO ok').sample).toBeNull()
    expect(eventSignals('ERROR token=abc failed').sample).toBe('ERROR token: [redacted] failed')
  })
})

describe('ApmTopologyGraph log signals', () => {
  it('shows cached log signals, uncached resources and log evidence on suggestions', async () => {
    const topology = {
      application: { id: 'app', name: 'orders' },
      resources: [
        { id: 'fn', type: 'lambda', name: 'orders-api', enabled: true },
        { id: 'q', type: 'sqs', name: 'jobs', enabled: true },
        { id: 'other', type: 'lambda', name: 'billing', enabled: true },
      ],
      edges: [],
      analysis: {
        score: 50, coveragePercent: 0, counts: { suggestions: 1 },
        findings: [{ code: 'log_error_rate_high', severity: 'warning', resourceIds: ['fn'] }],
        suggestions: [{ sourceResourceId: 'fn', targetResourceId: 'q', relationType: 'sends_to', confidence: 0.75, evidence: [{ type: 'observed_log_reference', values: ['/aws/lambda/orders-api', 'sqs:jobs', '4'] }] }],
        logs: {
          signals: [{
            resourceId: 'fn', resourceName: 'orders-api', logGroup: '/aws/lambda/orders-api',
            last24h: { events: 10, errors: 4, errorRatePercent: 40 }, errorRateHigh: true, lastSyncAt: Date.now(), lastEventAt: Date.now(),
            severeKeywords: { timeout: 4 }, recurringErrors: [{ signature: 'ERROR timeout <n>', occurrences: 4, sample: 'ERROR timeout 1' }],
          }],
          uncachedResourceIds: ['other'],
          unresolvedReferences: [{ type: 'sns', name: 'alerts', target: 'arn', occurrences: 2, seenIn: ['orders-api'] }],
        },
      },
    }
    const wrapper = mount(ApmTopologyGraph, { props: { topology } })
    const section = wrapper.find('.log-intelligence')
    expect(section.find('.log-rate.high').exists()).toBe(true)
    expect(section.text()).toContain('ERROR timeout <n>')
    expect(section.text()).toContain('billing')
    expect(section.text()).toContain('alerts')
    expect(wrapper.find('.suggestion-row').text()).toContain('/aws/lambda/orders-api')
    await section.find('button').trigger('click')
    expect(wrapper.emitted('open-lambda-logs')[0]).toEqual(['orders-api'])
  })
})

describe('log categories and sensitive data', () => {
  it('assigns one primary category, ignoring failure words at info level', () => {
    expect(categorize('ERROR Task timed out after 3.00 seconds')).toBe('timeout')
    expect(categorize('INFO timeout set to 30s')).toBe('info')
    expect(categorize('ERROR User x is not authorized to perform: s3:GetObject')).toBe('access_denied')
    expect(categorize('ERROR TypeError: Cannot read properties of undefined')).toBe('code_exception')
    expect(categorize('WARN ValidationException: bad field')).toBe('validation')
    expect(categorize('REPORT RequestId: a Duration: 2 ms Init Duration: 120 ms')).toBe('cold_start')
    expect(categorize('END RequestId: a')).toBe('platform')
    expect(categorize('ERROR something odd')).toBe('other_error')
  })

  it('every category query is valid and matches its own sample in the local engine', () => {
    for (const category of CATEGORIES) expect(validateQuery(categoryQuery(category.id)).ok, category.id).toBe(true)
    const rows = runQuery(categoryQuery('throttling'), [
      { timestamp: 2, message: 'ERROR Rate exceeded' },
      { timestamp: 1, message: 'ERROR other' },
    ]).rows
    expect(rows.map(r => r['@message'])).toEqual(['ERROR Rate exceeded'])
  })

  it('reports what it redacted by type and recognizes already-redacted text', () => {
    const { text, findings } = sanitizeWithFindings('pay 4111 1111 1111 1111 rut 12.345.678-5 by ana@x.io from 10.1.2.3 api_key=zzz')
    expect(text).toBe('pay [card] rut [rut] by [email] from 10.1.2.3 api_key: [redacted]')
    expect(findings).toEqual({ card: 1, rut: 1, email: 1, ip_address: 1, api_key: 1 })
    expect(sanitizeWithFindings(text).findings).toEqual({ card: 1, rut: 1, email: 1, ip_address: 1, api_key: 1 })
    expect(sanitizeWithFindings('order 4111111111111112 and rut 12.345.678-9 and ts 1727780000000').findings).toEqual({})
  })
})

describe('LogIntelligencePanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows recommendations with snippets and filters events by category', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      calls.push(url)
      const body = url.includes('/log-intelligence/histogram')
        ? { from: 0, to: 120000, binMs: 60000, events: 3, buckets: [{ start: 0, error: 1, warn: 0, info: 2 }, { start: 60000, error: 0, warn: 0, info: 0 }], coverage: { oldest: 0, newest: 100 } }
        : url.includes('/log-intelligence/events')
        ? { truncated: false, blocksRead: 2, events: [{ timestamp: 1, message: 'ERROR Task timed out', level: 'error', category: 'timeout' }] }
        : {
          last24h: { events: 10, errors: 2, warnings: 0, errorRatePercent: 20 }, last7d: { events: 10, errors: 2, errorRatePercent: 20 },
          keywords24h: {}, categories7d: { timeout: 2, info: 8 }, sensitive7d: { email: 1 }, signatures: [], references: [], apm: [], eventsAnalyzed: 10,
          recommendations: [{
            id: 'fix_timeout_lambda', kind: 'fix', severity: 'medium', confidence: 0.65, params: { count: 2 },
            evidence: { signatures: [{ signature: 'Task timed out', occurrences: 2 }] },
            actions: [{ type: 'filter', category: 'timeout' }, { type: 'snippet', language: 'javascript', code: 'const x = 1' }, { type: 'link', url: 'https://docs.aws.amazon.com/x' }],
          }],
        }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    const wrapper = mount(LogIntelligencePanel, { props: { group: '/aws/lambda/orders', profileId: 'p' } })
    await flushPromises()
    const rec = wrapper.find('.li-rec')
    expect(rec.text()).toContain('Task timed out × 2')
    expect(rec.find('a').attributes('href')).toBe('https://docs.aws.amazon.com/x')
    await rec.findAll('.li-actions button')[1].trigger('click')
    expect(wrapper.find('.li-snippet').text()).toContain('const x = 1')
    await rec.findAll('.li-actions button')[0].trigger('click')
    await flushPromises()
    expect(calls.some(url => url.includes('/log-intelligence/events?') && url.includes('category=timeout'))).toBe(true)
    expect(wrapper.find('.li-event').text()).toContain('ERROR Task timed out')
    expect(wrapper.findAll('.li-cat').length).toBe(2)
    wrapper.unmount()
  })

  it('shows anomalies, opens their window and filters by a new error', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const calls = []
    const T = Date.parse('2026-10-02T10:40:00Z')
    vi.stubGlobal('fetch', vi.fn(async url => {
      calls.push(url)
      const body = url.includes('/log-intelligence/histogram')
        ? { from: 0, to: 120000, binMs: 60000, events: 0, buckets: [], coverage: { oldest: 0, newest: 100 } }
        : url.includes('/log-intelligence/events')
        ? { truncated: false, blocksRead: 1, events: [] }
        : {
          last24h: { events: 10, errors: 2, warnings: 0, errorRatePercent: 20 }, last7d: { events: 10, errors: 2, errorRatePercent: 20 },
          keywords24h: {}, categories7d: {}, sensitive7d: {}, signatures: [], references: [], apm: [], eventsAnalyzed: 10, recommendations: [],
          anomalies: {
            status: 'ok', evaluatedAt: T,
            anomalies: [
              { id: 'error_spike', severity: 'high', params: { count: 90, expected: 4.7, ratio: 19.3, rate: 30, baselineRate: 2 }, evidence: { from: T - 4200000, to: T } },
              { id: 'category_surge', category: 'timeout', severity: 'medium', params: { count: 96, category: 'timeout', perDay: 4.8, ratio: 20 }, evidence: { from: T - 86400000, to: T } },
              { id: 'new_errors', severity: 'medium', params: { count: 1 }, evidence: { from: T - 7200000, to: T, signatures: [{ signature: 'TypeError: x', occurrences: 4, sample: 'TypeError' }] } },
            ],
          },
        }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    const wrapper = mount(LogIntelligencePanel, { props: { group: '/aws/lambda/orders', profileId: 'p' } })
    await flushPromises()
    const section = wrapper.get('[data-test="log-anomalies"]')
    expect(section.text()).toContain('90 errors in the last hour, 19.3× the usual')
    expect(section.text()).toContain('Timeouts: 96 in 24 h, 20× the usual rate')

    await wrapper.get('[data-test="log-anomaly-error_spike"] .li-actions button').trigger('click')
    await flushPromises()
    expect(calls.some(url => url.includes('/log-intelligence/events?') && url.includes('level=error') && url.includes(`to=${T}`))).toBe(true)

    await wrapper.get('[data-test="log-anomaly-new_errors"] .li-sig-btn').trigger('click')
    await flushPromises()
    expect(calls.some(url => url.includes('/log-intelligence/events?') && url.includes('signature=TypeError'))).toBe(true)
    wrapper.unmount()
  })

  it('explains why anomalies are not evaluated yet', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('fetch', vi.fn(async url => {
      const body = url.includes('/log-intelligence/histogram')
        ? { from: 0, to: 120000, binMs: 60000, events: 0, buckets: [], coverage: { oldest: 0, newest: 100 } }
        : {
          last24h: { events: 1, errors: 0, warnings: 0, errorRatePercent: 0 }, last7d: { events: 1, errors: 0, errorRatePercent: 0 },
          keywords24h: {}, categories7d: {}, sensitive7d: {}, signatures: [], references: [], apm: [], eventsAnalyzed: 1, recommendations: [],
          anomalies: { status: 'insufficient_history', evaluatedAt: 1, anomalies: [] },
        }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body }
    }))
    const wrapper = mount(LogIntelligencePanel, { props: { group: '/g', profileId: 'p' } })
    await flushPromises()
    expect(wrapper.get('[data-test="log-anomalies"]').text()).toContain('at least 6 hours of synced logs')
    wrapper.unmount()
  })
})
