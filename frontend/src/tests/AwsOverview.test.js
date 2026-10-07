import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsOverview from '../components/cloud/AwsOverview.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

function overview(overrides = {}) {
  return {
    generatedAt: new Date().toISOString(),
    profile: { id: 'local:dev' },
    identity: { account: '123456789012', arn: 'arn:aws:iam::123456789012:user/dev', type: 'user', name: 'dev', alias: 'acme-dev' },
    region: 'us-east-1',
    regions: { available: true, items: ['eu-west-1', 'us-east-1', 'us-west-2'] },
    summary: { active: 2, empty: 1, unavailable: 1, total: 4 },
    services: [
      { id: 'lambda', tab: 'lambda', label: 'Lambda', scope: 'regional', status: 'active', count: 299, truncated: false },
      { id: 'ec2', tab: 'ec2', label: 'EC2', scope: 'regional', status: 'active', count: 8, truncated: true, detail: { running: 6, stopped: 2 } },
      { id: 'route53', tab: 'route53', label: 'Route 53', scope: 'global', status: 'empty', count: 0 },
      { id: 'eks', tab: 'eks', label: 'EKS', scope: 'regional', status: 'unavailable', count: null, error: { kind: 'denied', action: 'eks:ListClusters', message: 'denied' } },
    ],
    ...overrides,
  }
}

describe('AwsOverview', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAwsStore()
    store.activeProfileId = 'local:dev'
    settings.lang = 'en'
  })

  function mountWith(data) {
    store.overview = data
    return mount(AwsOverview, { props: { profileId: 'local:dev', profileName: 'dev (local)' } })
  }

  it('shows the account, identity, ARN and region of the active profile', () => {
    const wrapper = mountWith(overview())
    const env = wrapper.find('.aov-env').text()
    expect(env).toContain('acme-dev')
    expect(env).toContain('123456789012')
    expect(env).toContain('IAM user')
    expect(env).toContain('arn:aws:iam::123456789012:user/dev')
    expect(wrapper.find('.aov-tag.accent').text()).toBe('us-east-1')
    expect(wrapper.find('.aov-scope').text()).toContain('dev (local)')
  })

  it('lists enabled regions on demand, highlighting the active one', async () => {
    const wrapper = mountWith(overview())
    expect(wrapper.find('.aov-regions').exists()).toBe(false)
    await wrapper.find('.aov-link').trigger('click')
    expect(wrapper.findAll('.aov-regions .aov-tag').map(t => t.text())).toEqual(['eu-west-1', 'us-east-1', 'us-west-2'])
    expect(wrapper.find('.aov-regions .aov-tag.accent').text()).toBe('us-east-1')
  })

  it('summarizes active services and total resources', () => {
    const wrapper = mountWith(overview())
    const values = wrapper.findAll('.aov-tile-value').map(v => v.text())
    expect(values).toEqual(['2/4', '307', '1'])
  })

  it('renders active, empty and unavailable service cards', () => {
    const wrapper = mountWith(overview())
    const cards = wrapper.findAll('.aov-service')
    expect(cards.map(c => c.classes().find(k => ['active', 'empty', 'unavailable'].includes(k)))).toEqual(['active', 'active', 'empty', 'unavailable'])
    expect(cards[1].text()).toContain('8+')
    expect(cards[1].text()).toContain('6 running · 2 stopped')
    expect(cards[2].text()).toContain('No resources')
    expect(cards[2].text()).toContain('Global')
    expect(cards[3].text()).toContain('No permission')
    expect(cards[3].find('.aov-action').text()).toBe('eks:ListClusters')
  })

  it('opens the service tab when a card is clicked', async () => {
    const wrapper = mountWith(overview())
    await wrapper.findAll('.aov-service')[3].trigger('click')
    expect(wrapper.emitted('open-tab')).toEqual([['eks']])
  })

  it('warns when the profile uses the root user', () => {
    const wrapper = mountWith(overview({ identity: { account: '1', arn: 'arn:aws:iam::1:root', type: 'root', name: 'root' } }))
    expect(wrapper.find('.aov-notice.critical').text()).toContain('root user')
  })

  it('loads through the store and shows an error with retry on failure', async () => {
    const spy = vi.spyOn(store, 'fetchOverview').mockRejectedValue(new Error('The security token included in the request is invalid.'))
    const wrapper = mountWith(null)
    await wrapper.vm.load()
    await flushPromises()
    expect(spy).toHaveBeenCalled()
    expect(wrapper.find('.error-state').text()).toContain('security token')
  })

  it('keeps the previous overview visible when a refresh fails', async () => {
    const wrapper = mountWith(overview())
    vi.spyOn(store, 'fetchOverview').mockRejectedValue(new Error('network down'))
    await wrapper.vm.load()
    await flushPromises()
    expect(wrapper.find('.aov-services').exists()).toBe(true)
    expect(wrapper.find('.aov-notice.warn').text()).toContain('network down')
  })

  it('renders in Spanish', () => {
    settings.lang = 'es'
    try {
      const wrapper = mountWith(overview())
      expect(wrapper.find('.aov-env').text()).toContain('Usuario IAM')
      expect(wrapper.findAll('.aov-service')[2].text()).toContain('Sin recursos')
    } finally {
      settings.lang = 'en'
    }
  })

  it('shows the S3 request estimate and requires confirmation before scanning', async () => {
    store.overview = overview({ services: [
      { id: 's3', tab: 's3', label: 'S3', scope: 'global', status: 'active', count: 2 },
    ] })
    const scan = vi.spyOn(store, 'scanS3Advisor').mockResolvedValue({ report: { findings: [] } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mount(AwsOverview, { props: { profileId: 'local:dev', profileName: 'dev' } })
    const button = wrapper.find('[data-test="s3-advisor-preflight"] button')

    expect(wrapper.find('[data-test="s3-advisor-preflight"]').text()).toContain('2 bucket(s)')
    expect(wrapper.find('[data-test="s3-advisor-preflight"]').text()).toContain('12 API requests')
    await button.trigger('click')
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('USD 0.00000480'))
    expect(scan).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await button.trigger('click')
    expect(scan).toHaveBeenCalledWith(2, { refresh: false })
  })

  it('does not offer an S3 scan when the bucket inventory is truncated', () => {
    const wrapper = mountWith(overview({ services: [
      { id: 's3', tab: 's3', label: 'S3', scope: 'global', status: 'active', count: 10, truncated: true },
    ] }))

    expect(wrapper.find('[data-test="s3-advisor-preflight"]').text()).toContain('incomplete estimate')
    expect(wrapper.find('[data-test="s3-advisor-preflight"] button').exists()).toBe(false)
  })
})

describe('useAwsStore.fetchOverview', () => {
  it('stores the overview and fills the regions list', async () => {
    setActivePinia(createPinia())
    const store = useAwsStore()
    store.activeProfileId = 'local:dev'
    const data = overview()
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => 'application/json' }, json: async () => data })
    await store.fetchOverview()
    expect(fetch).toHaveBeenCalledWith('/api/cloud/aws/overview', expect.objectContaining({ headers: { 'X-Profile-Id': 'local:dev' } }))
    expect(store.overview.identity.account).toBe('123456789012')
    expect(store.regions.map(r => r.name)).toEqual(['eu-west-1', 'us-east-1', 'us-west-2'])
    store.setActiveProfile('local:prod')
    expect(store.overview).toBeNull()
  })
})
