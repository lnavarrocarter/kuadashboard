import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick, reactive } from 'vue'
import { vDialog } from '../composables/vDialog'
import { useSortable } from '../composables/useSortable'

const read = file => readFileSync(resolve(__dirname, '..', file), 'utf8')
const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }))

// A page with an opener button and two stackable dialogs.
function mountDialogs() {
  const state = reactive({ first: false, second: false })
  const wrapper = mount({
    directives: { dialog: vDialog },
    setup: () => ({ state }),
    template: `<div>
      <button id="opener" @click="state.first = true">Open</button>
      <div v-if="state.first" class="modal" v-dialog="() => (state.first = false)">
        <div class="modal-header"><span>Edit tags</span><button>✕</button></div>
        <input id="field" />
        <button id="last" @click="state.second = true">Nested</button>
      </div>
      <div v-if="state.second" class="modal" v-dialog="() => (state.second = false)">
        <h3>Confirm</h3><button id="ok">OK</button>
      </div>
    </div>`,
  }, { attachTo: document.body })
  return { wrapper, state }
}

describe('v-dialog (A12)', () => {
  let current
  afterEach(() => current?.unmount())

  it('names the dialog after its title, focuses the first field and keeps Tab inside', async () => {
    const { wrapper, state } = mountDialogs()
    current = wrapper
    wrapper.find('#opener').element.focus()
    state.first = true
    await nextTick(); await flushPromises()
    const dialog = wrapper.find('.modal').element
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Edit tags')
    expect(document.activeElement.id).toBe('field')

    wrapper.find('#last').element.focus()
    key('Tab')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement.textContent).toBe('✕') // wrapped to the first control
    key('Tab', { shiftKey: true })
    expect(document.activeElement.id).toBe('last')
  })

  it('Escape closes only the topmost dialog and focus returns to the opener', async () => {
    const { wrapper, state } = mountDialogs()
    current = wrapper
    wrapper.find('#opener').element.focus()
    state.first = true
    await nextTick(); await flushPromises()
    wrapper.find('#last').element.focus()
    state.second = true
    await nextTick(); await flushPromises()

    key('Escape')
    await nextTick()
    expect(state).toEqual({ first: true, second: false })
    expect(document.activeElement.id).toBe('last')
    key('Escape')
    await nextTick()
    expect(state.first).toBe(false)
    expect(document.activeElement.id).toBe('opener')
  })
})

describe('sortable headers and sidebar are keyboard operable (A12)', () => {
  it('ariaSort follows the sort state', () => {
    const { sortBy, ariaSort } = useSortable()
    expect(ariaSort('name')).toBe('none')
    sortBy('name')
    expect(ariaSort('name')).toBe('ascending')
    sortBy('name')
    expect(ariaSort('name')).toBe('descending')
    expect(ariaSort('size')).toBe('none')
  })

  it.each([
    'components/cloud/AwsView.vue',
    'components/cloud/cfn/AwsCfnTab.vue',
    'components/cloud/logs/AwsLogsTab.vue',
    'components/cloud/messaging/AwsSesTab.vue',
    'components/cloud/messaging/AwsSnsTab.vue',
    'components/cloud/messaging/AwsSqsTab.vue',
    'components/cloud/networking/AwsLoadBalancersTab.vue',
  ])('%s sorts with buttons and aria-sort, not clickable <th>', file => {
    const source = read(file)
    expect(source).not.toMatch(/<th\b[^>]*@click/)
    const sortable = (source.match(/<th\b[^>]*>/g) || []).filter(th => th.includes('thClass('))
    expect(sortable.length).toBeGreaterThan(0)
    expect(sortable.every(th => th.includes(':aria-sort='))).toBe(true)
  })

  it('the sidebar uses buttons with aria-current instead of links without href', () => {
    const app = read('App.vue')
    expect(app).not.toMatch(/<a\b[^>]*sidebar-item/)
    const items = app.match(/<button type="button"[^>]*sidebar-item[\s\S]*?>/g) || []
    expect(items.length).toBeGreaterThan(30)
    expect(items.every(item => item.includes(':aria-current='))).toBe(true)
  })

  it('every AWS modal uses v-dialog', () => {
    const view = read('components/cloud/AwsView.vue')
    const overlays = view.match(/class="modal-overlay"/g).length
    expect(view.match(/v-dialog="/g).length).toBe(overlays)
  })
})
