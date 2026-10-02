import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LogsQueryEditor from '../components/cloud/logs/LogsQueryEditor.vue'
import {
  TEMPLATES, appendStage, buildCondition, discoverFields, eventRecord, runQuery, splitPipeline, suggest, validateQuery,
} from '../shared/logsQuery.mjs'

const T0 = Date.UTC(2026, 9, 1, 12)
const report = (id, duration, init) => `REPORT RequestId: ${id}\tDuration: ${duration} ms\tBilled Duration: ${Math.ceil(duration)} ms\tMemory Size: 128 MB\tMax Memory Used: 64 MB\t${init ? `Init Duration: ${init} ms\t` : ''}`
const events = [
  { timestamp: T0 - 60000, message: report('a', 120.5, 300), logStreamName: 's1' },
  { timestamp: T0 - 50000, message: report('b', 20), logStreamName: 's1' },
  { timestamp: T0 - 40000, message: '{"level":"error","msg":"db down","http":{"status":503}}', logStreamName: 's2' },
  { timestamp: T0 - 30000, message: '{"level":"info","msg":"ok","http":{"status":200}}', logStreamName: 's2' },
  { timestamp: T0 - 20000, message: 'ERROR timeout calling /orders', logStreamName: 'i-0123456789abcdef0' },
]

describe('logs query engine', () => {
  it('discovers JSON and Lambda fields like Logs Insights', () => {
    expect(eventRecord(events[0])).toMatchObject({ '@type': 'REPORT', '@requestId': 'a', '@duration': 120.5, '@initDuration': 300, '@maxMemoryUsed': 64 })
    expect(eventRecord(events[2])).toMatchObject({ level: 'error', 'http.status': 503 })
    expect(discoverFields(events)).toEqual(expect.arrayContaining(['@message', '@duration', 'level', 'http.status']))
  })

  it('filters with like, regex, comparisons, in and boolean logic', () => {
    const rows = q => runQuery(q, events).rows.map(r => r['@message'])
    expect(rows('filter @message like "timeout"')).toHaveLength(1)
    expect(rows('filter @message like /(?i)error/')).toHaveLength(2)
    expect(runQuery('filter http.status >= 500 | fields msg', events).rows).toEqual([{ msg: 'db down' }])
    expect(runQuery('filter level in ["error", "warn"] or @logStream = "s1" | stats count(*) as n', events).rows).toEqual([{ n: 3 }])
    expect(runQuery('filter not ispresent(level) and @message not like "REPORT" | stats count(*) as n', events).rows).toEqual([{ n: 1 }])
  })

  it('parses, aggregates by time bins and sorts by stats columns', () => {
    const latency = runQuery('filter @type = "REPORT" | stats avg(@duration) as avg, pct(@duration, 95) as p95, count(*) as n by bin(1h)', events)
    expect(latency.fields).toEqual(['bin(1h)', 'avg', 'p95', 'n'])
    expect(latency.rows).toEqual([{ 'bin(1h)': '2026-10-01 11:00:00.000', avg: 70.25, p95: 120.5, n: 2 }])
    const parsed = runQuery('parse @message "ERROR * calling *" as kind, path | filter ispresent(path) | display kind, path', events)
    expect(parsed.rows).toEqual([{ kind: 'timeout', path: '/orders' }])
    const byStream = runQuery('stats count(*) as total by @logStream | sort total desc, @logStream asc | limit 2', events)
    expect(byStream.rows.map(r => r['@logStream'])).toEqual(['s1', 's2'])
    expect(runQuery('stats count(*) as n by bin(5m) | sort bin(5m) desc', events).rows[0]['bin(5m)']).toBe('2026-10-01 11:55:00.000')
  })

  it('returns newest events first by default and honours limit', () => {
    const result = runQuery('fields @timestamp, @message | limit 2', events)
    expect(result.rows[0]['@timestamp']).toBe('2026-10-01 11:59:40.000')
    expect(result.rows).toHaveLength(2)
    expect(result.statistics).toEqual({ recordsScanned: 5, recordsMatched: 2, bytesScanned: null })
  })

  it('every template is valid', () => {
    for (const template of TEMPLATES) expect(validateQuery(template.query).ok, template.id).toBe(true)
  })

  it('reports errors with position and suggestions', () => {
    expect(validateQuery('flter @message like "x"').error).toMatchObject({ code: 'unknownCommand', params: { suggestion: 'filter', pos: 0 } })
    expect(validateQuery('filter @message lik "x"').error.params).toMatchObject({ suggestion: 'like', pos: 16 })
    expect(validateQuery('stats @message').error.code).toBe('statsNeedsAggregate')
    expect(validateQuery('filter @message like "x').error.code).toBe('unterminatedString')
    expect(validateQuery('parse @message "a * b *" as x').error.code).toBe('parseNames')
  })

  it('splits stages without breaking on | inside regexes or strings', () => {
    expect(splitPipeline('filter @message like /a|b/ | filter x = "c|d" | limit 1').map(s => s.text.trim()))
      .toEqual(['filter @message like /a|b/', 'filter x = "c|d"', 'limit 1'])
  })

  it('builds conditions and suggests by context', () => {
    expect(buildCondition('@message', 'contains', 'say "hi"')).toBe('@message like "say \\"hi\\""')
    expect(buildCondition('http.status', '>=', '500')).toBe('http.status >= 500')
    expect(buildCondition('my field', 'in', 'a, 2')).toBe('`my field` in ["a", 2]')
    expect(buildCondition('level', 'regexI', 'err/x')).toBe('level like /(?i)err\\/x/')
    expect(appendStage('fields @message  ', 'limit 5')).toBe('fields @message\n| limit 5')
    expect(suggest('', 0).items.map(i => i.label)).toContain('filter')
    expect(suggest('stats co', 8).items.map(i => i.label)).toEqual(['count', 'count_distinct'])
    expect(suggest('filter lev', 10, { fields: ['@message', 'level'] }).items[0]).toMatchObject({ label: 'level', kind: 'field' })
  })
})

describe('LogsQueryEditor', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubFetch(handler) {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => handler(url, options) }
    }))
    return calls
  }

  const group = { name: '/aws/lambda/orders', kind: 'aws', service: 'lambda', cache: { windowMs: 1 } }

  it('accepts autocomplete suggestions and adds filters from the builder', async () => {
    stubFetch(() => ({}))
    const wrapper = mount(LogsQueryEditor, { props: { group, profileId: 'p', sampleEvents: events }, attachTo: document.body })
    const textarea = wrapper.find('textarea')
    await textarea.setValue('fil')
    textarea.element.setSelectionRange(3, 3)
    await textarea.trigger('input')
    expect(wrapper.find('.lq-suggest').text()).toContain('filter')
    await textarea.trigger('keydown', { key: 'Tab' })
    expect(textarea.element.value).toBe('filter ')

    await textarea.setValue('fields @message')
    const [field, op] = wrapper.findAll('.lq-help select')
    await field.setValue('@message')
    await op.setValue('contains')
    await wrapper.find('.lq-value').setValue('timeout')
    await wrapper.find('.lq-add-filter').trigger('click')
    expect(textarea.element.value).toBe('fields @message\n| filter @message like "timeout"')
    wrapper.unmount()
  })

  it('runs on the cache for free, and asks before running Logs Insights', async () => {
    const calls = stubFetch(url => {
      if (url.includes('/log-groups/query')) return { source: 'cache', status: 'Complete', fields: ['n'], rows: [{ n: 3 }], statistics: { recordsScanned: 5, recordsMatched: 1 }, coverage: { events: 5, truncated: false } }
      if (url.includes('/insights/estimate')) return { estimatedBytes: 2 * 1024 ** 3, estimatedCostUsd: 0.01, unknown: false }
      if (url.endsWith('/log-groups/insights')) return { queryId: 'q1', region: 'us-east-1' }
      return { status: 'Complete', fields: ['n'], rows: [{ n: 7 }], storedInCache: 7, statistics: { bytesScanned: 1024 ** 3, recordsMatched: 7, recordsScanned: 70 } }
    })
    const wrapper = mount(LogsQueryEditor, { props: { group, profileId: 'p', sampleEvents: events } })
    await wrapper.find('textarea').setValue('stats count(*) as n')
    await wrapper.find('.btn.primary').trigger('click')
    await flushPromises()
    expect(calls[0].body).toMatchObject({ group: group.name, source: 'cache', query: 'stats count(*) as n' })
    expect(wrapper.find('.lq-table').text()).toContain('3')

    await wrapper.find('select').setValue('insights')
    await wrapper.find('.btn.primary').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.url.endsWith('/log-groups/insights'))).toBe(false)
    expect(wrapper.find('.lq-confirm').text()).toContain('2.0 GB')
    await wrapper.find('.lq-confirm .btn.primary').trigger('click')
    await flushPromises()
    expect(calls.some(c => c.url.includes('/logs-query/q1?region=us-east-1&group=%2Faws%2Flambda%2Forders'))).toBe(true)
    expect(wrapper.emitted('ingested')[0]).toEqual([7])
    expect(wrapper.find('.lq-table').text()).toContain('7')
    expect(wrapper.find('.lq-meta').text()).toContain('1.0 GB')
    wrapper.unmount()
  })
})
