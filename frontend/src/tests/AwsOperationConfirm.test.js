import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
import { useEnvStore } from '../stores/useEnvStore'
import { useAwsStore } from '../stores/useAwsStore'

function json(body, status = 200) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => '' }
}

const NODE = {
  id: 'i-0abc', name: 'eks-node-1', state: 'running', type: 'm6i.large', az: 'us-east-1a',
  tags: [{ Key: 'Name', Value: 'eks-node-1' }, { Key: 'eks:cluster-name', Value: 'prod' }, { Key: 'aws:autoscaling:groupName', Value: 'eks-general' }],
}
const OTHER = { id: 'i-0def', name: 'bastion', state: 'running', type: 't3.micro', az: 'us-east-1b', tags: [] }

describe('AWS write operations ask for confirmation (A01)', () => {
  let posts
  let releasePost

  beforeEach(() => {
    setActivePinia(createPinia())
    posts = []
    releasePost = null
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (options.method === 'POST') {
        posts.push(String(url))
        await new Promise(resolve => { releasePost = resolve })
        return json({ success: true })
      }
      if (String(url).endsWith('/api/cloud/aws/account')) return json({ account: '123456789012', region: 'us-east-1' })
      return json([])
    }))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  async function mountTab(tab, seed) {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: tab }, global: { stubs: { Teleport: true } } })
    await flushPromises()
    seed(store)
    await flushPromises()
    return w
  }
  // Start/Stop live in the row "More" menu (A10).
  async function menuItem(w, rowText, id) {
    const row = w.findAll('tbody tr').find(tr => tr.text().includes(rowText))
    const toggle = row.find('[aria-haspopup="menu"]')
    if (toggle.attributes('aria-expanded') !== 'true') await toggle.trigger('click')
    await flushPromises()
    return row.find(`[data-test="menu-${id}"]`)
  }

  it('shows destination, state and EKS/ASG ownership; cancelling sends nothing', async () => {
    const w = await mountTab('ec2', store => { store.ec2Instances = [NODE, OTHER] })
    await (await menuItem(w, 'eks-node-1', 'stop')).trigger('click')
    await flushPromises()
    const dialog = w.find('[role="dialog"]')
    expect(dialog.text()).toContain('Stop EC2 instance eks-node-1?')
    expect(dialog.text()).toContain('i-0abc')
    expect(dialog.text()).toContain('Current state: running')
    const destination = dialog.find('[data-test="destination"]').text()
    expect(destination).toContain('Account123456789012')
    expect(destination).toContain('Regionus-east-1')
    expect(destination).toContain('EnvironmentUnidentified environment')
    expect(dialog.text()).toContain('EKS node of cluster prod')
    expect(dialog.text()).toContain('Auto Scaling group eks-general')
    await dialog.findAll('button').find(b => b.text() === 'Cancel').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(posts).toEqual([])
  })

  it('confirming stops only the shown instance, once, even with a double click', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const w = await mountTab('ec2', store => { store.ec2Instances = [NODE, OTHER] })
    await (await menuItem(w, 'bastion', 'stop')).trigger('click')
    await flushPromises()
    const confirm = w.find('[data-test="confirm"]')
    expect(confirm.text()).toBe('Stop instance')
    await confirm.trigger('click')
    await confirm.trigger('click')
    await flushPromises()
    expect(posts).toEqual(['/api/cloud/aws/ec2/i-0def/stop'])
    releasePost()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('a profile change with the dialog open closes it and sends nothing (R02)', async () => {
    const w = await mountTab('ec2', store => { store.ec2Instances = [NODE, OTHER] })
    await (await menuItem(w, 'bastion', 'stop')).trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    useAwsStore().activeProfileId = 'prof-2' // e.g. Back to an entry with another profile
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(posts).toEqual([])
  })

  it('the Lambda invoke dialog validates JSON inline and closes on a profile change (R02)', async () => {
    const w = await mountTab('lambda', store => {
      store.lambdas = [{ name: 'orders', runtime: 'nodejs20.x', memory: 128, timeout: 3, arn: 'arn:aws:lambda:us-east-1:1:function:orders', tags: {} }]
    })
    await (await menuItem(w, 'orders', 'invoke')).trigger('click')
    await flushPromises()
    const dialog = () => w.find('.modal[role="dialog"]')
    await dialog().find('textarea').setValue('{"id": ')
    expect(dialog().find('#aws-invoke-json-error').text()).toMatch(/^Invalid JSON/)
    expect(dialog().find('textarea').attributes('aria-invalid')).toBe('true')
    const run = dialog().findAll('button').find(b => b.text() === 'Invoke')
    expect(run.attributes('disabled')).toBeDefined()
    await dialog().find('textarea').setValue('{"id": 1}')
    expect(run.attributes('disabled')).toBeUndefined()

    useAwsStore().activeProfileId = 'prof-2'
    await flushPromises()
    expect(w.find('.modal[role="dialog"]').exists()).toBe(false)
    expect(posts).toEqual([])
  })

  it('ECS: Start is disabled while the service runs (it would set desired to 1); Stop states the impact', async () => {
    const w = await mountTab('ecs', store => {
      store.ecsServices = [
        { name: 'api', cluster: 'prod', status: 'ACTIVE', desired: 4, running: 4, tags: [] },
        { name: 'worker', cluster: 'prod', status: 'ACTIVE', desired: 0, running: 0, tags: [] },
      ]
    })
    expect((await menuItem(w, 'api', 'start')).attributes('disabled')).toBeDefined()
    expect((await menuItem(w, 'worker', 'stop')).attributes('disabled')).toBeDefined()
    await (await menuItem(w, 'api', 'stop')).trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').text()).toContain('Sets the desired count to 0 (now 4)')
    expect(posts).toEqual([])
  })

  it('a Glue run waits for the destination dialog and warns on a production profile', async () => {
    const w = await mountTab('glue', store => {
      store.glueJobs = [{ name: 'nightly-etl', role: 'r', glueVersion: '4.0' }]
      useEnvStore().profiles = [{ id: 'prof-1', name: 'prod', provider: 'aws' }]
    })
    const run = w.findAll('tbody tr').find(tr => tr.text().includes('nightly-etl')).findAll('button').find(b => b.text() === 'Run')
    await run.trigger('click')
    await flushPromises()
    const dialog = w.find('[role="dialog"]')
    expect(dialog.text()).toContain('Run Glue job nightly-etl?')
    expect(dialog.find('[data-test="destination"]').text()).toContain('EnvironmentProduction')
    expect(dialog.text()).toContain('This profile reads as production')
    expect(posts).toEqual([])
  })
})
