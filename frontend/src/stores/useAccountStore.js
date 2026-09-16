/**
 * stores/useAccountStore.js
 * KUA Control Plane account: Google login, session and entitlements.
 *
 * Entirely opt-in and additive — every existing local/free feature keeps working
 * with no control plane configured at all (`enabled` stays false and the header
 * button that opens this never renders).
 */
import { defineStore } from 'pinia'

const CONTROL_PLANE_URL = String(import.meta.env.VITE_CONTROL_PLANE_URL || '').replace(/\/$/, '')

export const useAccountStore = defineStore('account', {
  state: () => ({
    enabled: Boolean(CONTROL_PLANE_URL),
    status: 'idle', // idle | loading | anonymous | authenticated | unavailable | error
    user: null,
    entitlements: null,
    error: '',
  }),
  actions: {
    async fetchMe() {
      if (!this.enabled) return
      this.status = 'loading'
      this.error = ''
      try {
        const res = await fetch(`${CONTROL_PLANE_URL}/api/me`, { credentials: 'include' })
        if (res.status === 401) {
          this.user = null
          this.entitlements = null
          this.status = 'anonymous'
          return
        }
        if (res.status === 503) { this.status = 'unavailable'; return }
        if (!res.ok) throw new Error(`Request failed (${res.status})`)
        const data = await res.json()
        this.user = data.user
        this.entitlements = data.entitlements
        this.status = 'authenticated'
      } catch (e) {
        this.status = 'error'
        this.error = e.message || 'Network error'
      }
    },

    /** Redirects to Google sign-in, unless the control plane reports Google auth isn't configured yet. */
    login(returnTo = `${window.location.pathname}${window.location.search}`) {
      if (!this.enabled) return
      const url = `${CONTROL_PLANE_URL}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
      fetch(url, { redirect: 'manual', credentials: 'include' })
        .then(res => {
          if (res.status === 503) { this.status = 'unavailable'; return }
          window.location.href = url
        })
        .catch(() => { window.location.href = url })
    },

    async logout() {
      if (!this.enabled) return
      try {
        await fetch(`${CONTROL_PLANE_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
      } catch (_) { /* best-effort: clear local state regardless */ }
      this.user = null
      this.entitlements = null
      this.status = 'anonymous'
    },

    /** Call once on app mount: strips `?auth=complete` left by the OAuth callback redirect and refreshes the session. */
    consumeAuthComplete() {
      if (!this.enabled) return
      const url = new URL(window.location.href)
      if (url.searchParams.get('auth') !== 'complete') return
      url.searchParams.delete('auth')
      const search = url.searchParams.toString()
      window.history.replaceState({}, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`)
      this.fetchMe()
    },
  },
})
