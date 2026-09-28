// Background auto-refresh fires every few seconds. A gate lets a view skip a
// background reload while its last load is newer than the interval chosen in
// Options; manual refreshes never ask the gate, so they always load.
export function createRefreshGate(now = () => Date.now()) {
  const loadedAt = new Map()
  return {
    fresh(key, seconds) {
      const at = loadedAt.get(key)
      return Number(seconds) > 0 && at != null && now() - at < Number(seconds) * 1000
    },
    mark(key) { loadedAt.set(key, now()) },
    clear() { loadedAt.clear() },
  }
}
