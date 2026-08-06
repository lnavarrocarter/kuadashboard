'use strict';

const AWS_APPLICATION_KEYS = ['application', 'app', 'app-id'];
const KUBERNETES_APPLICATION_KEYS = [
  'app.kubernetes.io/name',
  'app.kubernetes.io/instance',
  'app',
  'service',
];

function normalizeMetadata(metadata = {}) {
  const entries = Array.isArray(metadata)
    ? metadata.map(item => [item.Key ?? item.key, item.Value ?? item.value])
    : Object.entries(metadata || {});
  const normalized = new Map();
  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey || '').trim().toLowerCase();
    const value = String(rawValue ?? '').trim();
    if (!key || !value) continue;
    const values = normalized.get(key) || [];
    if (!values.includes(value)) values.push(value);
    normalized.set(key, values);
  }
  return normalized;
}

function firstValue(metadata, keys) {
  for (const key of keys) {
    const value = metadata.get(key)?.[0];
    if (value) return value;
  }
  return '';
}

function distinctValues(metadata, keys) {
  return [...new Set(keys.flatMap(key => metadata.get(key) || []))];
}

function identityFromMetadata(metadata, applicationKeys, source) {
  const normalized = normalizeMetadata(metadata);
  const candidates = distinctValues(normalized, applicationKeys);
  return {
    application: firstValue(normalized, applicationKeys),
    service: firstValue(normalized, ['service']),
    environment: firstValue(normalized, ['environment', 'env']),
    team: firstValue(normalized, ['team']),
    source,
    status: candidates.length > 1 ? 'pending' : candidates.length ? 'matched' : 'unmatched',
    candidates,
  };
}

function applicationIdentityFromAwsTags(tags) {
  return identityFromMetadata(tags, AWS_APPLICATION_KEYS, 'tags');
}

function applicationIdentityFromKubeLabels(labels) {
  return identityFromMetadata(labels, KUBERNETES_APPLICATION_KEYS, 'labels');
}

function correlateResource({ manualApplication, tags, labels } = {}) {
  const manual = String(manualApplication || '').trim();
  if (manual) {
    return {
      application: manual,
      service: '',
      environment: '',
      team: '',
      source: 'manual',
      status: 'matched',
      candidates: [manual],
    };
  }
  if (tags) return applicationIdentityFromAwsTags(tags);
  if (labels) return applicationIdentityFromKubeLabels(labels);
  return identityFromMetadata({}, [], 'none');
}

function normalizedNameTokens(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 1))];
}

function nameSimilarity(left, right) {
  const leftTokens = new Set(normalizedNameTokens(left));
  const rightTokens = new Set(normalizedNameTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function suggestNameCandidates(resourceName, applications, minimumScore = 0.5) {
  return applications
    .map(application => ({ application, score: nameSimilarity(resourceName, application.name || application) }))
    .filter(item => item.score >= minimumScore)
    .sort((left, right) => right.score - left.score);
}

function publicApplication(application) {
  return {
    id: application.id || null,
    name: String(application.name || ''),
    environment: String(application.environment || ''),
    team: String(application.team || ''),
  };
}

function discoverResourceCandidate(resource, applications, minimumScore = 0.5) {
  const identity = correlateResource({ tags: resource.tags, labels: resource.labels });
  const identityCandidates = new Set(identity.candidates.map(value => value.trim().toLowerCase()));
  const metadataMatches = applications.filter(application =>
    identityCandidates.has(String(application.id || '').toLowerCase()) ||
    identityCandidates.has(String(application.name || '').trim().toLowerCase()));
  const nameMatches = identity.candidates.length
    ? []
    : suggestNameCandidates(resource.name, applications, minimumScore).map(item => ({
      application: item.application,
      score: item.score,
      source: 'name',
    }));
  const suggestions = [
    ...metadataMatches.map(application => ({ application, score: 1, source: identity.source })),
    ...nameMatches,
  ].map(item => ({ ...item, application: publicApplication(item.application) }));
  const status = identity.status === 'pending' || metadataMatches.length > 1
    ? 'pending'
    : metadataMatches.length === 1
      ? 'matched'
      : suggestions.length
        ? 'suggested'
        : 'unmatched';

  return {
    key: String(resource.key || resource.arn || resource.name || ''),
    type: String(resource.type || ''),
    name: String(resource.name || ''),
    status,
    identity: {
      application: identity.application,
      service: identity.service,
      environment: identity.environment,
      team: identity.team,
      source: identity.source,
      candidates: identity.candidates,
    },
    suggestions,
  };
}

function discoverResourceCandidates(resources = [], applications = [], minimumScore = 0.5) {
  return resources.map(resource => discoverResourceCandidate(resource, applications, minimumScore));
}

module.exports = {
  applicationIdentityFromAwsTags,
  applicationIdentityFromKubeLabels,
  correlateResource,
  discoverResourceCandidate,
  discoverResourceCandidates,
  nameSimilarity,
  normalizeMetadata,
  normalizedNameTokens,
  suggestNameCandidates,
};