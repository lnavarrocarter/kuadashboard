import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LogHistogram from '../components/cloud/logs/LogHistogram.vue'
import { compileFilterPattern } from '../shared/filterPattern.mjs'
import { timeSeriesFromRows } from '../lib/awsLogs'

describe('filter patterns (same semantics live and in the cache)', () => {
  const match = (pattern, message) => compileFilterPattern(pattern).match(message)
  it('handles terms, phrases, optional and excluded terms', () => {
    expect(match('ERROR timeout', 'ERROR db timeout')).toBe(true)
    expect(match('ERROR timeout', 'ERROR db slow')).toBe(false)
    expect(match('"Task timed out"', 'x Task timed out after 3s')).toBe(true)
    expect(match('?ERROR ?WARN', 'WARN disk')).toBe(true)
    expect(match('?ERROR ?WARN', 'INFO ok')).toBe(false)
    expect(match('ERROR -healthcheck', 'ERROR healthcheck failed')).toBe(false)
    expect(match('error', 'ERROR upper')).toBe(false)
    expect(match('', 'anything')).toBe(true)
  })
  it('handles JSON patterns with comparisons, wildcards and logic', () => {
    expect(match('{ $.level = "error" && $.latency > 500 }', '{"level":"error","latency":800}')).toBe(true)
    expect(match('{ $.level = "error" && $.latency > 500 }', '{"level":"error","latency":100}')).toBe(false)
    expect(match('{ $.user.id = "ab*" || $.code = 7 }', '{"user":{"id":"abc"}}')).toBe(true)
    expect(match('{ $.missing NOT EXISTS }', '{"a":1}')).toBe(true)
    expect(match('{ $.level = "error" }', 'plain text')).toBe(false)
  })
  it('handles space-delimited patterns with ellipsis', () => {
    expect(match('[ip, user, ..., status = 5*, bytes]', '10.0.0.1 bob "GET /x" 503 120')).toBe(true)
    expect(match('[ip, user, ..., status = 5*, bytes]', '10.0.0.1 bob "GET /x" 200 120')).toBe(false)
    expect(match('[ip, user, ..., status, bytes > 100]', '10.0.0.1 bob 200 99')).toBe(false)
  })
  it('reports invalid patterns instead of matching nothing silently', () => {
    expect(compileFilterPattern('{ $.a = }').error).toBeTruthy()
    expect(compileFilterPattern('{ $.a = 1').error).toMatch(/end with/)
  })
})

describe('timeSeriesFromRows', () => {
  it('builds buckets from bin() results and fills empty bins', () => {
    const series = timeSeriesFromRows(['bin(5m)', 'errors'], [
      { 'bin(5m)': '2026-10-01 12:10:00.000', errors: 3 },
      { 'bin(5m)': '2026-10-01 12:00:00.000', errors: 1 },
    ])
    expect(series.binMs).toBe(300000)
    expect(series.buckets.map(b => b.value)).toEqual([1, 0, 3])
    expect(series.buckets[0].start).toBe(Date.UTC(2026, 9, 1, 12))
  })
  it('ignores results without a time column or a numeric column', () => {
    expect(timeSeriesFromRows(['@logStream', 'count'], [{ '@logStream': 'a', count: 1 }, { '@logStream': 'b', count: 2 }])).toBeNull()
    expect(timeSeriesFromRows(['@timestamp', '@message'], [{ '@timestamp': '2026-10-01 12:00:00.000', '@message': 'x' }, { '@timestamp': '2026-10-01 12:01:00.000', '@message': 'y' }])).toBeNull()
  })
})

describe('LogHistogram', () => {
  afterEach(() => vi.unstubAllGlobals())
  const series = [{ key: 'error', label: 'Errors', color: 'red' }, { key: 'info', label: 'Info', color: 'blue' }]
  const buckets = [{ start: 0, error: 2, info: 3 }, { start: 1000, error: 0, info: 0 }, { start: 2000, error: 1, info: 0 }]

  it('stacks levels, shows totals, a tooltip and a table, and zooms on click and drag', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const wrapper = mount(LogHistogram, { props: { buckets, binMs: 1000, series, title: 'Events' } })
    expect(wrapper.find('.lh-legend').text()).toContain('Errors 3')
    expect(wrapper.findAll('path')).toHaveLength(3)
    const hits = wrapper.findAll('.lh-hit')
    await hits[0].trigger('pointerenter')
    expect(wrapper.find('.lh-tip').text()).toContain('5')
    await hits[0].trigger('pointerdown')
    await hits[0].trigger('pointerup')
    expect(wrapper.emitted('zoom')[0][0]).toEqual({ from: 0, to: 1000 })
    await hits[0].trigger('pointerdown')
    await hits[2].trigger('pointermove')
    await hits[2].trigger('pointerup')
    expect(wrapper.emitted('zoom')[1][0]).toEqual({ from: 0, to: 3000 })
    expect(wrapper.find('svg').attributes('style')).toContain('height: 170px')
    const [chartButton, tableButton] = wrapper.findAll('.lh-switch button')
    await tableButton.trigger('click')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(tableButton.classes()).toContain('accent')
    await chartButton.trigger('click')
    expect(wrapper.find('svg').exists()).toBe(true)
  })
})

describe('LogHistogram coverage', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('shades the bins before the covered range', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    const buckets = [0, 1000, 2000, 3000].map(start => ({ start, info: start >= 2000 ? 1 : 0 }))
    const wrapper = mount(LogHistogram, { props: { buckets, binMs: 1000, series: [{ key: 'info', label: 'Info', color: 'blue' }], coveredFrom: 2000 } })
    expect(Number(wrapper.find('.lh-uncovered').attributes('width'))).toBeGreaterThan(0)
    const full = mount(LogHistogram, { props: { buckets, binMs: 1000, series: [{ key: 'info', label: 'Info', color: 'blue' }], coveredFrom: 0 } })
    expect(full.find('.lh-uncovered').exists()).toBe(false)
  })
})
