import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('lucide', () => ({ createIcons: vi.fn(), icons: {} }))
const openExternal = vi.fn()
vi.mock('../lib/openExternal', () => ({ openExternal: (...args) => openExternal(...args) }))

import StarNotice from '../components/StarNotice.vue'
import { settings } from '../composables/useSettings'
import { CHANGELOG_VERSION } from '../composables/useChangelog'
import {
  STAR_NOTICE_KEY, loadStarState, recordSession, shouldShowStarNotice,
  snoozeStarNotice, neverShowStarNotice, resetStarNotice,
} from '../lib/starNotice'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 0, 1)

describe('star notice frequency rules', () => {
  it('stays quiet at first, then shows after 5 sessions', () => {
    let state = recordSession(loadStarState({ getItem: () => null }), T0)
    expect(shouldShowStarNotice(state, T0)).toBe(false)
    for (let i = 0; i < 3; i++) state = recordSession(state, T0)
    expect(shouldShowStarNotice(state, T0)).toBe(false)
    state = recordSession(state, T0)
    expect(state.sessions).toBe(5)
    expect(shouldShowStarNotice(state, T0)).toBe(true)
  })

  it('shows 7 days after the first session even with few sessions', () => {
    const state = recordSession({ firstSeen: 0, sessions: 0, never: false, laterUntil: 0 }, T0)
    expect(shouldShowStarNotice(state, T0 + 7 * DAY - 1)).toBe(false)
    expect(shouldShowStarNotice(state, T0 + 7 * DAY)).toBe(true)
  })

  it('Maybe later hides it for 30 days', () => {
    const ready = { firstSeen: T0, sessions: 9, never: false, laterUntil: 0 }
    const snoozed = snoozeStarNotice(ready, T0 + 10 * DAY)
    expect(shouldShowStarNotice(snoozed, T0 + 39 * DAY)).toBe(false)
    expect(shouldShowStarNotice(snoozed, T0 + 40 * DAY)).toBe(true)
  })

  it("Don't show again is permanent until reset", () => {
    const ready = { firstSeen: T0, sessions: 9, never: false, laterUntil: 0 }
    const never = neverShowStarNotice(ready)
    expect(shouldShowStarNotice(never, T0 + 999 * DAY)).toBe(false)
    expect(shouldShowStarNotice(resetStarNotice(never), T0 + 999 * DAY)).toBe(true)
  })

  it('falls back to an empty state when storage is corrupt', () => {
    expect(loadStarState({ getItem: () => '{bad' })).toEqual({ firstSeen: 0, sessions: 0, never: false, laterUntil: 0 })
  })
})

describe('star notice component', () => {
  const ready = () => localStorage.setItem(STAR_NOTICE_KEY, JSON.stringify({ firstSeen: Date.now() - 20 * DAY, sessions: 9, never: false, laterUntil: 0 }))

  beforeEach(() => {
    localStorage.clear()
    settings.starNotice = true
    openExternal.mockReset()
    localStorage.setItem('kuadashboard_last_seen_version', CHANGELOG_VERSION)
  })

  it('does not show to a new user', async () => {
    const wrapper = mount(StarNotice)
    await flushPromises()
    expect(wrapper.find('[data-test="star-notice"]').exists()).toBe(false)
  })

  it('never shows in the session where the welcome modal opens', async () => {
    ready()
    localStorage.removeItem('kuadashboard_last_seen_version')
    const wrapper = mount(StarNotice)
    await flushPromises()
    expect(wrapper.find('[data-test="star-notice"]').exists()).toBe(false)
  })

  it('opens the repository and stays away afterwards', async () => {
    ready()
    const wrapper = mount(StarNotice)
    await flushPromises()
    await wrapper.get('[data-test="star-notice-star"]').trigger('click')
    expect(openExternal).toHaveBeenCalledWith('https://github.com/lnavarrocarter/kuadashboard')
    expect(wrapper.find('[data-test="star-notice"]').exists()).toBe(false)
    expect(mount(StarNotice).find('[data-test="star-notice"]').exists()).toBe(false)
  })

  it('Maybe later survives a restart', async () => {
    ready()
    const wrapper = mount(StarNotice)
    await flushPromises()
    await wrapper.get('[data-test="star-notice-later"]').trigger('click')
    expect(wrapper.find('[data-test="star-notice"]').exists()).toBe(false)
    const restarted = mount(StarNotice)
    await flushPromises()
    expect(restarted.find('[data-test="star-notice"]').exists()).toBe(false)
  })

  it("Don't show again survives a restart and the setting brings it back", async () => {
    ready()
    const wrapper = mount(StarNotice)
    await flushPromises()
    await wrapper.get('[data-test="star-notice-never"]').trigger('click')
    expect(settings.starNotice).toBe(false)
    const restarted = mount(StarNotice)
    await flushPromises()
    expect(restarted.find('[data-test="star-notice"]').exists()).toBe(false)
    settings.starNotice = true
    await flushPromises()
    expect(restarted.find('[data-test="star-notice"]').exists()).toBe(true)
  })
})
