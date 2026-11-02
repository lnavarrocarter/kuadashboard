'use strict';
/**
 * lib/apm/cloudTopologyCache.js
 * The last cloud topology analysis of each application (#328), so confirming a
 * dependency or reopening the Review tab does not query AWS again.
 *
 * An entry is valid while the application's cloud resources (ids, ARNs, types,
 * profile and region) are the ones it analyzed and it is younger than the TTL.
 * When the resources changed it is reported as stale, with no suggestions,
 * until someone analyzes again. Suggestions are stored without filtering by
 * confirmed edges and filtered on read, so confirming never invalidates it.
 */

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 100;

function resourceSignature(application, resources) {
  const parts = resources
    .map(resource => `${resource.id}|${resource.type}|${resource.arn || resource.key || ''}`)
    .sort();
  return [application.profileId || '', application.region || '', ...parts].join('\n');
}

function withoutConfirmed(suggestions = [], edges = []) {
  // Same rule as the reader: any confirmed edge between the pair settles it.
  const confirmed = new Set(edges.map(edge => `${edge.sourceResourceId}:${edge.targetResourceId}`));
  return suggestions.filter(suggestion => !confirmed.has(`${suggestion.sourceResourceId}:${suggestion.targetResourceId}`));
}

function createCloudTopologyCache({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map();

  function store(application, resources, evidence) {
    entries.delete(application.id);
    entries.set(application.id, { signature: resourceSignature(application, resources), evidence, analyzedAt: now() });
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  }

  /**
   * Evidence for analyzeTopology(), or null when there is none.
   * `state`: 'current' (reusable), 'stale' (resources changed: no suggestions) or 'expired'.
   */
  function read(application, resources, edges) {
    const entry = entries.get(application.id);
    if (!entry) return null;
    const analyzedAt = new Date(entry.analyzedAt).toISOString();
    if (entry.signature !== resourceSignature(application, resources)) {
      return { requests: entry.evidence.requests, suggestions: [], unresolvedReferences: [], failedResources: [], analyzedAt, state: 'stale' };
    }
    const state = now() - entry.analyzedAt > ttlMs ? 'expired' : 'current';
    return { ...entry.evidence, suggestions: withoutConfirmed(entry.evidence.suggestions, edges), analyzedAt, state };
  }

  function forget(applicationId) {
    entries.delete(applicationId);
  }

  return { store, read, forget };
}

module.exports = { createCloudTopologyCache, resourceSignature, withoutConfirmed, DEFAULT_TTL_MS };
