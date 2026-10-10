import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const api = vi.fn()
vi.mock('../composables/useApi', () => ({ api: (...args) => api(...args), useApi: () => ({ apiFetch: vi.fn() }) }))

import { settings } from '../composables/useSettings'
import AuditLogView from '../components/AuditLogView.vue'

const entry = i => ({ id: String(i), timestamp: '2026-10-10T10:00:00.000Z', level: 'info', category: 'vercel', action: `a.${i}`, resource: '', context: '', details: {}, actor: { kind: i === 0 ? 'mcp' : 'ui', user: 'ana', account: null }, hash: 'f'.repeat(64) })

function respond({ total = 1, stats = { total, byCategory: { vercel: total }, byLevel: { info: total } } } = {}) {
  api.mockImplementation(async (method, url, body) => {
    if (url.startsWith('/api/audit/stats')) return stats
    if (url === '/api/audit/verify') return { valid: false, checked: 12, legacy: 0, firstAt: '2026-10-01T00:00:00Z', brokenAt: { line: 7, reason: 'missing' } }
    if (url === '/api/audit/settings') {
      calls.settings.push({ method, body })
      return { retentionDays: body?.retentionDays ?? 90, forward: { enabled: false, url: body?.forward?.url || '', hasToken: !!body?.forward?.token, allowed: false, pending: 0, dropped: 0, lastSuccessAt: null, lastError: null } }
    }
    const offset = Number(new URL(url, 'http://x').searchParams.get('offset') || 0)
    return { entries: Array.from({ length: Math.min(200, total - offset) }, (_, i) => entry(offset + i)), total, offset, limit: 200 }
  })
}
const calls = { settings: [] }
const urls = prefix => api.mock.calls.map(call => call[1]).filter(url => url.startsWith(prefix))

describe('AuditLogView', () => {
  beforeEach(() => { settings.lang = 'en'; api.mockReset() })

  it('sends the same filters to the list, the stats and the CSV export', async () => {
    respond()
    const wrapper = mount(AuditLogView)
    await flushPromises()
    await wrapper.find('select').setValue('vercel')
    await wrapper.find('[data-test="audit-from"]').setValue('2026-10-10T10:00')
    await flushPromises()

    const from = new Date('2026-10-10T10:00').toISOString()
    const list = new URL(urls('/api/audit/logs').at(-1), 'http://x').searchParams
    const stats = new URL(urls('/api/audit/stats').at(-1), 'http://x').searchParams
    expect(list.get('category')).toBe('vercel')
    expect(list.get('from')).toBe(from)
    expect(stats.get('category')).toBe('vercel')
    expect(stats.get('from')).toBe(from)
    const exportHref = wrapper.find('[data-test="audit-export"]').attributes('href')
    expect(exportHref).toContain('category=vercel')
    expect(new URL(exportHref, 'http://x').searchParams.get('from')).toBe(from)
    expect(wrapper.find('[data-test="audit-total"]').text()).toBe('1 matching entries')
  })

  it('pages through the matches instead of stopping at the first rows', async () => {
    respond({ total: 450 })
    const wrapper = mount(AuditLogView)
    await flushPromises()
    expect(wrapper.find('[data-test="audit-total"]').text()).toBe('450 entries')
    expect(wrapper.findAll('tbody tr')).toHaveLength(200)

    const next = wrapper.findAll('[data-test="audit-paging"] button').at(1)
    await next.trigger('click')
    await flushPromises()
    expect(new URL(urls('/api/audit/logs').at(-1), 'http://x').searchParams.get('offset')).toBe('200')
    expect(wrapper.find('[data-test="audit-paging"]').text()).toContain('201–400 of 450')
  })

  it('names its icon buttons', async () => {
    respond()
    const wrapper = mount(AuditLogView)
    await flushPromises()
    for (const button of wrapper.findAll('button')) {
      expect(button.text() || button.attributes('aria-label')).toBeTruthy()
    }
  })

  it('names the actor, filters by it, and verifies the chain', async () => {
    respond()
    const wrapper = mount(AuditLogView)
    await flushPromises()
    expect(wrapper.get('[data-test="audit-actor"]').text()).toBe('AI agent (MCP) · ana')
    await wrapper.get('[data-test="audit-actor-filter"]').setValue('mcp')
    await flushPromises()
    expect(new URL(urls('/api/audit/logs').at(-1), 'http://x').searchParams.get('actor')).toBe('mcp')
    await wrapper.get('[data-test="audit-verify"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="audit-verify-result"]').text()).toContain('Entries are missing before line 7.')
  })

  it('saves retention and forwarding without echoing the token', async () => {
    respond()
    calls.settings.length = 0
    const wrapper = mount(AuditLogView)
    await flushPromises()
    await wrapper.get('[data-test="audit-settings-toggle"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-test="audit-retention"]').setValue(365)
    await wrapper.get('[data-test="audit-forward-url"]').setValue('https://siem.example.com/kua')
    await wrapper.get('[data-test="audit-forward-token"]').setValue('s3cret')
    await wrapper.get('[data-test="audit-settings-save"]').trigger('click')
    await flushPromises()
    const saved = calls.settings.find(call => call.method === 'PUT').body
    expect(saved).toEqual({ retentionDays: 365, forward: { url: 'https://siem.example.com/kua', enabled: false, token: 's3cret' } })
    expect(wrapper.get('[data-test="audit-forward-token"]').element.value).toBe('')
  })
})
