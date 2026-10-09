'use strict';
/**
 * lib/kua/resourceSignalState.js
 * The signal state of each resource of a KUA Application (#152), so the UI never shows a
 * resource without data as empty or healthy. Read-only: local tables only, no cloud call.
 *
 *   unsupported    KUA does not collect signals for this provider or resource type
 *   gone           the resource no longer exists where it lived (deleted, or renamed by a release)
 *   no_connection  no verified profile of this computer reaches the resource's scope
 *   disabled       collection is off for the application or the resource
 *   error          the last collection of the application failed
 *   no_data        nothing has been collected yet
 *   stale          the latest data is older than three collection intervals (at least 2 h)
 *   partial        the last collection only read part of the data
 *   current        recent data
 */

const { BUILTIN_PROVIDERS } = require('./applicationContract');
const { canonicalFromApm } = require('./applicationRegistryService');
const { applicationForResource } = require('./scopeCredentials');
const { signalCapabilities } = require('../apm/signalCapabilities');
const { readPresence } = require('../apm/resourcePresence');

const MIN_STALE_MS = 2 * 60 * 60 * 1000;

function resourceSignalStates({ database, application, resources, now = Date.now() }) {
  const members = new Map();
  for (const resource of database.listResources(application.id)) {
    try { members.set(canonicalFromApm(application, resource).id, resource); } catch { /* not in the registry */ }
  }
  const lastDataAt = database.listLatestMetricTimes([...members.values()].map(resource => resource.id));
  const run = database.getLatestCollectionRun(application.id);
  const staleAfterMs = Math.max(MIN_STALE_MS, 3 * (Number(application.pollIntervalMinutes) || 30) * 60 * 1000);
  const states = new Map();
  for (const resource of resources) {
    const member = members.get(resource.id);
    const at = member ? lastDataAt.get(member.id) || null : null;
    const state = (kind, extra = {}) => ({ state: kind, lastDataAt: at, ...extra });
    if (!BUILTIN_PROVIDERS.includes(resource.provider)) { states.set(resource.id, state('unsupported', { reason: 'provider' })); continue; }
    if (!member || !signalCapabilities(member).metrics) { states.set(resource.id, state('unsupported', { reason: 'type' })); continue; }
    const presence = typeof database.getCursor === 'function' ? readPresence(database, member.id) : {};
    if (presence.goneSince) { states.set(resource.id, state('gone', { goneSince: presence.goneSince })); continue; }
    try {
      applicationForResource(database, application, member);
    } catch (error) {
      states.set(resource.id, state('no_connection', { reason: error.code || 'scope_unbound' }));
      continue;
    }
    if (!member.enabled || !application.pollingEnabled) { states.set(resource.id, state('disabled', { reason: member.enabled ? 'application' : 'resource' })); continue; }
    if (run?.status === 'failed' || run?.status === 'budget_exhausted') { states.set(resource.id, state('error', { reason: run.errorCode || run.status })); continue; }
    if (!at) { states.set(resource.id, state('no_data')); continue; }
    if (now - Date.parse(at) > staleAfterMs) { states.set(resource.id, state('stale')); continue; }
    states.set(resource.id, state(run?.status === 'partial' ? 'partial' : 'current'));
  }
  return states;
}

module.exports = { resourceSignalStates };
