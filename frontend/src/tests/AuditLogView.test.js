import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const api = vi.fn()
vi.mock('../composables/useApi', () => ({ api: (...args) => api(...args), useApi: () => ({ apiFetch: vi.fn() }) }))

import { settings } from '../composables/useSettings'
import AuditLogView from '../components/AuditLogView.vue'

const entry = i => ({ id: String(i), timestamp: '2026-10-10T10:00:00.000Z', level: 'info', category: 'vercel', action: `a.${i}`, resource: '', context: '', details: {} })

function respond({ total = 1, stats = { total, byCategory: { vercel: total }, byLevel: { info: total } } } = {}) {
  api.mockImplementation(async (method, url) => {
    if (url.startsWith('/api/audit/stats')) return stats
    const offset = Number(new URL(url, 'http://x').searchParams.get('offset') || 0)
    return { entries: Array.from({ length: Math.min(200, total - offset) }, (_, i) => entry(offset + i)), total, offset, limit: 200 }
  })
}
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
})
