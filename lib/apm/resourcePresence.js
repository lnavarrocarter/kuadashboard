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
 *   ignored    the user decided not to be reminded of it in Review
 */

const SOURCE = 'presence';
// Labels that name a workload across releases; nothing else is kept.
const IDENTITY_LABELS = ['app.kubernetes.io/name', 'app.kubernetes.io/instance', 'app', 'k8s-app'];

function readPresence(database, resourceId) {
  const state = database.getCursor(resourceId, SOURCE)?.state || {};
  return { goneSince: state.goneSince || null, labels: state.labels || null, seenAt: state.seenAt || null, ignored: state.ignored === true };
}

function write(database, resourceId, state, now) {
  database.setCursor(resourceId, SOURCE, { timestamp: now, state });
}

function identityLabels(labels) {
  if (!labels || typeof labels !== 'object') return null;
  const kept = Object.fromEntries(IDENTITY_LABELS.filter(key => labels[key]).map(key => [key, String(labels[key])]));
  return Object.keys(kept).length ? kept : null;
}

/** Seen: clears goneSince and the ignore decision, and keeps its identity labels. */
function markPresent(database, resourceId, { labels = null, now = Date.now() } = {}) {
  const current = readPresence(database, resourceId);
  write(database, resourceId, { labels: identityLabels(labels) || current.labels, seenAt: new Date(now).toISOString() }, now);
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

module.exports = { COLLECTION_SOURCE, IDENTITY_LABELS, SOURCE, identityLabels, ignoreGone, markGone, markPresent, readCollection, readPresence, recordCollection };
