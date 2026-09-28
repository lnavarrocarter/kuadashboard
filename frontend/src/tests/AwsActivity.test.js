import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import LambdaDetail from '../components/cloud/LambdaDetail.vue'
import { useAwsStore } from '../stores/useAwsStore'
import { settings } from '../composables/useSettings'

const json = body => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body })

describe('useAwsStore activity', () => {
  let store
  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAwsStore()
    store.activeProfileId = 'local:dev'
  })

  it('posts the listed functions with their log groups and keeps the result', async () => {
    store.lambdas = [{ name: 'api', logGroup: '/aws/lambda/api' }, { name: 'job', logGroup: '/custom/job' }]
    const activity = { windowHours: 24, functions: { api: { invocations: 5, errors: 1, logStatus: 'ok' } } }
    globalThis.fetch = vi.fn().mockResolvedValue(json(activity))
    await store.fetchLambdaActivity()
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/cloud/aws/lambda/activity')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ functions: [{ name: 'api', logGroup: '/aws/lambda/api' }, { name: 'job', logGroup: '/custom/job' }] })
    expect(store.lambdaActivity).toEqual(activity)
  })

  it('keeps activity failures inside the result without touching the table error', async () => {
    store.stepFunctions = [{ arn: 'arn:aws:states:us-east-1:1:stateMachine:Flow' }]
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, headers: { get: () => 'application/json' }, json: async () => ({ error: 'denied', access: { failedAction: 'states:DescribeStateMachine' } }) })
    await store.fetchStepFnActivity()
    expect(store.stepFnActivity).toEqual({ failed: 'denied', access: { failedAction: 'states:DescribeStateMachine' } })
    expect(store.error).toBeNull()
  })

  it('skips the request when there is nothing listed and resets on profile change', async () => {
    globalThis.fetch = vi.fn()
    store.lambdas = []
    await store.fetchLambdaActivity()
    expect(fetch).not.toHaveBeenCalled()
    store.lambdaActivity = { functions: {} }
    store.setActiveProfile('local:prod')
    expect(store.lambdaActivity).toBeNull()
  })
})

describe('LambdaDetail logs tab', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settings.lang = 'en'
  })

  function mountDetail(logsResponse) {
    globalThis.fetch = vi.fn(async url => {
      if (url.includes('/logs/lambda/')) return json(logsResponse)
      return json({
        basic: { name: 'api', logGroup: '/aws/lambda/api', logFormat: 'Text', tags: {} },
        config: { envVars: {}, layers: [], vpc: null, dlq: null, fileSystem: [], tracing: null },
        aliases: [], versions: [], monitoring: null,
      })
    })
    // The modal loads its details when it opens, as in the app.
    return mount(LambdaDetail, { props: { open: false, fn: { name: 'api' }, profileId: 'local:dev' }, global: { stubs: { teleport: true } } })
  }

  async function openLogs(wrapper) {
    await wrapper.setProps({ open: true })
    await flushPromises()
    const tab = wrapper.findAll('.lmd-tab').find(b => b.text().includes('Logs'))
    await tab.trigger('click')
    await flushPromises()
  }

  it('shows the "no log group" state from the typed API answer', async () => {
    const wrapper = mountDetail({ logGroupName: '/aws/lambda/api', logGroupStatus: 'missing', events: [] })
    await openLogs(wrapper)
    const block = wrapper.find('.lmd-logs-nogroup')
    expect(block.exists()).toBe(true)
    expect(block.text()).toContain('No CloudWatch Logs group found: /aws/lambda/api')
    expect(block.text()).toContain('+ Create log group in CloudWatch')
  })

  it('lists events when the log group exists', async () => {
    const wrapper = mountDetail({ logGroupName: '/aws/lambda/api', logGroupStatus: 'ok', events: [{ timestamp: 1, message: 'hello', logStreamName: '2026/09/28/[$LATEST]abc' }] })
    await openLogs(wrapper)
    expect(wrapper.find('.lmd-logs-nogroup').exists()).toBe(false)
    expect(wrapper.find('.lmd-log-msg').text()).toBe('hello')
  })
})
