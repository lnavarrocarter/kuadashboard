import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AdvisorPanel from '../components/advisor/AdvisorPanel.vue'
import { settings } from '../composables/useSettings'

const bucket = (overrides = {}) => ({ high: 0, medium: 0, low: 0, findings: 0, passed: 0, checks: 0, ...overrides })

function report(overrides = {}) {
  return {
    generatedAt: '2026-10-01T12:00:00Z',
    categories: ['security', 'infrastructure', 'architecture', 'development'],
    summary: {
      security: bucket({ high: 1, findings: 1, passed: 3, checks: 4 }),
      infrastructure: bucket({ low: 1, findings: 1, passed: 1, checks: 2 }),
      architecture: bucket({ passed: 2, checks: 2 }),
      development: bucket({ passed: 1, checks: 1 }),
    },
    findings: [
      {
        id: 'aws.root_mfa', category: 'security', severity: 'high', count: 1, params: {},
        docs: 'https://docs.aws.amazon.com/x', resources: [{ kind: 'Account', name: 'root' }], truncated: false,
      },
      {
        id: 'aws.orphan_volumes', category: 'infrastructure', severity: 'low', count: 12, params: {},
        docs: null, resources: Array.from({ length: 10 }, (_, i) => ({ kind: 'EBS', name: `vol-${i}`, detail: '20 GiB gp3' })), truncated: true,
      },
    ],
    unavailable: [{ source: 'rds', action: 'rds:DescribeDBInstances' }],
    ...overrides,
  }
}

describe('AdvisorPanel', () => {
  beforeEach(() => {
    settings.lang = 'en'
    try { localStorage.clear() } catch { /* jsdom */ }
  })

  it('lists findings with translated titles, score and unreadable sources', () => {
    const wrapper = mount(AdvisorPanel, { props: { report: report() } })
    expect(wrapper.text()).toContain('7/9 checks pass')
    expect(wrapper.text()).toContain('The root user has no MFA')
    expect(wrapper.text()).toContain('12 unattached EBS volume(s)')
    expect(wrapper.text()).toContain('rds:DescribeDBInstances')
    expect(wrapper.find('.adv-score').classes()).toContain('bad')
  })

  it('filters by category and says when a category is clean', async () => {
    const wrapper = mount(AdvisorPanel, { props: { report: report() } })
    await wrapper.find('[data-test="advisor-cat-infrastructure"]').trigger('click')
    expect(wrapper.findAll('.adv-item')).toHaveLength(1)
    await wrapper.find('[data-test="advisor-cat-architecture"]').trigger('click')
    expect(wrapper.text()).toContain('No Architecture recommendations.')
  })

  it('expands a finding with its body, resources, overflow and docs link', async () => {
    const wrapper = mount(AdvisorPanel, { props: { report: report() } })
    await wrapper.find('[data-test="advisor-finding-aws.orphan_volumes"] .adv-row').trigger('click')
    const detail = wrapper.find('[data-test="advisor-finding-aws.orphan_volumes"] .adv-detail')
    expect(detail.text()).toContain('keep billing for storage')
    expect(detail.findAll('.adv-resources li')).toHaveLength(11)
    expect(detail.text()).toContain('…and 2 more')
    expect(detail.find('a').exists()).toBe(false)
    await wrapper.find('[data-test="advisor-finding-aws.root_mfa"] .adv-row').trigger('click')
    expect(wrapper.find('[data-test="advisor-finding-aws.root_mfa"] a').attributes('href')).toBe('https://docs.aws.amazon.com/x')
  })

  it('renders the product lens in Spanish without category tabs', () => {
    settings.lang = 'es'
    const wrapper = mount(AdvisorPanel, {
      props: {
        lens: 'product',
        report: report({
          categories: ['product'],
          summary: { product: bucket({ medium: 1, findings: 1, passed: 4, checks: 5 }) },
          findings: [{ id: 'product.no_owner', category: 'product', severity: 'medium', count: 1, params: {}, resources: [{ kind: 'Application', name: 'checkout' }] }],
          unavailable: [],
        }),
      },
    })
    expect(wrapper.text()).toContain('Advisor de producto')
    expect(wrapper.text()).toContain('La aplicación no tiene equipo dueño')
    expect(wrapper.find('.adv-cats').exists()).toBe(false)
    expect(wrapper.find('.adv-score').classes()).toContain('warn')
  })

  it('starts collapsed when asked, remembers the choice and emits refresh', async () => {
    const wrapper = mount(AdvisorPanel, { props: { report: report(), defaultCollapsed: true, refreshable: true, storageKey: 'advisor.test' } })
    expect(wrapper.find('.adv-list').exists()).toBe(false)
    expect(wrapper.text()).toContain('2 recommendation(s), 1 high')
    // Header: agent brief (copy, download), refresh, collapse
    const buttons = wrapper.findAll('.adv-head-side button')
    await buttons.at(-1).trigger('click')
    expect(wrapper.find('.adv-list').exists()).toBe(true)
    expect(localStorage.getItem('kua.advisor.test.collapsed')).toBe('0')
    await buttons.at(-2).trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('shows the error when the report could not be loaded', () => {
    const wrapper = mount(AdvisorPanel, { props: { report: null, error: 'Forbidden' } })
    expect(wrapper.text()).toContain('Forbidden')
  })
})
