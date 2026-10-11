import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const openExternal = vi.fn()
vi.mock('../lib/openExternal.js', () => ({ openExternal: (...args) => openExternal(...args) }))
const current = vi.hoisted(() => ({ version: '2.0.0' }))
vi.mock('../composables/useChangelog.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, get CHANGELOG_VERSION() { return current.version } }
})

import WelcomeModal from '../components/modals/WelcomeModal.vue'
import { welcomeVariant, CHANGELOG_URL } from '../lib/welcome.js'
import { settings } from '../composables/useSettings.js'
import en from '../locales/en.js'
import es from '../locales/es.js'

const KEY = 'kuadashboard_last_seen_version'

async function open(lang = 'en') {
  settings.lang = lang
  const wrapper = mount(WelcomeModal, { attachTo: document.body })
  await vi.advanceTimersByTimeAsync(1300)
  return wrapper
}

describe('welcomeVariant', () => {
  it('shows the 2.0 welcome coming from 1.x or on a first run', () => {
    expect(welcomeVariant('1.17.0', '2.0.0')).toBe('major')
    expect(welcomeVariant(null, '2.0.0')).toBe('major')
  })
  it('shows the short list for later versions and nothing when already seen', () => {
    expect(welcomeVariant('2.0.0', '2.0.1')).toBe('update')
    expect(welcomeVariant('2.0.3', '2.1.0')).toBe('update')
    expect(welcomeVariant('1.16.0', '1.17.0')).toBe('update')
    expect(welcomeVariant('2.0.0', '2.0.0')).toBeNull()
  })
})

describe('WelcomeModal', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); openExternal.mockReset(); current.version = '2.0.0' })
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

  it('opens the 2.0 welcome once when coming from 1.x', async () => {
    localStorage.setItem(KEY, '1.17.0')
    const wrapper = await open()
    expect(document.body.textContent).toContain('Welcome to KUA 2.0')
    expect(document.body.querySelectorAll('.highlight').length).toBeGreaterThanOrEqual(3)
    expect(document.body.querySelector('[data-test="welcome-dismiss"]').textContent.trim()).toBe('Get started')
    document.body.querySelector('[data-test="welcome-dismiss"]').click()
    expect(localStorage.getItem(KEY)).toBe('2.0.0')
    wrapper.unmount()

    const again = await open()
    expect(again.vm.$.setupState.visible).toBe(false)
    expect(document.body.querySelector('[style*="display: flex"]')).toBeNull()
  })

  it('is in Spanish and links the full changelog', async () => {
    localStorage.setItem(KEY, '1.17.0')
    await open('es')
    expect(document.body.textContent).toContain('Te damos la bienvenida a KUA 2.0')
    expect(document.body.querySelector('[data-test="welcome-dismiss"]').textContent.trim()).toBe('Comenzar')
    document.body.querySelector('[data-test="welcome-changelog"]').click()
    expect(openExternal).toHaveBeenCalledWith(CHANGELOG_URL)
  })

  it('moves focus into the modal and Escape closes it', async () => {
    const wrapper = await open()
    expect(document.activeElement).toBe(document.body.querySelector('[data-test="welcome-dismiss"]'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.$.setupState.visible).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('2.0.0')
  })

  it('keeps the short list for later versions', async () => {
    current.version = '2.0.1'
    localStorage.setItem(KEY, '2.0.0')
    const wrapper = await open()
    expect(wrapper.vm.$.setupState.variant).toBe('update')
    expect(document.body.querySelector('[data-test="welcome-v2"]')).toBeNull()
    expect(document.body.textContent).toContain("What's new in KUA v2.0.1")
  })

  it('stays closed when the version was already seen', async () => {
    localStorage.setItem(KEY, '2.0.0')
    const wrapper = await open()
    expect(wrapper.vm.$.setupState.visible).toBe(false)
  })

  it('has every welcome.v2 text in English and Spanish', () => {
    const keys = Object.keys(en).filter(k => k.startsWith('welcome.v2.'))
    expect(keys.length).toBeGreaterThan(10)
    for (const k of keys) expect(es[k], k).toBeTruthy()
  })
})
