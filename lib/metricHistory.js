'use strict';

// Metric history for the cloud views, stored in the local APM SQLite database
// (migration v16 in lib/apm/database.js). CloudWatch GetMetricData bills per
// metric requested, whatever the time range, so history saves money only by
// skipping calls: a series whose window is covered and was read recently is
// served from here, and only stale or missing metrics are requested.
//
// Resources use the KUA registry identities (AWS::SQS::Queue:orders), so a
// KUA Application can later read the same history for its resources.

const HOUR_MS = 3600 * 1000;
// CloudWatch keeps adding late data points to the most recent hours.
const SETTLE_MS = 2 * HOUR_MS;
const DEFAULT_RETENTION_DAYS = 30;
const PRUNE_EVERY_MS = HOUR_MS;

class MetricHistory {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db, { now = () => Date.now(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
    this.db = db;
    this.now = now;
    this.retentionDays = retentionDays;
    this.lastPrune = 0;
    this.st = {
      coverage: db.prepare(`SELECT * FROM kua_metric_coverage
        WHERE provider = @provider AND profile_id = @profileId AND region = @region
          AND resource_id = @resourceId AND metric = @metric AND period_s = @periodS`),
      upsertCoverage: db.prepare(`INSERT INTO kua_metric_coverage
        (provider, profile_id, region, resource_id, metric, period_s, covered_from, covered_to, fetched_at)
        VALUES (@provider, @profileId, @region, @resourceId, @metric, @periodS, @from, @to, @fetchedAt)
        ON CONFLICT (provider, profile_id, region, resource_id, metric, period_s) DO UPDATE SET
          covered_from = excluded.covered_from, covered_to = excluded.covered_to, fetched_at = excluded.fetched_at`),
      deleteWindow: db.prepare(`DELETE FROM kua_metric_points
        WHERE provider = @provider AND profile_id = @profileId AND region = @region AND resource_id = @resourceId
          AND metric = @metric AND period_s = @periodS AND bucket_start >= @from AND bucket_start < @to`),
      insertPoint: db.prepare(`INSERT OR REPLACE INTO kua_metric_points
        (provider, profile_id, region, resource_id, metric, period_s, bucket_start, value)
        VALUES (@provider, @profileId, @region, @resourceId, @metric, @periodS, @t, @v)`),
      points: db.prepare(`SELECT bucket_start AS t, value AS v FROM kua_metric_points
        WHERE provider = @provider AND profile_id = @profileId AND region = @region AND resource_id = @resourceId
          AND metric = @metric AND period_s = @periodS AND bucket_start >= @from AND bucket_start < @to
        ORDER BY bucket_start`),
      prunePoints: db.prepare('DELETE FROM kua_metric_points WHERE bucket_start < ?'),
      pruneCoverage: db.prepare('DELETE FROM kua_metric_coverage WHERE covered_to < ?'),
      clipCoverage: db.prepare('UPDATE kua_metric_coverage SET covered_from = ? WHERE covered_from < ?'),
    };
  }

  static key({ provider = 'aws', profileId, region = '', resourceId, metric, periodS = 3600 }) {
    return { provider, profileId, region: region || '', resourceId, metric, periodS };
  }

  /**
   * Splits the metrics of a series request into fresh (served from history)
   * and stale ones, and the window the stale ones need: from the settled end
   * of what is already covered, or the whole window when nothing usable is.
   */
  plan({ series, from, to, ttlMs }) {
    const now = this.now();
    const fresh = [];
    const stale = [];
    let fetchFrom = to;
    for (const item of series) {
      const row = this.st.coverage.get(MetricHistory.key(item));
      const covers = row && row.covered_from <= from && row.covered_to >= Math.min(to, now);
      if (covers && now - row.fetched_at < ttlMs) {
        fresh.push(item);
        continue;
      }
      stale.push(item);
      // Continue from what is covered when the older part of the window is already stored.
      const resumeFrom = row && row.covered_from <= from && row.covered_to > from ? Math.max(from, row.covered_to - SETTLE_MS) : from;
      fetchFrom = Math.min(fetchFrom, resumeFrom);
    }
    return { fresh, stale, fetchFrom: stale.length ? fetchFrom : null };
  }

  /** Stores the points read for [from, to) and extends the series' coverage. */
  write(item, { from, to, points = [] }) {
    const key = MetricHistory.key(item);
    const fetchedAt = this.now();
    this.db.transaction(() => {
      this.st.deleteWindow.run({ ...key, from, to });
      for (const point of points) {
        if (point.t >= from && point.t < to && Number.isFinite(point.v)) this.st.insertPoint.run({ ...key, t: point.t, v: point.v });
      }
      const row = this.st.coverage.get(key);
      // Contiguous or overlapping windows merge; a gap keeps only the newest window.
      const merged = row && row.covered_to >= from && row.covered_from <= to
        ? { from: Math.min(row.covered_from, from), to: Math.max(row.covered_to, to) }
        : { from, to };
      this.st.upsertCoverage.run({ ...key, ...merged, fetchedAt });
    })();
    this.maybePrune();
  }

  read(item, { from, to }) {
    return this.st.points.all({ ...MetricHistory.key(item), from, to });
  }

  coverage(item) {
    const row = this.st.coverage.get(MetricHistory.key(item));
    return row ? { from: row.covered_from, to: row.covered_to, fetchedAt: row.fetched_at } : null;
  }

  setRetentionDays(days) {
    const n = Number(days);
    if (!(n >= 1 && n <= 400)) throw Object.assign(new Error('retentionDays must be 1–400'), { code: 400 });
    this.retentionDays = n;
    this.lastPrune = 0;
    this.maybePrune();
  }

  maybePrune() {
    const now = this.now();
    if (now - this.lastPrune < PRUNE_EVERY_MS) return;
    this.lastPrune = now;
    const cutoff = now - this.retentionDays * 24 * HOUR_MS;
    this.db.transaction(() => {
      this.st.prunePoints.run(cutoff);
      this.st.pruneCoverage.run(cutoff);
      this.st.clipCoverage.run(cutoff, cutoff);
    })();
  }
}

let _instance = null;
/** Shared instance on the app's APM database. */
function getMetricHistory() {
  if (!_instance) {
    const { getApmDatabase } = require('./apm/database');
    _instance = new MetricHistory(getApmDatabase().db);
  }
  return _instance;
}

module.exports = { MetricHistory, getMetricHistory, HOUR_MS, SETTLE_MS, DEFAULT_RETENTION_DAYS };
