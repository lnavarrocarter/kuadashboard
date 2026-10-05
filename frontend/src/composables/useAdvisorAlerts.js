/**
 * Advisor posture alerts shared by the header bell and the system
 * notifications. Polls the local API (no cloud call) while the plan includes
 * the Advisor; a new high finding or an expired acceptance also raises a
 * system notification, once, unless Options turned them off.
 */
import { reactive } from 'vue'
import { api } from './useApi'
import { settings } from './useSettings'
import { alertTitle, notifiable, scopeLabel } from '../lib/advisorAlerts'

const POLL_MS = 60 * 1000
// Highest alert id already notified on this computer (survives reloads).
const NOTIFIED_KEY = 'kua.advisorAlerts.notified'
const MAX_NOTIFICATIONS = 3

const state = reactive({ alerts: [], unread: 0, enabled: false })
let timer = null
let context = { t: key => key, profileName: id => id, onOpen: () => {} }

function readNotified() {
  try { return Number(localStorage.getItem(NOTIFIED_KEY)) || 0 } catch { return 0 }
}
function writeNotified(id) {
  try { localStorage.setItem(NOTIFIED_KEY, String(id)) } catch { /* per-viewer convenience only */ }
}

function notify(alerts) {
  const last = readNotified()
  const newest = Math.max(0, ...alerts.map(alert => alert.id))
  if (newest <= last) return
  writeNotified(newest)
  // First run on this computer: remember where we are, no burst of old alerts.
  if (!last) return
  if (!settings.advisorNotifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  for (const alert of alerts.filter(item => item.id > last && notifiable(item)).slice(0, MAX_NOTIFICATIONS)) {
    try {
      const notification = new Notification(alertTitle(alert, { t: context.t, lang: settings.lang }), {
        body: scopeLabel(alert, context),
        tag: `kua-advisor-${alert.id}`,
      })
      notification.onclick = () => { window.focus(); open(alert) }
    } catch { /* notifications unavailable */ }
  }
}

async function refresh({ silent = false } = {}) {
  try {
    const data = await api('GET', '/api/advisor/alerts?limit=50')
    state.alerts = data.alerts || []
    state.unread = data.unread || 0
    state.enabled = true
    if (!silent) notify(state.alerts)
  } catch (err) {
    // 403: the plan has no Advisor (Free) — stop asking until the plan changes.
    if (err.status === 403) stop()
  }
}

async function markRead(body) {
  try {
    const result = await api('POST', '/api/advisor/alerts/read', body)
    state.unread = result.unread
    const ids = new Set(body.ids || [])
    state.alerts = state.alerts.map(alert => (body.all || ids.has(alert.id) ? { ...alert, read: true } : alert))
  } catch { /* stays unread */ }
}

function open(alert) {
  if (!alert.read) markRead({ ids: [alert.id] })
  context.onOpen(alert)
}

function stop() {
  clearInterval(timer)
  timer = null
  state.enabled = false
}

/**
 * Starts polling. `t` and `profileName` render texts; `onOpen(alert)` takes
 * the user to the alert's overview.
 */
function start(options = {}) {
  context = { ...context, ...options }
  if (timer) return refresh()
  timer = setInterval(() => refresh(), POLL_MS)
  return refresh()
}

/** Asked when the user turns system notifications on (browsers need it; Electron grants it). */
async function requestPermission() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  try { await Notification.requestPermission() } catch { /* not supported */ }
}

export function useAdvisorAlerts() {
  return { state, start, stop, refresh, markRead, open, requestPermission }
}
