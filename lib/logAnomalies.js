'use strict';
/**
 * lib/logAnomalies.js
 * Deterministic anomaly detection on the log intelligence aggregates of a
 * cached group (30-minute buckets and recurring signatures). No model and no
 * cloud call: simple statistics that can be explained next to each result.
 *
 *   error_spike      errors of the last hour against the 7-day baseline
 *                    (Poisson: ≥ 10 errors, ≥ 3× expected and z ≥ 4). When the
 *                    error rate did not rise, the spike follows traffic.
 *   volume_drop      far fewer events than at the same time of day on previous
 *                    days (quiet nights are not flagged).
 *   category_surge   a failure or client category at ≥ 3× its usual rate over
 *                    the last 24 h.
 *   new_errors       recurring errors or warnings first seen in the last 24 h,
 *                    in a group with at least a day of history before them.
 *
 * Only synced time is evaluated: a bucket counts as known when it has data or
 * lies inside the synced, fully backfilled cache range. "Now" is the end of
 * the synced range, and a stale cache is reported instead of guessed.
 */

const BUCKET_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECENT_MS = HOUR_MS;
const STALE_MS = 6 * HOUR_MS;
const MIN_BASELINE_BUCKETS = 12;
const MIN_SEASONAL_DAYS = 3;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const SURGE_GROUPS = { failure: 'medium', client: 'low' };

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Bucket grid over the last 7 days up to the horizon: each start maps to its
 * counts, to zeros when the range is known to be empty, or to null (unknown).
 */
function knownBuckets(rows, { horizon, coverageFrom, backfillPending }) {
  const byStart = new Map(rows.map(row => [row.start, row]));
  const zeroKnownFrom = !backfillPending && coverageFrom != null ? coverageFrom : Infinity;
  const first = Math.floor((horizon - 7 * DAY_MS) / BUCKET_MS) * BUCKET_MS;
  const grid = [];
  for (let start = first; start < horizon; start += BUCKET_MS) {
    const row = byStart.get(start);
    if (row) grid.push({ start, events: row.events || 0, errors: row.errors || 0, warnings: row.warnings || 0, categories: row.categories || {} });
    else if (start >= zeroKnownFrom) grid.push({ start, events: 0, errors: 0, warnings: 0, categories: {} });
    else grid.push(null);
  }
  return grid;
}

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
/** Milliseconds of a bucket that fall before the horizon (the newest one is partial). */
const covered = (bucket, horizon) => Math.min(BUCKET_MS, horizon - bucket.start);

function poissonZ(observed, expected) {
  return (observed - expected) / Math.sqrt(Math.max(expected, 1));
}

function errorSpike(recent, baseline, horizon) {
  const window = sum(recent, bucket => covered(bucket, horizon)) / BUCKET_MS;
  const observed = sum(recent, bucket => bucket.errors);
  const expected = (sum(baseline, bucket => bucket.errors) / baseline.length) * window;
  const z = poissonZ(observed, expected);
  if (observed < 10 || observed < 3 * Math.max(expected, 1) || z < 4) return null;
  const recentEvents = sum(recent, bucket => bucket.events);
  const baselineEvents = sum(baseline, bucket => bucket.events);
  const recentRate = recentEvents ? observed / recentEvents : 0;
  const baselineRate = baselineEvents ? sum(baseline, bucket => bucket.errors) / baselineEvents : 0;
  const trafficDriven = baselineRate > 0 && recentRate <= baselineRate * 1.5;
  const ratio = expected > 0 ? observed / expected : null;
  return {
    id: trafficDriven ? 'error_spike_traffic' : 'error_spike',
    severity: trafficDriven ? 'low' : (ratio == null || ratio >= 10 || observed >= 100 ? 'high' : 'medium'),
    params: {
      count: observed,
      expected: round(expected),
      ratio: ratio == null ? '∞' : round(ratio),
      rate: round(recentRate * 100),
      baselineRate: round(baselineRate * 100),
    },
    evidence: { from: recent[0].start, to: horizon, observed, expected: round(expected, 2), z: round(z) },
  };
}

function volumeDrop(recent, grid, recentFirst, horizon) {
  let expected = 0;
  const days = new Set();
  // Same time of day (± one bucket) on previous days.
  const sameTimeOfDay = diff => [0, BUCKET_MS, DAY_MS - BUCKET_MS].includes(diff % DAY_MS) && diff >= DAY_MS - BUCKET_MS;
  for (const bucket of recent) {
    const peers = grid.filter(other => other && other.start < recentFirst && sameTimeOfDay(bucket.start - other.start));
    peers.forEach(peer => days.add(Math.round((bucket.start - peer.start) / DAY_MS)));
    if (!peers.length) return null;
    expected += (sum(peers, peer => peer.events) / peers.length) * (covered(bucket, horizon) / BUCKET_MS);
  }
  const observed = sum(recent, bucket => bucket.events);
  if (days.size < MIN_SEASONAL_DAYS || expected < 40 || observed > expected * 0.1) return null;
  return {
    id: 'volume_drop',
    severity: observed === 0 ? 'high' : 'medium',
    params: { count: observed, expected: Math.round(expected), percent: Math.round((observed / expected) * 100), days: days.size },
    evidence: { from: recent[0].start, to: horizon, observed, expected: round(expected, 2) },
  };
}

function categorySurges(grid, horizon, groups) {
  const dayStart = horizon - DAY_MS;
  const recent = grid.filter(bucket => bucket && bucket.start >= dayStart);
  const prior = grid.filter(bucket => bucket && bucket.start < dayStart);
  if (prior.length < 2 * MIN_BASELINE_BUCKETS || !recent.length) return [];
  const recentMs = sum(recent, bucket => covered(bucket, horizon));
  const priorMs = prior.length * BUCKET_MS;
  const surges = [];
  for (const [category, group] of Object.entries(groups)) {
    const severity = SURGE_GROUPS[group];
    if (!severity) continue;
    const count = sum(recent, bucket => bucket.categories[category] || 0);
    if (count < 10) continue;
    const priorCount = sum(prior, bucket => bucket.categories[category] || 0);
    const perDayRecent = (count / recentMs) * DAY_MS;
    const perDayPrior = (priorCount / priorMs) * DAY_MS;
    const ratio = perDayPrior > 0 ? perDayRecent / perDayPrior : null;
    if (ratio != null && ratio < 3) continue;
    surges.push({
      id: ratio == null ? 'category_new' : 'category_surge',
      category,
      severity: group === 'failure' && (ratio == null || ratio >= 10) && count >= 100 ? 'high' : severity,
      params: { count, category, perDay: round(perDayPrior), ratio: ratio == null ? '∞' : round(ratio) },
      evidence: { from: Math.max(dayStart, recent[0].start), to: horizon, observed: count, expectedPerDay: round(perDayPrior, 2) },
    });
  }
  return surges;
}

function newErrors(signatures, grid, horizon) {
  const firstKnown = grid.find(Boolean)?.start;
  if (firstKnown == null) return null;
  const fresh = (signatures || [])
    .filter(s => s.firstSeen >= horizon - DAY_MS && s.firstSeen - firstKnown >= DAY_MS)
    .filter(s => s.occurrences >= (s.level === 'error' ? 2 : 5))
    .sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1) || b.occurrences - a.occurrences);
  if (!fresh.length) return null;
  return {
    id: 'new_errors',
    severity: fresh.some(s => s.level === 'error') ? 'medium' : 'low',
    params: { count: fresh.length },
    evidence: {
      from: Math.min(...fresh.map(s => s.firstSeen)),
      to: horizon,
      signatures: fresh.slice(0, 5).map(s => ({ signature: s.signature, occurrences: s.occurrences, sample: s.sample, category: s.category, level: s.level, firstSeen: s.firstSeen })),
    },
  };
}

/**
 * @param input.buckets        [{ start, events, errors, warnings, categories }] of the last 7+ days
 * @param input.signatures     [{ signature, level, category, sample, occurrences, firstSeen }] seen recently
 * @param input.syncedUntil    end of the synced cache range (null: never synced)
 * @param input.coverageFrom   oldest cached event time
 * @param input.backfillPending whether older hours are still being filled
 * @param input.groups         { category: group } from shared/logSignals.mjs
 * @returns { status, evaluatedAt, anomalies }
 */
function detectAnomalies({ buckets = [], signatures = [], syncedUntil = null, coverageFrom = null, backfillPending = false, groups = {}, now = Date.now() } = {}) {
  if (syncedUntil == null) return { status: 'not_synced', evaluatedAt: null, anomalies: [] };
  const horizon = Math.min(now, syncedUntil);
  const grid = knownBuckets(buckets, { horizon, coverageFrom, backfillPending });
  const anomalies = [];

  const fresh = now - horizon <= STALE_MS;
  const recentFirst = Math.floor((horizon - RECENT_MS) / BUCKET_MS) * BUCKET_MS;
  const recent = grid.filter(bucket => bucket && bucket.start >= recentFirst);
  const baseline = grid.filter(bucket => bucket && bucket.start < recentFirst);
  let status = 'ok';
  if (!fresh) status = 'stale';
  else if (baseline.length < MIN_BASELINE_BUCKETS || recent.length < Math.ceil((horizon - recentFirst) / BUCKET_MS)) status = 'insufficient_history';
  else {
    const spike = errorSpike(recent, baseline, horizon);
    if (spike) anomalies.push(spike);
    const drop = volumeDrop(recent, grid, recentFirst, horizon);
    if (drop) anomalies.push(drop);
  }
  // Day-scale signals stay meaningful on a cache synced a few hours ago.
  anomalies.push(...categorySurges(grid, horizon, groups));
  const novel = newErrors(signatures, grid, horizon);
  if (novel) anomalies.push(novel);

  anomalies.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.params.count || 0) - (a.params.count || 0));
  return { status, evaluatedAt: horizon, anomalies };
}

module.exports = { detectAnomalies, BUCKET_MS };
