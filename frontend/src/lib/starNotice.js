// Frequency rules of the GitHub star notice. State lives only in localStorage.
export const STAR_REPO_URL = 'https://github.com/lnavarrocarter/kuadashboard'
export const STAR_NOTICE_KEY = 'kua:starNotice'
export const MIN_SESSIONS = 5
export const MIN_DAYS = 7
export const LATER_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

function empty() {
  return { firstSeen: 0, sessions: 0, never: false, laterUntil: 0 }
}

export function loadStarState(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(STAR_NOTICE_KEY) || '{}')
    return { ...empty(), ...saved }
  } catch {
    return empty()
  }
}

export function saveStarState(state, storage = globalThis.localStorage) {
  try { storage.setItem(STAR_NOTICE_KEY, JSON.stringify(state)) } catch { /* private mode */ }
}

// Counts one app session; the first one marks the "installation" date.
export function recordSession(state, now = Date.now()) {
  return { ...state, firstSeen: state.firstSeen || now, sessions: state.sessions + 1 }
}

export function shouldShowStarNotice(state, now = Date.now()) {
  if (state.never) return false
  if (state.laterUntil > now) return false
  if (state.sessions >= MIN_SESSIONS) return true
  return !!state.firstSeen && now - state.firstSeen >= MIN_DAYS * DAY_MS
}

export function snoozeStarNotice(state, now = Date.now()) {
  return { ...state, laterUntil: now + LATER_DAYS * DAY_MS }
}

export function neverShowStarNotice(state) {
  return { ...state, never: true }
}

// Settings toggle: turning it back on forgets "Maybe later" and "Don't show again".
export function resetStarNotice(state) {
  return { ...state, never: false, laterUntil: 0 }
}
