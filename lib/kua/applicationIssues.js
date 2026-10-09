'use strict';
/**
 * lib/kua/applicationIssues.js
 * What needs attention in a KUA Application, resource by resource, most important first (#239):
 * the resource, the evidence, since when, and the action that resolves it. Local data only.
 *
 *   threshold          a resource breaks an objective of the application in the time range
 *   collection_failed  the last collection of the resource failed (with its cause)
 *   gone               the resource no longer exists (#236)
 *   no_connection      no verified profile of this computer reaches its scope
 *   stale              its latest data is older than three collection intervals
 */

const { evaluateThresholds } = require('../apm/thresholds');
const { readCollection } = require('../apm/resourcePresence');
const { canonicalFromApm } = require('./applicationRegistryService');
const { resourceSignalStates } = require('./resourceSignalState');

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
// Breaking these is critical; the others (latency, duration, restarts) are warnings.
const CRITICAL_METRICS = new Set(['errorRatePercent', 'elb5xxRatePercent', 'readyPodsPercent']);

function applicationIssues({ database, application, from, to, now = Date.now() }) {
  const resources = database.listResources(application.id);
  const registryResources = database.listRegistryResources(application.id);
  const states = resourceSignalStates({ database, application, resources: registryResources, now });
  const registryIdOf = resource => { try { return canonicalFromApm(application, resource).id; } catch { return null; } };

  const totals = new Map();
  for (const row of database.listResourceMetricTotals(application.id, { from, to })) {
    if (!totals.has(row.resourceId)) totals.set(row.resourceId, []);
    totals.get(row.resourceId).push(row);
  }

  const issues = [];
  for (const resource of resources) {
    const registryId = registryIdOf(resource);
    const base = { resourceId: resource.id, registryId, resourceName: resource.name, resourceType: resource.type, resourceKind: resource.kind || null };
    const state = registryId ? states.get(registryId) : null;

    if (state?.state === 'gone') {
      issues.push({ ...base, id: `gone:${resource.id}`, kind: 'gone', severity: 'warning', since: state.goneSince, action: 'review_missing' });
      continue;
    }
    if (state?.state === 'no_connection') {
      issues.push({ ...base, id: `no_connection:${resource.id}`, kind: 'no_connection', severity: 'warning', since: null, evidence: { reason: state.reason }, action: 'bind_scope' });
      continue;
    }
    const collection = readCollection(database, resource.id);
    if (collection?.status === 'failed') {
      issues.push({ ...base, id: `collection:${resource.id}`, kind: 'collection_failed', severity: 'warning', since: collection.at, evidence: { errorCode: collection.errorCode, message: collection.message }, action: 'retry' });
    }
    const metrics = totals.get(resource.id) || [];
    if (metrics.length) {
      const { signals } = evaluateThresholds(metrics, application.thresholds || {});
      const lastAt = Math.max(...metrics.map(row => row.lastAt));
      for (const signal of signals) {
        issues.push({
          ...base, id: `threshold:${resource.id}:${signal.metric}`, kind: 'threshold',
          severity: CRITICAL_METRICS.has(signal.metric) ? 'critical' : 'warning',
          since: new Date(Math.min(...metrics.map(row => row.firstAt))).toISOString(), lastSeenAt: new Date(lastAt).toISOString(),
          evidence: { metric: signal.metric, value: signal.value, threshold: signal.threshold, comparison: signal.comparison },
          action: 'open_signals',
        });
      }
    }
    if (state?.state === 'stale') {
      issues.push({ ...base, id: `stale:${resource.id}`, kind: 'stale', severity: 'info', since: state.lastDataAt, action: 'retry' });
    }
  }
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || String(a.since || '').localeCompare(String(b.since || ''))
    || a.resourceName.localeCompare(b.resourceName));
  return {
    from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    counts: { critical: issues.filter(item => item.severity === 'critical').length, warning: issues.filter(item => item.severity === 'warning').length, info: issues.filter(item => item.severity === 'info').length },
    issues,
  };
}

module.exports = { applicationIssues };
