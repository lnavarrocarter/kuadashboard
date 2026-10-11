'use strict';
/**
 * lib/apm/resourcePresence.js
 * Whether a collected resource still exists (#236). Kept in the collection cursor table under its
 * own source, so it needs no schema change:
 *
 *   goneSince  when the collector first found it missing (a 404 of its own object), until it is
 *              seen again
 *   labels     the labels of its own object the last time it was seen (they identify a successor
 *              after a release renames it)
 *   repository the GitHub repository the workload declares (#238): annotation or label
 *   ignored    the user decided not to be reminded of it in Review
 */

const SOURCE = 'presence';
// Labels that name a workload across releases; nothing else is kept.
const IDENTITY_LABELS = ['app.kubernetes.io/name', 'app.kubernetes.io/instance', 'app', 'k8s-app'];

function readPresence(database, resourceId) {
  const state = database.getCursor(resourceId, SOURCE)?.state || {};
  return { goneSince: state.goneSince || null, labels: state.labels || null, seenAt: state.seenAt || null, repository: state.repository || null, repositorySource: state.repositorySource || null, ignored: state.ignored === true };
}

function write(database, resourceId, state, now) {
  database.setCursor(resourceId, SOURCE, { timestamp: now, state });
}

function identityLabels(labels) {
  if (!labels || typeof labels !== 'object') return null;
  const kept = Object.fromEntries(IDENTITY_LABELS.filter(key => labels[key]).map(key => [key, String(labels[key])]));
  return Object.keys(kept).length ? kept : null;
}

const REPOSITORY_KEY = 'kua.io/github-repository';
const GITHUB_REPOSITORY = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

/**
 * The GitHub repository a workload declares, so it can be associated without typing it (#238):
 * the annotation `kua.io/github-repository` (owner/name or URL), the OCI annotation
 * `org.opencontainers.image.source`, or the label `kua.io/github-repository` (label values have no
 * "/", so it is `owner.name` or `owner_name`; an owner has no "." or "_", so the split is exact).
 */
function githubRepositoryOf(metadata) {
  const clean = value => {
    const text = String(value || '').trim().replace(/^git@github\.com:/i, '').replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const match = GITHUB_REPOSITORY.exec(text.split('/').slice(0, 2).join('/'));
    return match ? `${match[1]}/${match[2]}` : null;
  };
  const annotations = metadata?.annotations || {};
  const label = metadata?.labels?.[REPOSITORY_KEY];
  const fromLabel = typeof label === 'string' ? clean(label.replace(/^([A-Za-z0-9-]+)[._]/, '$1/')) : null;
  const found = [
    [clean(annotations[REPOSITORY_KEY]), 'annotation'],
    [fromLabel, 'label'],
    [/^https:\/\/github\.com\//i.test(String(annotations['org.opencontainers.image.source'] || '')) ? clean(annotations['org.opencontainers.image.source']) : null, 'image'],
  ].find(([repository]) => repository);
  return found ? { repository: found[0], source: found[1] } : null;
}

/** Seen: clears goneSince and the ignore decision, and keeps its identity labels and repository. */
function markPresent(database, resourceId, { labels = null, repository = null, now = Date.now() } = {}) {
  const current = readPresence(database, resourceId);
  write(database, resourceId, {
    labels: identityLabels(labels) || current.labels,
    ...(repository ? { repository: repository.repository, repositorySource: repository.source } : current.repository ? { repository: current.repository, repositorySource: current.repositorySource } : {}),
    seenAt: new Date(now).toISOString(),
  }, now);
}

/** Missing: keeps the first time it was found missing. */
function markGone(database, resourceId, { now = Date.now() } = {}) {
  const current = readPresence(database, resourceId);
  if (current.goneSince) return current;
  write(database, resourceId, { ...current, goneSince: new Date(now).toISOString() }, now);
  return readPresence(database, resourceId);
}

// The outcome of the last collection of one resource (#239): which resource failed, why and when,
// so "one or more resources could not be collected" can name them. Its own cursor source.
const COLLECTION_SOURCE = 'collection';

function recordCollection(database, resourceId, { status, errorCode = null, message = null, now = Date.now() }) {
  database.setCursor(resourceId, COLLECTION_SOURCE, {
    timestamp: now,
    state: { status, errorCode, message: message ? String(message).slice(0, 300) : null, at: new Date(now).toISOString() },
  });
}

function readCollection(database, resourceId) {
  const state = database.getCursor(resourceId, COLLECTION_SOURCE)?.state;
  return state?.status ? state : null;
}

function ignoreGone(database, resourceId, { now = Date.now() } = {}) {
  write(database, resourceId, { ...readPresence(database, resourceId), ignored: true }, now);
}

module.exports = { COLLECTION_SOURCE, githubRepositoryOf, IDENTITY_LABELS, SOURCE, identityLabels, ignoreGone, markGone, markPresent, readCollection, readPresence, recordCollection };
