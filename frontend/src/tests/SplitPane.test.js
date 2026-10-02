import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SplitPane from '../components/SplitPane.vue'
import GcpCloudRunInfo from '../components/cloud/GcpCloudRunInfo.vue'

// jsdom has no layout: give the container a height and capture the observer
let observerCb = null
class FakeResizeObserver {
  constructor(cb) { observerCb = cb }
  observe() {}
  disconnect() {}
}

async function mountSplit(props = {}, height = 600) {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
  const w = mount(SplitPane, {
    props: { split: true, storageKey: 'test', ...props },
    slots: { top: '<div class="list">list</div>', bottom: '<div class="detail">detail</div>' },
    attachTo: document.body,
  })
  await flushPromises()   // let the mounted measurement render
  return w
}
// jsdom events have read-only clientY/button: build a plain Event with the fields
async function pointerDown(handle, clientY) {
  const ev = new Event('pointerdown', { bubbles: true, cancelable: true })
  Object.assign(ev, { clientY, pointerId: 1, button: 0 })
  handle.element.dispatchEvent(ev)
  await handle.element.ownerDocument.defaultView.Promise.resolve()
}
const topHeight = w => Number.parseInt(w.find('[data-test="split-top"]').element.style.flexBasis, 10)

describe('SplitPane', () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal('ResizeObserver', FakeResizeObserver) })
  afterEach(() => { vi.unstubAllGlobals(); delete HTMLElement.prototype.clientHeight })

  it('without a selection the list takes all the space and there is no handle', async () => {
    const w = await mountSplit({ split: false })
    expect(w.find('[data-test="split-handle"]').exists()).toBe(false)
    expect(w.find('[data-test="split-bottom"]').exists()).toBe(false)
    expect(w.find('[data-test="split-top"]').element.style.flexBasis).toBe('')
  })

  it('uses the default ratio of the current height', async () => {
    const w = await mountSplit({ defaultRatio: 0.4 })
    expect(topHeight(w)).toBe(240)
    expect(w.find('.detail').exists()).toBe(true)
  })

  it('drags to resize and remembers the ratio', async () => {
    const w = await mountSplit()
    const handle = w.find('[data-test="split-handle"]')
    await pointerDown(handle, 240)
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 360 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    await w.vm.$nextTick()
    expect(topHeight(w)).toBe(360)
    expect(JSON.parse(localStorage.getItem('kua.split.test')).ratio).toBeCloseTo(0.6)
    // a new instance restores it
    expect(topHeight(await mountSplit())).toBe(360)
  })

  it('keeps the minimum sizes for both sides', async () => {
    const w = await mountSplit({ minTop: 72, minBottom: 180 })
    const handle = w.find('[data-test="split-handle"]')
    await pointerDown(handle, 240)
    window.dispatchEvent(new MouseEvent('pointermove', { clientY: 2000 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    await w.vm.$nextTick()
    expect(topHeight(w)).toBe(600 - 180)
  })

  it('collapses the list to a strip and restores it (button, double click, keyboard)', async () => {
    const w = await mountSplit({ collapsedTop: 44 })
    await w.find('[data-test="split-collapse"]').trigger('click')
    expect(topHeight(w)).toBe(44)
    expect(JSON.parse(localStorage.getItem('kua.split.test')).collapsed).toBe(true)
    await w.find('[data-test="split-restore"]').trigger('click')
    expect(topHeight(w)).toBe(240)
    await w.find('[data-test="split-handle"]').trigger('dblclick')
    expect(topHeight(w)).toBe(44)
    await w.find('[data-test="split-handle"]').trigger('keydown', { key: 'Enter' })
    expect(topHeight(w)).toBe(240)
    await w.find('[data-test="split-handle"]').trigger('keydown', { key: 'ArrowDown' })
    expect(topHeight(w)).toBe(264)
  })

  it('adapts when the available height shrinks (e.g. the console opens)', async () => {
    const w = await mountSplit({ defaultRatio: 0.4, minBottom: 180 })
    expect(topHeight(w)).toBe(240)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 })
    observerCb()
    await w.vm.$nextTick()
    expect(topHeight(w)).toBe(120)          // 40% of 300, detail keeps ≥180
  })
})

describe('Cloud Run observations — default service account', () => {
  it('flags the default Compute SA even when GCP returns it by email', () => {
    const detail = { serviceAccount: '306971032277-compute@developer.gserviceaccount.com', scaling: {}, envVars: [], status: 'ready' }
    const notes = mount(GcpCloudRunInfo, { props: { detail, section: 'overview' } }).find('[data-test="notes"]').text()
    expect(notes).toMatch(/default Compute service account/)
  })

  it('does not flag a dedicated service account', () => {
    const detail = { serviceAccount: 'api-runner@p.iam.gserviceaccount.com', scaling: {}, envVars: [], status: 'ready' }
    expect(mount(GcpCloudRunInfo, { props: { detail, section: 'overview' } }).find('[data-test="notes"]').exists()).toBe(false)
  })
})
