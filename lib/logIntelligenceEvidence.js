'use strict';
/**
 * lib/logIntelligenceEvidence.js
 * Turns the log intelligence of cached groups into Observed evidence for a
 * KUA Application (APM): per-resource log signals, findings, and suggested
 * relationships from resources referenced in logs. Suggestions are never
 * applied automatically; they go through the existing confirm flow
 * (unified plan, Phase 16). Pure functions: no I/O besides the APM database
 * read in linkedApmResources.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RECURRING_MIN = 3;
const SEVERE_KEYWORDS = ['timeout', 'out_of_memory', 'throttling', 'access_denied', 'crash', 'connection'];

// What a resource does to the resource its logs mention.
const RELATION_BY_TARGET = {
  lambda: 'invokes',
  stepfunctions: 'starts_execution',
  sqs: 'sends_to',
  sns: 'publishes_to',
  eventbridge: 'puts_events',
  kinesis: 'sends_to',
  firehose: 'sends_to',
  dynamodb: 'uses',
  s3: 'uses',
  rds: 'uses',
  secrets: 'uses',
  apigateway: 'calls',
  kubernetes: 'calls',
};

/** Log groups a resource writes to: explicit log group, or the Lambda default. */
function logGroupsForResource(resource) {
  const groups = [];
  if (resource.logGroup) groups.push(resource.logGroup);
  if (resource.type === 'lambda' && resource.name) groups.push(`/aws/lambda/${resource.name}`);
  if (['gcp-cloud-run', 'gcp-function'].includes(resource.type) && resource.name) {
    const keyRegion = String(resource.key || '').split('/')[0];
    const region = resource.location || resource.region || keyRegion;
    if (region) {
      const kind = resource.type === 'gcp-function' ? 'function' : 'cloudrun';
      const project = encodeURIComponent(resource.scopeId || resource.projectId || '');
      groups.push(`gcp:${kind}:${project}:${encodeURIComponent(region)}:${encodeURIComponent(resource.service || resource.name)}`);
    }
  }
  if (resource.type === 'vercel-project') {
    const project = resource.projectId || resource.key || resource.name;
    if (project) groups.push(`vercel:project:${encodeURIComponent(project)}`);
  }
  if (resource.type === 'kubernetes' && resource.namespace && resource.name) {
    const kind = String(resource.kind || '').toLowerCase();
    const workloadKind = {
      deployment: 'deployments',
      statefulset: 'statefulsets',
      daemonset: 'daemonsets',
      pod: 'pods',
    }[kind];
    if (workloadKind) groups.push(`${resource.namespace}/${workloadKind}/${resource.name}`);
  }
  return [...new Set(groups)];
}

function canHaveLogs(resource) {
  return resource.enabled && logGroupsForResource(resource).length > 0;
}

function referenceConfidence(occurrences) {
  // Same curve as shared/logSignals.mjs referenceConfidence (never 1: humans confirm).
  return Number(Math.min(0.35 + occurrences * 0.1, 0.85).toFixed(2));
}

function matchesReference(resource, ref) {
  if (!resource.enabled) return false;
  if (ref.kind === 'arn' && resource.arn && resource.arn === ref.target) return true;
  if (ref.type === 'kubernetes') {
    return resource.type === 'kubernetes' && resource.name === ref.name && (!ref.namespace || !resource.namespace || resource.namespace === ref.namespace);
  }
  if (ref.type === 'apigateway') {
    return resource.type === 'apigateway' && (resource.name === ref.name || String(resource.arn || '').includes(`/${ref.name}`) || resource.key === ref.name);
  }
  return resource.type === ref.type && resource.name === ref.name;
}

/**
 * @param application  APM application (profileId, region, thresholds)
 * @param resources    APM resources of the application
 * @param edges        confirmed edges (to skip pairs already connected)
 * @param intelligenceByGroup { [logGroup]: summary } for the application's profile/region
 */
function buildLogEvidence({ application, resources = [], edges = [], intelligenceByGroup = {}, intelligenceByResource = {}, unavailableScopeResourceIds = [], now = Date.now() }) {
  const connected = new Set(edges.map(edge => [edge.sourceResourceId, edge.targetResourceId].sort().join(':')));
  const errorThreshold = application?.thresholds?.errorRatePercent ?? 5;
  const signals = [];
  const uncachedResourceIds = [];
  const unavailableScopes = new Set(unavailableScopeResourceIds);
  const suggestions = new Map();
  const unresolved = new Map();

  for (const resource of resources.filter(canHaveLogs)) {
    const records = Object.hasOwn(intelligenceByResource, resource.id)
      ? (intelligenceByResource[resource.id] || [])
      : logGroupsForResource(resource).map(logGroup => ({ logGroup, intelligence: intelligenceByGroup[logGroup] })).filter(item => item.intelligence);
    if (!records.length) {
      if (!unavailableScopes.has(resource.id)) uncachedResourceIds.push(resource.id);
      continue;
    }
    for (const { logGroup, intelligence: intel } of records) {
      const recurring = (intel.signatures || []).filter(s => s.level === 'error' && s.occurrences >= RECURRING_MIN && now - s.lastSeen <= DAY_MS);
      const severeKeywords = Object.fromEntries(Object.entries(intel.keywords24h || {}).filter(([k, v]) => SEVERE_KEYWORDS.includes(k) && v > 0));
      const rate = intel.last24h?.errorRatePercent;
      signals.push({
        resourceId: resource.id,
        resourceName: resource.name,
        logGroup,
        last24h: intel.last24h,
        last7d: intel.last7d,
        lastEventAt: intel.lastEventAt,
        lastSyncAt: intel.cache?.lastSyncAt ?? null,
        errorRateHigh: errorThreshold != null && rate != null && rate > errorThreshold,
        errorThreshold,
        recurringErrors: recurring.slice(0, 3).map(s => ({ signature: s.signature, sample: s.sample, occurrences: s.occurrences, lastSeen: s.lastSeen })),
        severeKeywords,
        topCategories: Object.entries(intel.categories24h || {})
          .filter(([category]) => !['info', 'platform', 'debug'].includes(category))
          .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([category, count]) => ({ category, count })),
        recommendations: (intel.recommendations || []).slice(0, 3).map(r => ({ id: r.id, kind: r.kind, severity: r.severity, confidence: r.confidence, params: r.params })),
      });
      for (const ref of intel.references || []) {
        const target = resources.find(candidate => candidate.id !== resource.id && matchesReference(candidate, ref));
        if (!target) {
          if (RELATION_BY_TARGET[ref.type] && ref.type !== 'kubernetes' && !(ref.type === resource.type && ref.name === resource.name)) {
            const key = `${ref.type}:${ref.name}`;
            const current = unresolved.get(key) || { type: ref.type, name: ref.name, target: ref.target, occurrences: 0, seenIn: [] };
            current.occurrences += ref.occurrences;
            if (!current.seenIn.includes(resource.name)) current.seenIn.push(resource.name);
            unresolved.set(key, current);
          }
          continue;
        }
        if (connected.has([resource.id, target.id].sort().join(':'))) continue;
        const relationType = RELATION_BY_TARGET[target.type] || 'depends_on';
        const key = `${resource.id}:${target.id}:${relationType}`;
        const current = suggestions.get(key);
        const occurrences = (current?.occurrences || 0) + ref.occurrences;
        suggestions.set(key, {
          sourceResourceId: resource.id,
          targetResourceId: target.id,
          relationType,
          confidence: referenceConfidence(occurrences),
          occurrences,
          evidence: [{ type: 'observed_log_reference', values: [logGroup, ref.target, String(occurrences)] }],
          confirmed: false,
        });
      }
    }
  }

  const findings = [];
  const ids = list => [...new Set(list.map(s => s.resourceId))];
  const high = signals.filter(s => s.errorRateHigh);
  if (high.length) findings.push({ code: 'log_error_rate_high', severity: 'warning', resourceIds: ids(high) });
  const recurring = signals.filter(s => s.recurringErrors.length);
  if (recurring.length) findings.push({ code: 'log_recurring_errors', severity: 'warning', resourceIds: ids(recurring) });
  const severe = signals.filter(s => Object.keys(s.severeKeywords).length);
  if (severe.length) findings.push({ code: 'log_failure_keywords', severity: 'warning', resourceIds: ids(severe) });
  const stale = signals.filter(s => !s.lastSyncAt || now - s.lastSyncAt > DAY_MS);
  if (stale.length) findings.push({ code: 'log_cache_stale', severity: 'info', resourceIds: ids(stale) });
  if (uncachedResourceIds.length) findings.push({ code: 'logs_not_cached', severity: 'info', resourceIds: uncachedResourceIds });
  if (unresolved.size) findings.push({ code: 'log_references_outside_app', severity: 'info', resourceIds: [] });

  return {
    signals,
    uncachedResourceIds,
    unavailableScopeResourceIds: [...unavailableScopes],
    findings,
    suggestions: [...suggestions.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 20),
    unresolvedReferences: [...unresolved.values()].sort((a, b) => b.occurrences - a.occurrences).slice(0, 20),
  };
}

/** APM applications/resources that read a log group (for the CloudWatch Logs tab). */
function linkedApmResources({ database, profileId, region, logGroup }) {
  if (!database) return [];
  const linked = [];
  for (const application of database.listApplications({ profileId, region })) {
    for (const resource of database.listResources(application.id)) {
      if (logGroupsForResource(resource).includes(logGroup)) {
        linked.push({ applicationId: application.id, applicationName: application.name, environment: application.environment || '', resourceId: resource.id, resourceName: resource.name, type: resource.type });
      }
    }
  }
  return linked;
}

module.exports = { buildLogEvidence, linkedApmResources, logGroupsForResource, RELATION_BY_TARGET };
