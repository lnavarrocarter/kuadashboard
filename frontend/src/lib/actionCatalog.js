// The KUApps action catalog (#329), shared with the backend (lib/kua/actionCatalog.js validates it
// and checks every write route is in it). The task coordinator reads here what a write invalidates.
import catalog from '../shared/actionCatalog.json'

export const ACTIONS = catalog.actions

/** UI parts an action makes stale; [] for an unknown key. */
export function invalidatesFor(key) {
  return [...(ACTIONS[key]?.invalidates || [])]
}
