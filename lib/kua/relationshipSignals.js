'use strict';
/**
 * lib/kua/relationshipSignals.js
 * Log signals per resource of a KUA Application, keyed so relationships can
 * read them: the explanation of a relationship (#172) and the product Advisor
 * use the same lookup. Reads the local log cache aggregates only; returns
 * nothing (never throws) when the application has no cached logs.
 */

const { buildLogEvidence } = require('../logIntelligenceEvidence');
const { logGroupsForResource } = require('../logIntelligenceEvidence');
const { applicationForResource } = require('./scopeCredentials');

const LOG_BUCKET_MS = 30 * 60 * 1000;
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function logScopeForResource(database, application, resource) {
  if (resource.type === 'kubernetes') {
    const context = resource.kubeContext || resource.scopeId;
    if (!context || !resource.namespace) return null;
    return { profileId: `k8s:${context}`, region: resource.namespace };
  }
  try {
    const scoped = applicationForResource(database, application, resource);
    const region = resource.location || scoped.region || application.region;
    return scoped.profileId && region ? { profileId: scoped.profileId, region } : null;
  } catch {
    return null;
  }
}

async function readGroupIntelligence(cache, scope, logGroup, scopeCache) {
  if (typeof cache.intelligenceFor === 'function') return cache.intelligenceFor({ ...scope, logGroup });
  if (typeof cache.intelligenceForScope !== 'function') return null;
  const key = `${scope.profileId}\u0000${scope.region}`;
  if (!scopeCache.has(key)) scopeCache.set(key, cache.intelligenceForScope(scope));
  return (await scopeCache.get(key))?.[logGroup] || null;
}

async function loadApplicationSignals({ apmDatabase, application, cache }) {
  const apmResources = apmDatabase.listResources(application.id);
  const registryResources = apmDatabase.listRegistryResources(application.id);
  const intelligenceByResource = {};
  const unavailableScopeResourceIds = [];
  const scopeCache = new Map();
  if (cache) {
    for (const resource of apmResources) {
      const groups = logGroupsForResource(resource);
      if (!groups.length) continue;
      const scope = logScopeForResource(apmDatabase, application, resource);
      if (!scope) {
        intelligenceByResource[resource.id] = [];
        unavailableScopeResourceIds.push(resource.id);
        continue;
      }
      const intelligence = [];
      for (const logGroup of groups) {
        try {
          const summary = await readGroupIntelligence(cache, scope, logGroup, scopeCache);
          if (summary) intelligence.push({ logGroup, intelligence: summary });
        } catch { /* a stale or unavailable cache group does not hide other resources */ }
      }
      intelligenceByResource[resource.id] = intelligence;
    }
  }
  const evidence = buildLogEvidence({
    application,
    resources: apmResources,
    edges: apmDatabase.listEdges(application.id),
    intelligenceByResource,
    unavailableScopeResourceIds,
  });
  const byApmId = new Map();
  for (const signal of evidence.signals) {
    const current = byApmId.get(signal.resourceId);
    if (!current || Number(signal.lastEventAt || 0) > Number(current.lastEventAt || 0)) byApmId.set(signal.resourceId, signal);
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
    evidence,
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

async function productLogAnalysis({ apmDatabase, application, cache }) {
  const lookup = await loadApplicationSignals({ apmDatabase, application, cache });
  const logHistory = await applicationLogHistory({
    apmDatabase, application, cache, from: Date.now() - 2 * DAY_MS, to: Date.now(),
  });
  const resources = new Map(apmDatabase.listResources(application.id).map(resource => [resource.id, resource]));
  const registryResources = new Map(apmDatabase.listRegistryResources(application.id).map(resource => [resource.id, resource]));
  const dependencies = apmDatabase.listRegistryRelationships(application.id)
    .filter(relationship => ['confirmed', 'automatic'].includes(relationship.status))
    .map(relationship => {
      const target = lookup.resolve(relationship.targetResourceId);
      const rate = lookup.signalFor(target)?.last24h?.errorRatePercent;
      return {
        source: registryResources.get(relationship.sourceResourceId)?.displayName || relationship.sourceResourceId,
        target: target.name,
        targetErrorRatePercent: Number.isFinite(Number(rate)) ? Number(rate) : null,
      };
    })
    .filter(item => item.targetErrorRatePercent != null);
  return {
    dependencies,
    logHealth: logHistory.health,
    resourceLogs: lookup.evidence.signals,
    uncachedLogResources: lookup.evidence.uncachedResourceIds
      .map(id => resources.get(id))
      .filter(Boolean)
      .map(resource => ({ id: resource.id, name: resource.name, type: resource.type, kind: resource.kind || '' })),
    unavailableLogScopeResources: lookup.evidence.unavailableScopeResourceIds
      .map(id => resources.get(id))
      .filter(Boolean)
      .map(resource => ({ id: resource.id, name: resource.name, type: resource.type, kind: resource.kind || '' })),
  };
}

async function applicationLogHistory({ apmDatabase, application, cache, from, to = Date.now() }) {
  const end = Number(to);
  const requestedFrom = Number(from);
  const start = Math.max(Number.isFinite(requestedFrom) ? requestedFrom : end - DAY_MS, end - LOG_RETENTION_MS);
  const resources = apmDatabase.listResources(application.id);
  const sources = new Map();
  const unavailable = new Map();
  for (const resource of resources) {
    const groups = logGroupsForResource(resource);
    if (!groups.length) continue;
    const scope = logScopeForResource(apmDatabase, application, resource);
    if (!scope) {
      unavailable.set(resource.id, { id: resource.id, name: resource.name, type: resource.type, kind: resource.kind || '' });
      continue;
    }
    for (const logGroup of groups) {
      const key = `${scope.profileId}\u0000${scope.region}\u0000${logGroup}`;
      const source = sources.get(key) || { ...scope, logGroup, resources: [] };
      if (!source.resources.some(item => item.id === resource.id)) source.resources.push({ id: resource.id, name: resource.name });
      sources.set(key, source);
    }
  }

  const buckets = new Map();
  const cachedSources = [];
  const uncached = new Map();
  const signatureCounts = { current: new Map(), previous: new Map() };
  let signatureCoverageComplete = sources.size > 0;
  for (const source of sources.values()) {
    let history;
    try {
      history = await cache?.histogram?.({
        profileId: source.profileId, region: source.region, logGroup: source.logGroup,
        from: start, to: end, binMs: LOG_BUCKET_MS,
      });
    } catch { /* one unavailable group must not hide the rest of this application's history */ }
    const coverage = history?.coverage || {};
    const coverageFrom = coverage.coverageFrom ?? coverage.oldest;
    const syncedUntil = coverage.syncedUntil;
    if (coverage.lastSyncAt == null || coverageFrom == null || syncedUntil == null) {
      signatureCoverageComplete = false;
      for (const resource of source.resources) uncached.set(resource.id, { ...resource, type: 'resource' });
      continue;
    }
    const signatureWindowStart = end - 2 * DAY_MS;
    const hasSignatureCoverage = coverage.coverageFrom != null
      && coverage.coverageFrom <= signatureWindowStart
      && syncedUntil >= end - LOG_BUCKET_MS;
    if (!hasSignatureCoverage) signatureCoverageComplete = false;
    const cachedSource = {
      logGroup: source.logGroup,
      resourceIds: source.resources.map(resource => resource.id),
      resourceNames: source.resources.map(resource => resource.name),
      coverageFrom,
      syncedUntil,
      lastSyncAt: coverage.lastSyncAt,
    };
    cachedSources.push(cachedSource);
    for (const bucket of history.buckets || []) {
      const bucketEnd = bucket.start + LOG_BUCKET_MS;
      if (bucketEnd <= coverageFrom || bucket.start >= syncedUntil) continue;
      const current = buckets.get(bucket.start) || { t: bucket.start, errors: 0, warnings: 0, events: 0, coveredSources: 0 };
      current.errors += Number(bucket.error) || 0;
      current.warnings += Number(bucket.warn) || 0;
      current.events += (Number(bucket.error) || 0) + (Number(bucket.warn) || 0) + (Number(bucket.info) || 0);
      current.coveredSources += 1;
      buckets.set(bucket.start, current);
    }
    if (hasSignatureCoverage && typeof cache?.signatureCounts === 'function') {
      for (const [window, windowFrom, windowTo] of [
        ['previous', end - 2 * DAY_MS, end - DAY_MS],
        ['current', end - DAY_MS, end],
      ]) {
        try {
          const counts = await cache.signatureCounts({
            profileId: source.profileId, region: source.region, logGroup: source.logGroup,
            from: windowFrom, to: windowTo,
          });
          for (const item of counts) {
            signatureCounts[window].set(item.signature, (signatureCounts[window].get(item.signature) || 0) + Number(item.occurrences || 0));
          }
        } catch { /* signature history is best-effort; rate series remain available */ }
      }
    }
  }

  const points = [...buckets.values()].sort((left, right) => left.t - right.t).map(bucket => ({
    ...bucket,
    errorRatePercent: bucket.events ? bucket.errors * 100 / bucket.events : null,
    warningRatePercent: bucket.events ? bucket.warnings * 100 / bucket.events : null,
    partial: bucket.coveredSources < cachedSources.length,
  }));
  const recentFrom = Math.floor((end - DAY_MS) / LOG_BUCKET_MS) * LOG_BUCKET_MS;
  const recent = [...buckets.values()].filter(bucket => bucket.t >= recentFrom && bucket.t < end)
    .reduce((totals, bucket) => ({ errors: totals.errors + bucket.errors, events: totals.events + bucket.events }), { errors: 0, events: 0 });
  const logThresholds = {
    errorRatePercent: recent.events ? recent.errors * 100 / recent.events : null,
    signatures: (signatureCoverageComplete ? [...signatureCounts.current.entries()] : []).map(([signature, currentOccurrences]) => ({
      signature,
      currentOccurrences,
      previousOccurrences: signatureCounts.previous.get(signature) || 0,
    })),
  };
  return {
    from: start,
    to: end,
    binMs: LOG_BUCKET_MS,
    points,
    health: logThresholds,
    coverage: {
      lastSyncAt: cachedSources.length ? Math.min(...cachedSources.map(source => source.lastSyncAt)) : null,
      sources: cachedSources,
      uncachedResources: [...uncached.values()],
      unavailableScopeResources: [...unavailable.values()],
      limitedToDays: Math.min(30, Math.ceil((end - start) / DAY_MS)),
    },
  };
}

module.exports = { applicationLogHistory, dependencySignals, loadApplicationSignals, logScopeForResource, productLogAnalysis };
