export const WELCOME_STORAGE_KEY = 'kuadashboard_last_seen_version'
export const WELCOME_MAJOR = 2
export const CHANGELOG_URL = 'https://kuadashboard.navarrocarter.com/changelog.html'

function major(version) {
  const n = parseInt(String(version || '').split('.')[0], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * What the welcome shows for the running version:
 * 'major' the KUA 2.0 welcome, once, when coming from 1.x or a first run on 2.x;
 * 'update' the short list of changes for any later version;
 * null nothing (this version was already seen).
 */
export function welcomeVariant(lastSeen, version) {
  if (lastSeen === version) return null
  if (major(version) === WELCOME_MAJOR && (lastSeen == null || (major(lastSeen) ?? 0) < WELCOME_MAJOR)) return 'major'
  return 'update'
}
