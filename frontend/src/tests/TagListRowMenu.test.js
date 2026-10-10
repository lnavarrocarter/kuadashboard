import { describe, it, expect, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TagList from '../components/cloud/TagList.vue'
import RowMenu from '../components/cloud/RowMenu.vue'

describe('TagList (A10)', () => {
  const EKS_NODE = [
    { Key: 'Name', Value: 'node-1' },
    { Key: 'aws:autoscaling:groupName', Value: 'eks-general' },
    { Key: 'kubernetes.io/cluster/prod', Value: 'owned' },
    { Key: 'eks:nodegroup-name', Value: 'general' },
    { Key: 'cost-center', Value: '42' },
    { Key: 'team', Value: 'platform' },
    { Key: 'env', Value: 'prod' },
  ]

  it('shows the two most relevant tags, internal ones last, and a +N toggle', async () => {
    const w = mount(TagList, { props: { tags: EKS_NODE } })
    expect(w.findAll('.tag-chip').map(c => c.text())).toEqual(['env=prod', 'team=platform'])
    const more = w.find('.tag-more')
    expect(more.text()).toBe('+4') // Name is excluded (it is the row title)
    expect(more.attributes('aria-expanded')).toBe('false')
    await more.trigger('click')
    expect(w.findAll('.tag-chip').map(c => c.text())).toEqual([
      'env=prod', 'team=platform', 'cost-center=42',
      'aws:autoscaling:groupName=eks-general', 'kubernetes.io/cluster/prod=owned', 'eks:nodegroup-name=general',
    ])
    expect(w.find('.tag-more').attributes('aria-expanded')).toBe('true')
  })

  it('accepts lower-case arrays and objects, and shows a dash without tags', () => {
    expect(mount(TagList, { props: { tags: [{ key: 'app', value: 'shop' }] } }).text()).toBe('app=shop')
    expect(mount(TagList, { props: { tags: { owner: 'ana' } } }).find('.tag-more').exists()).toBe(false)
    expect(mount(TagList, { props: { tags: [] } }).text()).toBe('—')
    expect(mount(TagList, { props: { tags: [{ Key: 'Name', Value: 'x' }] } }).text()).toBe('—')
  })
})

describe('RowMenu (A10)', () => {
  let wrapper
  afterEach(() => wrapper?.unmount())

  function mountMenu() {
    const selected = []
    const items = [
      { id: 'tags', label: 'Tags', onSelect: () => selected.push('tags') },
      { id: 'start', label: 'Start', disabled: true, separator: true, onSelect: () => selected.push('start') },
      { id: 'stop', label: 'Stop', danger: true, onSelect: () => selected.push('stop') },
    ]
    wrapper = mount(RowMenu, { props: { items }, attachTo: document.body })
    return { selected }
  }
  const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')]

  it('opens with focus on the first item, skips disabled ones with the arrows and selects', async () => {
    const { selected } = mountMenu()
    const trigger = wrapper.find('[aria-haspopup="menu"]')
    await trigger.trigger('click')
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="separator"]')).not.toBeNull()
    expect(document.activeElement.textContent).toBe('Tags')
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement.textContent).toBe('Stop')
    document.activeElement.click()
    await flushPromises()
    expect(selected).toEqual(['stop'])
    expect(menuItems()).toHaveLength(0)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('Escape closes and returns focus; a click outside closes it', async () => {
    mountMenu()
    const trigger = wrapper.find('[aria-haspopup="menu"]')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(menuItems()).toHaveLength(0)
    expect(document.activeElement).toBe(trigger.element)

    await trigger.trigger('click')
    await flushPromises()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(menuItems()).toHaveLength(0)
  })

  it('disabled items do not run', async () => {
    const { selected } = mountMenu()
    await wrapper.find('[aria-haspopup="menu"]').trigger('click')
    await flushPromises()
    menuItems()[1].click()
    expect(selected).toEqual([])
    vi.restoreAllMocks()
  })
})
