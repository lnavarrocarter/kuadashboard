'use strict';
/**
 * lib/kua/relationshipSignals.js
 * Log signals per resource of a KUA Application, keyed so relationships can
 * read them: the explanation of a relationship (#172) and the product Advisor
 * use the same lookup. Reads the local log cache aggregates only; returns
 * nothing (never throws) when the application has no cached logs.
 */

const { buildLogEvidence } = require('../logIntelligenceEvidence');

async function loadApplicationSignals({ apmDatabase, application, cache }) {
  const apmResources = apmDatabase.listResources(application.id);
  const registryResources = apmDatabase.listRegistryResources(application.id);
  const byApmId = new Map();
  if (application.profileId && application.region && cache) {
    try {
      const intelligenceByGroup = await cache.intelligenceForScope({ profileId: application.profileId, region: application.region });
      const evidence = buildLogEvidence({ application, resources: apmResources, edges: apmDatabase.listEdges(application.id), intelligenceByGroup });
      for (const signal of evidence?.signals || []) byApmId.set(signal.resourceId, signal);
    } catch (_) { /* no cached logs: the caller states it */ }
  }

  // A resource id may be an APM resource or a registry resource that has one in its lineage.
  function resolve(id, fallbackName = '') {
    const apm = apmResources.find(resource => resource.id === id);
    if (apm) return { id, name: apm.name, type: apm.type, nativeIdentifier: apm.arn || apm.key, apm };
    const registered = registryResources.find(resource => resource.id === id);
    if (registered) {
      const apmId = (registered.lineage || []).find(item => item.kind === 'apm_resource')?.id;
      return { id, name: registered.displayName, type: registered.resourceType, nativeIdentifier: registered.nativeIdentifier, apm: apmResources.find(resource => resource.id === apmId) || null };
    }
    return { id, name: String(fallbackName || id || ''), type: '', nativeIdentifier: '', apm: null };
  }

  return {
    resolve,
    signalFor: resource => (resource?.apm ? byApmId.get(resource.apm.id) || null : null),
    hasSignals: byApmId.size > 0,
  };
}

/**
 * Confirmed dependencies whose target shows errors in its cached logs, for the
 * product Advisor: [{ source, target, targetErrorRatePercent }].
 */
async function dependencySignals({ apmDatabase, application, cache }) {
  const signals = await loadApplicationSignals({ apmDatabase, application, cache });
  if (!signals.hasSignals) return [];
  const resources = new Map(apmDatabase.listRegistryResources(application.id).map(resource => [resource.id, resource]));
  return apmDatabase.listRegistryRelationships(application.id)
    .filter(relationship => ['confirmed', 'automatic'].includes(relationship.status))
    .map(relationship => {
      const target = signals.resolve(relationship.targetResourceId);
      const rate = signals.signalFor(target)?.last24h?.errorRatePercent;
      return {
        source: resources.get(relationship.sourceResourceId)?.displayName || relationship.sourceResourceId,
        target: target.name,
        targetErrorRatePercent: Number.isFinite(Number(rate)) ? Number(rate) : null,
      };
    })
    .filter(item => item.targetErrorRatePercent != null);
}

module.exports = { loadApplicationSignals, dependencySignals };
