'use strict';
/**
 * lib/usage/ledger.js
 * Local record of the billed (or free-tier) cloud operations KUA itself made,
 * with the numbers behind each estimate: quantity × unit price = USD. It is
 * KUA's own spend, not the account bill (see lib/usage/awsPricing.js).
 * Kept 400 days in <KUA data dir>/usage.sqlite3.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS usage_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL, provider TEXT NOT NULL, profile_id TEXT, region TEXT,
    service TEXT NOT NULL, operation TEXT NOT NULL, kind TEXT NOT NULL,
    quantity REAL NOT NULL, unit TEXT NOT NULL, unit_price REAL NOT NULL,
    usd REAL NOT NULL, potential_usd REAL NOT NULL DEFAULT 0, free_tier TEXT,
    bytes INTEGER, ref TEXT, feature TEXT
  );
  CREATE INDEX IF NOT EXISTS usage_events_at ON usage_events (at);
  -- A query (Logs Insights, Athena) is priced once even if its results are read again.
  CREATE UNIQUE INDEX IF NOT EXISTS usage_events_query ON usage_events (kind, ref) WHERE kind IN ('logsInsights', 'athena');
`;

function resolveDataDir() {
  return process.env.KUA_DATA_DIR || path.join(os.homedir(), '.kuadashboard');
}

function createUsageLedger({ dataDir = resolveDataDir(), Database = require('better-sqlite3'), now = () => Date.now() } = {}) {
  let db = null;
  function open() {
    if (db) return db;
    if (dataDir !== ':memory:') fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'usage.sqlite3'));
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    return db;
  }

  /** Records one priced call ({ provider, profileId, region, feature, ...awsPricing entry }). */
  function record(event) {
    open().prepare(`
      INSERT OR IGNORE INTO usage_events (at, provider, profile_id, region, service, operation, kind, quantity, unit, unit_price, usd, potential_usd, free_tier, bytes, ref, feature)
      VALUES (@at, @provider, @profileId, @region, @service, @operation, @kind, @quantity, @unit, @unitPrice, @usd, @potentialUsd, @freeTier, @bytes, @ref, @feature)
    `).run({
      at: event.at ?? now(), provider: event.provider || 'aws', profileId: event.profileId ?? null, region: event.region ?? null,
      service: event.service, operation: event.operation, kind: event.kind, quantity: event.quantity, unit: event.unit, unitPrice: event.unitPrice,
      usd: event.usd || 0, potentialUsd: event.potentialUsd || 0, freeTier: event.freeTier ?? null, bytes: event.bytes ?? null, ref: event.ref ?? null, feature: event.feature ?? null,
    });
  }

  /**
   * Spend summary: totals for today, this month and the window, by operation
   * (with the summed quantity, so the calculation can be shown), by day and
   * by feature, plus the latest operations.
   */
  function summary({ days = 30, profileId = null, service = null, recent = 50 } = {}) {
    const handle = open();
    const current = now();
    const from = current - days * DAY_MS;
    const today = new Date(current); today.setHours(0, 0, 0, 0);
    const month = new Date(current); month.setDate(1); month.setHours(0, 0, 0, 0);
    const filter = 'AND (@profileId IS NULL OR profile_id = @profileId) AND (@service IS NULL OR service = @service)';
    const params = { profileId, service };
    const total = since => handle.prepare(`SELECT COALESCE(SUM(usd), 0) AS usd, COALESCE(SUM(potential_usd), 0) AS potentialUsd, COUNT(*) AS calls FROM usage_events WHERE at >= @since ${filter}`).get({ ...params, since });
    return {
      from, to: current, days,
      totals: { today: total(today.getTime()), month: total(month.getTime()), window: total(from) },
      byOperation: handle.prepare(`
        SELECT service, operation, kind, unit, unit_price AS unitPrice, free_tier AS freeTier, COUNT(*) AS calls,
          SUM(quantity) AS quantity, SUM(usd) AS usd, SUM(potential_usd) AS potentialUsd, SUM(bytes) AS bytes
        FROM usage_events WHERE at >= @from ${filter} GROUP BY service, operation, kind, unit, unit_price ORDER BY (SUM(usd) + SUM(potential_usd)) DESC
      `).all({ ...params, from }),
      byFeature: handle.prepare(`
        SELECT COALESCE(feature, 'other') AS feature, COUNT(*) AS calls, SUM(usd) AS usd, SUM(potential_usd) AS potentialUsd
        FROM usage_events WHERE at >= @from ${filter} GROUP BY COALESCE(feature, 'other') ORDER BY SUM(usd) DESC
      `).all({ ...params, from }),
      byDay: handle.prepare(`
        SELECT (at / ${DAY_MS}) * ${DAY_MS} AS day, SUM(usd) AS usd, SUM(potential_usd) AS potentialUsd, COUNT(*) AS calls
        FROM usage_events WHERE at >= @from ${filter} GROUP BY at / ${DAY_MS} ORDER BY day
      `).all({ ...params, from }),
      recent: handle.prepare(`
        SELECT at, profile_id AS profileId, region, service, operation, kind, quantity, unit, unit_price AS unitPrice, usd,
          potential_usd AS potentialUsd, free_tier AS freeTier, bytes, ref, feature
        FROM usage_events WHERE at >= @from ${filter} ORDER BY at DESC LIMIT @recent
      `).all({ ...params, from, recent }),
    };
  }

  function prune() {
    open().prepare('DELETE FROM usage_events WHERE at < ?').run(now() - RETENTION_MS);
  }

  function close() { if (db) { db.close(); db = null; } }

  return { record, summary, prune, close };
}

let shared = null;
function getUsageLedger() {
  if (!shared) shared = createUsageLedger();
  return shared;
}

module.exports = { createUsageLedger, getUsageLedger };
