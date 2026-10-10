import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const apiFetch = vi.fn()
// api: the plan (usePlan); apiFetch: everything the panel asks for.
vi.mock('../composables/useApi', () => ({ useApi: () => ({ apiFetch }), api: async () => ({ plan: 'pro', features: { advisor: true }, limits: { advisorScanMinHours: 6 } }) }))
// __esModule: the panel loads the chart lazily (defineAsyncComponent takes `default` from ES modules only).
vi.mock('../components/cloud/CloudMetricChart.vue', () => ({
  __esModule: true,
  default: { name: 'CloudMetricChart', props: ['label', 'unit', 'points', 'color', 'showDate'], template: '<div class="chart-stub">{{ label }}|{{ points.map(p => Math.round(p.v)).join(",") }}</div>' },
}))

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

  it('lists the most severe findings first and the rest behind "Show all" (A09)', async () => {
    const finding = (id, severity, category = 'security') => ({ id, category, severity, count: 1, params: {}, docs: null, resources: [], truncated: false })
    const findings = [
      finding('aws.low_a', 'low'), finding('aws.medium_a', 'medium'), finding('aws.high_a', 'high'),
      finding('aws.low_b', 'low', 'infrastructure'), finding('aws.high_b', 'high', 'infrastructure'),
    ]
    const wrapper = mount(AdvisorPanel, { props: { report: report({ findings }) } })
    const ids = () => wrapper.findAll('.adv-list > .adv-item').map(li => li.attributes('data-test').replace('advisor-finding-', ''))
    expect(ids()).toEqual(['aws.high_a', 'aws.high_b', 'aws.medium_a'])
    expect(wrapper.find('[data-test="advisor-severity-summary"]').text()).toBe('2 high·1 medium·2 low')
    expect(wrapper.find('.adv-score').attributes('title')).toContain('not in the count')

    const more = wrapper.find('[data-test="advisor-show-all"]')
    expect(more.text()).toBe('Show all 5 findings')
    await more.trigger('click')
    expect(ids()).toEqual(['aws.high_a', 'aws.high_b', 'aws.medium_a', 'aws.low_a', 'aws.low_b'])

    // A category resets to the short list; with 2 findings there is nothing to expand.
    await wrapper.find('[data-test="advisor-cat-infrastructure"]').trigger('click')
    expect(ids()).toEqual(['aws.high_b', 'aws.low_b'])
    expect(wrapper.find('[data-test="advisor-show-all"]').exists()).toBe(false)
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
          errorBudget: { objectives: [{ source: 'logs', errorRatePercent: 10, targetPercent: 5, consumedPercent: 200, remainingPercent: 0, burnRate: 2 }] },
          technical: {
            analyzedAt: '2026-10-01T12:00:00.000Z',
            findings: [{ id: 'aws.lambda_plain_secrets', severity: 'high', count: 1, resources: [{ name: 'checkout-api' }] }],
            dora: { available: false, reason: 'deployment_history_unavailable' },
          },
          recommendations: [{ id: 'error_budget_and_technical_risk', resources: ['checkout-api'] }],
          unavailable: [],
        }),
      },
    })
    expect(wrapper.text()).toContain('Advisor de producto')
    expect(wrapper.text()).toContain('La aplicación no tiene equipo dueño')
    expect(wrapper.text()).toContain('Presupuesto de error de 24 horas')
    expect(wrapper.text()).toContain('200.0% consumido')
      expect(wrapper.text()).toContain('El consumo del presupuesto y el riesgo técnico alto coinciden en checkout-api')
      expect(wrapper.text()).toContain('No hay historial de releases para calcular métricas DORA')
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

// #94: accept or silence findings, list them apart, chart the posture.
describe('AdvisorPanel posture', () => {
  const POSTURE = { acceptanceScope: 'aws:p1', historyScope: 'aws:p1:us-east-1', expiringSoon: 0, expired: 0 }
  const ACCEPTANCE = { id: 'a1', ruleId: 'aws.public_ip', kind: 'accepted', reason: 'Bastion behind an allow list', author: 'ana@example.com', createdAt: '2026-10-01T00:00:00Z', expiresAt: '2026-12-30T00:00:00Z', expiringSoon: false }
  const settled = async () => { await flushPromises(); await new Promise(resolve => setTimeout(resolve)); await flushPromises() }

  beforeEach(() => {
    settings.lang = 'en'
    apiFetch.mockReset()
    try { localStorage.clear() } catch { /* jsdom */ }
  })

  it('accepts a finding for some resources with a reason and an expiry', async () => {
    apiFetch.mockImplementation(async path => (path === '/api/advisor/schedules' ? [] : [{ id: 'new' }]))
    const wrapper = mount(AdvisorPanel, { props: { report: report({ posture: POSTURE }) } })
    await wrapper.find('[data-test="advisor-finding-aws.orphan_volumes"] .adv-row').trigger('click')
    await wrapper.find('[data-test="advisor-accept-aws.orphan_volumes"]').trigger('click')
    const save = () => wrapper.find('[data-test="advisor-decision-save"]')
    expect(save().attributes('disabled')).toBeDefined()

    await wrapper.find('[data-test="advisor-decision-resources"]').setValue()
    await wrapper.findAll('.adv-decision-list input')[1].setValue(true)
    await wrapper.find('[data-test="advisor-decision-reason"]').setValue('Kept for the yearly restore test')
    expect(save().attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-test="advisor-decision"]').trigger('submit')
    await flushPromises()

    const [path, options] = apiFetch.mock.calls.find(([called]) => called === '/api/advisor/acceptances')
    expect(path).toBe('/api/advisor/acceptances')
    const body = JSON.parse(options.body)
    expect(body).toMatchObject({ scope: 'aws:p1', ruleId: 'aws.orphan_volumes', kind: 'accepted', reason: 'Kept for the yearly restore test', resources: [{ kind: 'EBS', name: 'vol-1', detail: '20 GiB gp3' }] })
    // 90 days by default for an accepted risk
    expect(Math.round((Date.parse(body.expiresAt) - Date.now()) / 86400000)).toBe(90)
    expect(wrapper.emitted('posture-changed')).toHaveLength(1)
    expect(wrapper.find('[data-test="advisor-decision"]').exists()).toBe(false)
  })

  it('lists accepted findings apart, counts them next to the score, and revokes them', async () => {
    apiFetch.mockResolvedValue({})
    const accepted = [{ id: 'aws.public_ip', category: 'security', severity: 'high', count: 1, params: {}, resources: [], acceptance: ACCEPTANCE }]
    const summary = { ...report().summary, security: bucket({ high: 1, findings: 1, passed: 3, checks: 4, accepted: 1 }) }
    const wrapper = mount(AdvisorPanel, { props: { report: report({ posture: { ...POSTURE, expiringSoon: 1, expired: 2 }, accepted, summary }) } })
    expect(wrapper.find('.adv-score').text()).toBe('7/9 checks pass · 1 accepted · 1 not checked')
    expect(wrapper.find('[data-test="advisor-expired"]').text()).toContain('2 acceptance(s) expired')
    expect(wrapper.find('[data-test="advisor-expiring"]').text()).toContain('1 acceptance(s) expire in the next 7 days')

    await wrapper.find('.adv-accepted-toggle').trigger('click')
    const item = wrapper.find('[data-test="advisor-accepted-aws.public_ip"]')
    expect(item.text()).toContain('Accepted')
    expect(item.text()).toContain('“Bastion behind an allow list” — ana@example.com')
    await wrapper.find('[data-test="advisor-revoke-aws.public_ip"]').trigger('click')
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/advisor/acceptances/a1', { method: 'DELETE' })
    expect(wrapper.emitted('posture-changed')).toHaveLength(1)
  })

  it('charts passed checks and high findings of the selected category', async () => {
    apiFetch.mockResolvedValue([
      { capturedAt: '2026-09-01T00:00:00Z', summary: { security: bucket({ high: 2, passed: 2, checks: 4 }) } },
      { capturedAt: '2026-09-15T00:00:00Z', summary: { security: bucket({ high: 1, passed: 3, checks: 4 }) } },
    ])
    const wrapper = mount(AdvisorPanel, { props: { report: report({ posture: POSTURE }) } })
    await wrapper.find('[data-test="advisor-history-toggle"]').trigger('click')
    await settled()
    expect(apiFetch).toHaveBeenCalledWith('/api/advisor/history?scope=aws%3Ap1%3Aus-east-1&days=90')
    expect(wrapper.findAll('.chart-stub').map(chart => chart.text())).toEqual(['Checks that pass|50,75', 'High findings|2,1'])
  })

  it('offers no decisions without posture (Free, or an older backend)', async () => {
    const wrapper = mount(AdvisorPanel, { props: { report: report() } })
    await wrapper.find('[data-test="advisor-finding-aws.root_mfa"] .adv-row').trigger('click')
    expect(wrapper.find('[data-test="advisor-accept-aws.root_mfa"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="advisor-history-toggle"]').exists()).toBe(false)
  })
})

// Scheduled analysis of the scope (lib/advisor/scheduler.js).
describe('AdvisorPanel scheduled analysis', () => {
  const POSTURE = { acceptanceScope: 'aws:p1', historyScope: 'aws:p1:us-east-1', expiringSoon: 0, expired: 0 }

  beforeEach(() => {
    settings.lang = 'en'
    apiFetch.mockReset()
  })

  it('shows the schedule of the scope with its cost, and turns it on and off', async () => {
    const saved = { scope: 'aws:p1:us-east-1', intervalHours: 12, lastRunAt: null, nextRunAt: null, lastStatus: null }
    apiFetch.mockImplementation(async (path, options = {}) => {
      if (path === '/api/advisor/schedules' && !options.method) return []
      if (options.method === 'PUT') return saved
      return { removed: true }
    })
    const wrapper = mount(AdvisorPanel, { props: { report: report({ posture: POSTURE }) } })
    await flushPromises()
    const panel = wrapper.find('[data-test="advisor-schedule"]')
    expect(panel.text()).toContain('Free AWS control-plane APIs.')
    const select = wrapper.find('[data-test="advisor-schedule-select"]')
    // Pro: every hour is a Team option
    expect(select.findAll('option').map(option => [option.text(), option.attributes('disabled') !== undefined])).toEqual([
      ['Off', false], ['Every 1 h · Team', true], ['Every 6 h', false], ['Every 12 h', false], ['Every 24 h', false],
    ])

    await select.setValue('12')
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/advisor/schedules', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ scope: 'aws:p1:us-east-1', intervalHours: 12 }) }))
    expect(wrapper.find('[data-test="advisor-schedule-status"]').text()).toBe('The first analysis runs within a few minutes.')

    await select.setValue('0')
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/advisor/schedules?scope=aws%3Ap1%3Aus-east-1', { method: 'DELETE' })
  })

  it('says why a Kubernetes schedule is waiting', async () => {
    const scope = 'kubernetes:other:all'
    apiFetch.mockResolvedValue([{ scope, intervalHours: 6, lastStatus: 'skipped', lastError: 'context not active' }])
    const wrapper = mount(AdvisorPanel, { props: { report: report({ posture: { ...POSTURE, historyScope: scope, acceptanceScope: 'kubernetes:other' } }) } })
    await flushPromises()
    expect(wrapper.find('[data-test="advisor-schedule"]').text()).toContain('It runs while this context is the active one in KUA')
    expect(wrapper.find('[data-test="advisor-schedule-status"]').text()).toBe('Waiting: it runs when this context is the active one in KUA.')
  })
})

// Team plan: decisions shared by an owner or admin (lib/advisor/teamAcceptances.js).
describe('AdvisorPanel team decisions', () => {
  const POSTURE = { acceptanceScope: 'aws:p1', historyScope: 'aws:p1:us-east-1', expiringSoon: 0, expired: 0, teamScope: 'aws-account:123456789012' }
  const TEAM_ACCEPTANCE = { id: 't1', ruleId: 'aws.public_ip', kind: 'accepted', reason: 'Bastion', author: 'owner@example.com', createdAt: '2026-10-01T00:00:00Z', expiresAt: null, team: true }

  beforeEach(() => {
    settings.lang = 'en'
    apiFetch.mockReset()
    apiFetch.mockImplementation(async path => (path === '/api/advisor/schedules' ? [] : { team: true, decisions: 1 }))
  })

  it('an owner or admin can decide for the team', async () => {
    const wrapper = mount(AdvisorPanel, { props: { report: report({ posture: { ...POSTURE, teamCanDecide: true } }) } })
    await wrapper.find('[data-test="advisor-finding-aws.root_mfa"] .adv-row').trigger('click')
    await wrapper.find('[data-test="advisor-accept-aws.root_mfa"]').trigger('click')
    await wrapper.find('[data-test="advisor-decision-reason"]').setValue('Break-glass account')
    await wrapper.find('[data-test="advisor-decision-share"]').setValue(true)
    await wrapper.find('[data-test="advisor-decision"]').trigger('submit')
    await flushPromises()
    const [, options] = apiFetch.mock.calls.find(([path]) => path === '/api/advisor/acceptances')
    expect(JSON.parse(options.body)).toMatchObject({ share: true, teamScope: 'aws-account:123456789012', ruleId: 'aws.root_mfa' })
  })

  it('members see team decisions marked, without deciding or revoking them', async () => {
    const accepted = [{ id: 'aws.public_ip', category: 'security', severity: 'high', count: 1, params: {}, resources: [], acceptance: TEAM_ACCEPTANCE }]
    const wrapper = mount(AdvisorPanel, { props: { report: report({ posture: { ...POSTURE, teamCanDecide: false }, accepted }) } })
    await wrapper.find('[data-test="advisor-finding-aws.root_mfa"] .adv-row').trigger('click')
    await wrapper.find('[data-test="advisor-accept-aws.root_mfa"]').trigger('click')
    expect(wrapper.find('[data-test="advisor-decision-share"]').exists()).toBe(false)
    await wrapper.find('.adv-accepted-toggle').trigger('click')
    expect(wrapper.find('[data-test="advisor-team-aws.public_ip"]').text()).toBe('Team')
    expect(wrapper.find('[data-test="advisor-revoke-aws.public_ip"]').exists()).toBe(false)
  })
})
