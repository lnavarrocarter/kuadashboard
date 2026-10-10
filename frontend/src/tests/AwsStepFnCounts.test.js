import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))

import AwsView from '../components/cloud/AwsView.vue'
import { useAwsStore } from '../stores/useAwsStore'

const arn = name => `arn:aws:states:us-east-1:123:stateMachine:${name}`
const ok = count => ({ count, truncated: false })
const denied = { error: { kind: 'denied', message: 'not authorized', action: 'states:ListExecutions' } }

// Server answers per state machine, keyed by name.
const COUNTS = {
  quiet:   { limit: 1000, running: ok(0), failed: ok(0), timedOut: ok(0) },
  busy:    { limit: 1000, running: ok(2), failed: { count: 1000, truncated: true }, timedOut: ok(0) },
  partial: { limit: 1000, running: ok(1), failed: ok(0), timedOut: { error: { kind: 'error', message: 'Rate exceeded' } } },
  locked:  { limit: 1000, running: denied, failed: denied, timedOut: denied },
}

function json(body, status = 200) {
  return { ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => '' }
}

describe('AwsView Step Functions execution counts (A04)', () => {
  let countRequests

  beforeEach(() => {
    setActivePinia(createPinia())
    countRequests = []
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (!String(url).includes('/stepfunctions/executions/count')) return json([])
      const name = decodeURIComponent(String(url).split('arn=')[1]).split(':').pop()
      countRequests.push(name)
      return name === 'broken' ? json({ error: 'Internal failure' }, 500) : json(COUNTS[name])
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  async function countCells(machines) {
    const store = useAwsStore()
    store.activeProfileId = 'prof-1'
    const w = mount(AwsView, { props: { activeService: 'stepfn' }, global: { stubs: { Teleport: true } } })
    await flushPromises()
    store.stepFunctions = machines.map(([name, type = 'STANDARD']) => ({ name, arn: arn(name), type, creationDate: null }))
    await flushPromises()
    await flushPromises()
    return Object.fromEntries(w.findAll('[data-test="sfn-counts"]').map((td, i) => [machines[i][0], td]))
  }

  it('distinguishes confirmed zero, truncated counts, partial reads, missing access, errors and Express', async () => {
    const cells = await countCells([['quiet'], ['busy'], ['partial'], ['locked'], ['broken'], ['fast', 'EXPRESS']])

    expect(cells.quiet.text()).toBe('0')
    expect(cells.busy.text()).toContain('▶ 2')
    expect(cells.busy.text()).toMatch(/✗ 1[,.]?000\+/)
    expect(cells.partial.text()).toContain('▶ 1')
    expect(cells.partial.text()).toContain('partial')
    expect(cells.partial.find('.status-warn').attributes('title')).toBe('Rate exceeded')
    expect(cells.locked.text()).toBe('⚠ No access')
    expect(cells.locked.find('span').attributes('title')).toBe('Missing permission: states:ListExecutions')
    expect(cells.broken.text()).toBe('⚠ Not read')
    expect(cells.broken.find('span').attributes('title')).toContain('Internal failure')
    expect(cells.fast.text()).toBe('N/A')
  })

  it('does not ask ListExecutions for Express workflows', async () => {
    await countCells([['quiet'], ['fast', 'EXPRESS']])
    expect(countRequests).toEqual(['quiet'])
  })
})
