import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
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
  const rowButton = (w, rowText, label) => w.findAll('tbody tr')
    .find(tr => tr.text().includes(rowText)).findAll('button').find(b => b.text() === label)

  it('shows destination, state and EKS/ASG ownership; cancelling sends nothing', async () => {
    const w = await mountTab('ec2', store => { store.ec2Instances = [NODE, OTHER] })
    await rowButton(w, 'eks-node-1', 'Stop').trigger('click')
    await flushPromises()
    const dialog = w.find('[role="dialog"]')
    expect(dialog.text()).toContain('Stop EC2 instance eks-node-1?')
    expect(dialog.text()).toContain('i-0abc')
    expect(dialog.text()).toContain('Current state: running')
    expect(dialog.text()).toContain('account 123456789012')
    expect(dialog.text()).toContain('region us-east-1')
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
    await rowButton(w, 'bastion', 'Stop').trigger('click')
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

  it('ECS: Start is disabled while the service runs (it would set desired to 1); Stop states the impact', async () => {
    const w = await mountTab('ecs', store => {
      store.ecsServices = [
        { name: 'api', cluster: 'prod', status: 'ACTIVE', desired: 4, running: 4, tags: [] },
        { name: 'worker', cluster: 'prod', status: 'ACTIVE', desired: 0, running: 0, tags: [] },
      ]
    })
    expect(rowButton(w, 'api', 'Start').attributes('disabled')).toBeDefined()
    expect(rowButton(w, 'worker', 'Stop').attributes('disabled')).toBeDefined()
    await rowButton(w, 'api', 'Stop').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').text()).toContain('Sets the desired count to 0 (now 4)')
    expect(posts).toEqual([])
  })
})
