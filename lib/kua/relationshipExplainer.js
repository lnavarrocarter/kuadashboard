'use strict';
/**
 * lib/kua/relationshipExplainer.js
 * Why a relationship or suggestion of a KUA Application exists (#172): one
 * sentence per piece of evidence, the confidence split by evidence class, what
 * Observability saw on the pair, and deterministic advice. Pure: the route
 * gathers log signals and local-ML matches and passes them in. No model writes
 * text here; the local model (embeddings) only finds errors that talk about
 * the target. Output is i18n keys and parameters, translated by the UI.
 */

// Evidence class per type, as in the plan's analysis roadmap: declared facts,
// observed traffic, or inferences from names and scope.
const EVIDENCE_CLASS = {
  cloudformation_reference: 'declared', cloudformation_resource: 'declared', template: 'declared',
  lambda_permission: 'declared', lambda_event_source_mapping: 'declared', eventbridge_target: 'declared',
  asl_reference: 'declared', ingress_backend: 'declared', service_selector: 'declared', workload_selector: 'declared',
  pod_node_assignment: 'declared', env_service_dns: 'declared', env_service_name: 'declared',
  env_from_configmap: 'declared', env_from_secret: 'declared', env_configmap_key: 'declared', env_secret_key: 'declared',
  volume_configmap: 'declared', volume_secret: 'declared', volume_persistent_volume_claim: 'declared',
  apm_edge: 'declared', apm_membership: 'declared', gcp_inventory: 'declared', vercel_inventory: 'declared',
  kubernetes_uid: 'declared', cloud_instance: 'declared',
  observed_log_reference: 'observed', log_reference: 'observed',
  shared_name_tokens: 'inferred', same_kubernetes_scope: 'inferred', compatible_resource_types: 'inferred',
};
const KNOWN = new Set(Object.keys(EVIDENCE_CLASS));
const SECRET_EVIDENCE = new Set(['env_from_secret', 'env_secret_key', 'volume_secret']);
const FAILURE_TO_TARGET = new Set(['timeout', 'connection', 'throttling', 'access_denied']);
const CALL_TYPES = new Set(['calls', 'invokes', 'depends_on', 'publishes_to', 'sends_to', 'routes_to', 'reads_from', 'writes_to', 'triggers', 'uses']);

function text(value) { return value == null ? '' : String(value); }

function evidenceType(item) {
  return text(item?.type || item?.kind || item?.evidence) || 'unknown';
}

// Parameters each sentence uses; only plain strings and numbers leave this function.
function evidenceParams(item) {
  const values = Array.isArray(item?.values) ? item.values.map(text) : [];
  switch (evidenceType(item)) {
    case 'cloudformation_reference': return { path: text(item.path), intrinsic: text(item.intrinsic) || 'Ref' };
    case 'observed_log_reference': return { group: values[0], target: values[1], count: Number(values[2]) || 0 };
    case 'asl_reference': return { state: values[0], resource: values[1] };
    case 'shared_name_tokens': return { tokens: values.join(', ') };
    case 'same_kubernetes_scope': return { namespace: values[0] };
    case 'compatible_resource_types': return { from: values[0], to: values[1] };
    case 'ingress_backend': return { services: (item.services || []).map(text).join(', ') };
    case 'service_selector': case 'workload_selector': return { selector: Object.entries(item.selector || {}).map(([key, value]) => `${key}=${value}`).join(', ') };
    case 'lambda_permission': return { source: values[0] || text(item.logicalId) };
    default: return { values: values.join(', '), source: text(item?.sourceId) };
  }
}

function mentionsTarget(signature, target) {
  const haystack = `${text(signature.signature)} ${text(signature.sample)}`.toLowerCase();
  const needles = [target.name, text(target.nativeIdentifier).split(/[:/]/).pop()]
    .map(value => text(value).toLowerCase()).filter(value => value.length >= 4);
  return needles.some(needle => haystack.includes(needle));
}

/**
 * relationship: { relationType, status, confidence, evidence[] }
 * source/target: { id, name, type, nativeIdentifier }
 * signals: { source, target } from lib/logIntelligenceEvidence.js (or null)
 * semantic: { state: 'ready' | 'disabled' | 'unavailable', matches: [{ signature, sample, occurrences, category, score }] }
 * thresholds: the application thresholds (errorRatePercent)
 */
function explainRelationship({ relationship = {}, source = {}, target = {}, signals = null, semantic = { state: 'unavailable', matches: [] }, thresholds = {} } = {}) {
  const evidenceList = Array.isArray(relationship.evidence) ? relationship.evidence : [];
  const evidence = evidenceList.map(item => {
    const type = evidenceType(item);
    return {
      type,
      class: EVIDENCE_CLASS[type] || 'inferred',
      key: KNOWN.has(type) ? `kuapps.explain.evidence.${type}` : 'kuapps.explain.evidence.unknown',
      params: { ...evidenceParams(item), type },
    };
  });
  const byClass = { declared: 0, observed: 0, inferred: 0 };
  evidence.forEach(item => { byClass[item.class] += 1; });

  const sourceSignal = signals?.source || null;
  const targetSignal = signals?.target || null;
  const ruleMentions = (sourceSignal?.recurringErrors || [])
    .filter(signature => mentionsTarget(signature, target))
    .map(signature => ({ signature: signature.signature, occurrences: signature.occurrences || 0, match: 'rule', score: null, category: signature.category || null }));
  const known = new Set(ruleMentions.map(item => item.signature));
  const semanticMentions = (semantic?.matches || [])
    .filter(item => !known.has(item.signature))
    .map(item => ({ signature: item.signature, occurrences: item.occurrences || 0, match: 'semantic', score: Math.round(Number(item.score || 0) * 100) / 100, category: item.category || null }));
  const mentions = [...ruleMentions, ...semanticMentions].slice(0, 6);

  const advice = [];
  const add = (id, severity, params = {}) => advice.push({ id, severity, key: `kuapps.explain.advice.${id}`, params });
  const names = { source: text(source.name) || text(source.id), target: text(target.name) || text(target.id) };
  if (evidence.length && byClass.declared === 0 && byClass.observed === 0) add('inferred_only', 'warning', names);
  if (byClass.observed > 0 && byClass.declared === 0) add('observed_not_declared', 'info', names);
  if (byClass.declared > 0 && byClass.observed > 0) add('declared_and_observed', 'ok', names);
  const targetRate = Number(targetSignal?.last24h?.errorRatePercent);
  const limit = Number(thresholds.errorRatePercent ?? 5);
  if (Number.isFinite(targetRate) && targetRate >= limit && CALL_TYPES.has(text(relationship.relationType))) {
    add('target_errors', 'warning', { ...names, rate: Math.round(targetRate * 10) / 10, threshold: limit });
  }
  const failing = mentions.filter(item => FAILURE_TO_TARGET.has(item.category) || /timeout|timed out|econnrefused|connection|throttl|denied/i.test(item.signature));
  if (failing.length) add('failures_to_target', 'warning', { ...names, count: failing.reduce((sum, item) => sum + item.occurrences, 0) });
  if (evidence.some(item => SECRET_EVIDENCE.has(item.type))) add('secret_dependency', 'info', names);
  if (text(relationship.status) === 'rejected') add('rejected', 'info', names);

  const limits = [];
  if (!sourceSignal && !targetSignal) limits.push('no_signals');
  if (semantic?.state === 'disabled') limits.push('semantic_disabled');
  // Without cached logs of the caller there is nothing to search: no_signals already says so.
  if (semantic?.state === 'unavailable' && sourceSignal) limits.push('semantic_unavailable');

  const freshness = [sourceSignal?.lastSyncAt, targetSignal?.lastSyncAt].filter(Boolean);
  return {
    relationship: { relationType: text(relationship.relationType) || 'depends_on', status: text(relationship.status) || 'suggested', confidence: Number(relationship.confidence) || null },
    source: { id: text(source.id), name: names.source, type: text(source.type) },
    target: { id: text(target.id), name: names.target, type: text(target.type) },
    summary: { key: `kuapps.explain.summary.${byClass.declared ? 'declared' : byClass.observed ? 'observed' : 'inferred'}`, params: { ...names, relationType: text(relationship.relationType) || 'depends_on' } },
    evidence,
    confidence: { value: Number(relationship.confidence) || null, byClass },
    signals: {
      target: targetSignal ? { errorRatePercent: Number.isFinite(targetRate) ? targetRate : null, errors: targetSignal.last24h?.errors ?? null, events: targetSignal.last24h?.events ?? null, logGroup: text(targetSignal.logGroup) } : null,
      source: sourceSignal ? { errorRatePercent: sourceSignal.last24h?.errorRatePercent ?? null, logGroup: text(sourceSignal.logGroup) } : null,
      mentions,
      semantic: semantic?.state || 'unavailable',
      syncedAt: freshness.length ? Math.min(...freshness) : null,
    },
    advice,
    decision: { accept: 'kuapps.explain.decision.accept', reject: 'kuapps.explain.decision.reject' },
    limits,
  };
}

module.exports = { explainRelationship, EVIDENCE_CLASS };
