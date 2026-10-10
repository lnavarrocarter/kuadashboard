import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
import { useAwsStore } from '../stores/useAwsStore'

function json(body, status = 200) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => '' }
}

describe('AWS context band (A07)', () => {
  let accountCalls
  let accountStatus

  beforeEach(() => {
    setActivePinia(createPinia())
    accountCalls = 0
    accountStatus = 200
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).endsWith('/api/cloud/aws/account')) {
        accountCalls += 1
        return accountStatus === 200 ? json({ account: '123456789012', region: 'us-east-1' }) : json({ error: 'denied' }, accountStatus)
      }
      return json([])
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function mountOn(tab) {
    const store = useAwsStore()
    store.activeProfileId = 'local:dev'
    const w = mount(AwsView, { props: { activeService: tab }, global: { stubs: { Teleport: true } } })
    await flushPromises()
    return { w, store }
  }

  it('shows profile, account and region on service tabs, reading the account once', async () => {
    const { w } = await mountOn('ec2')
    const band = w.find('[data-test="aws-context"]')
    expect(band.text()).toContain('dev (local)')
    expect(band.text()).toContain('123456789012')
    expect(band.text()).toContain('us-east-1')
    expect(w.find('[data-test="aws-context-global"]').exists()).toBe(false)
    await w.setProps({ activeService: 'lambda' })
    await flushPromises()
    expect(w.find('[data-test="aws-context"]').text()).toContain('123456789012')
    expect(accountCalls).toBe(1)
  })

  it('marks global services as not filtered by the selected region', async () => {
    const { w } = await mountOn('s3')
    expect(w.find('[data-test="aws-context-global"]').text()).toContain('every region')
  })

  it('uses the account alias from Overview when it is the same account', async () => {
    const { w, store } = await mountOn('ec2')
    store.overview = { identity: { account: '123456789012', alias: 'acme-dev' } }
    await flushPromises()
    expect(w.find('[data-test="aws-context"]').text()).toContain('acme-dev (123456789012)')
  })

  it('says unknown when the account cannot be read, without retrying on every tab', async () => {
    accountStatus = 403
    const { w } = await mountOn('ec2')
    expect(w.find('[data-test="aws-context"]').text()).toContain('unknown')
    await w.setProps({ activeService: 'lambda' })
    await flushPromises()
    expect(accountCalls).toBe(1)
  })

  it('is hidden on Overview, which already shows the full identity', async () => {
    const { w } = await mountOn('overview')
    expect(w.find('[data-test="aws-context"]').exists()).toBe(false)
  })
})
