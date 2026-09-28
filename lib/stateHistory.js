'use strict';

// Resource state history for cloud observability, stored in the local APM
// SQLite database (tables from migration v15 in lib/apm/database.js).
//
//   - recordStates(): called with a list of observed resources (when a list is
//     loaded in the UI or by the background poller). Writes an event only when
//     a resource's state differs from the last one recorded; with
//     `complete: true`, resources that vanished are recorded as MISSING.
//   - recordAction(): user actions (start, stop, create, delete, labels…).
//   - poll settings: per provider+profile, disabled by default.

const RESOURCE_TYPES = new Set(['gcp-vm', 'gcp-cloud-run', 'gcp-sql']);
const SOURCES = new Set(['observed', 'poll', 'user']);
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;
const DEFAULT_POLL_SETTINGS = Object.freeze({
  enabled: false,
  intervalMinutes: 15,
  resourceTypes: ['gcp-vm', 'gcp-cloud-run', 'gcp-sql'],
  retentionDays: 90,
});

function badRequest(message) {
  return Object.assign(new Error(message), { code: 400 });
}

function assertType(resourceType) {
  if (!RESOURCE_TYPES.has(resourceType)) throw badRequest(`Unsupported resource type: ${resourceType}`);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

class StateHistory {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    this.st = {
      last: db.prepare(`SELECT * FROM kua_resource_last_state
        WHERE provider = ? AND profile_id = ? AND resource_type = ? AND resource_key = ?`),
      lastForType: db.prepare(`SELECT * FROM kua_resource_last_state
        WHERE provider = ? AND profile_id = ? AND resource_type = ?`),
      upsertLast: db.prepare(`INSERT INTO kua_resource_last_state
        (provider, profile_id, resource_type, resource_key, resource_name, state, observed_at)
        VALUES (@provider, @profileId, @resourceType, @resourceKey, @resourceName, @state, @observedAt)
        ON CONFLICT (provider, profile_id, resource_type, resource_key)
        DO UPDATE SET state = excluded.state, resource_name = excluded.resource_name, observed_at = excluded.observed_at`),
      deleteLast: db.prepare(`DELETE FROM kua_resource_last_state
        WHERE provider = ? AND profile_id = ? AND resource_type = ? AND resource_key = ?`),
      insertEvent: db.prepare(`INSERT INTO kua_resource_state_events
        (provider, profile_id, project, resource_type, resource_key, resource_name, kind, source,
         state, previous_state, action, details_json, observed_at)
        VALUES (@provider, @profileId, @project, @resourceType, @resourceKey, @resourceName, @kind, @source,
         @state, @previousState, @action, @details, @observedAt)`),
      events: db.prepare(`SELECT * FROM kua_resource_state_events
        WHERE provider = @provider AND profile_id = @profileId AND resource_type = @resourceType
          AND resource_key = @resourceKey AND (@before IS NULL OR id < @before)
        ORDER BY id DESC LIMIT @limit`),
      getSettings: db.prepare('SELECT * FROM kua_state_poll_settings WHERE provider = ? AND profile_id = ?'),
      enabledSettings: db.prepare('SELECT * FROM kua_state_poll_settings WHERE provider = ? AND enabled = 1'),
      upsertSettings: db.prepare(`INSERT INTO kua_state_poll_settings
        (provider, profile_id, enabled, interval_minutes, resource_types_json, retention_days, updated_at)
        VALUES (@provider, @profileId, @enabled, @intervalMinutes, @resourceTypes, @retentionDays, @updatedAt)
        ON CONFLICT (provider, profile_id) DO UPDATE SET
          enabled = excluded.enabled, interval_minutes = excluded.interval_minutes,
          resource_types_json = excluded.resource_types_json, retention_days = excluded.retention_days,
          updated_at = excluded.updated_at`),
      markRun: db.prepare(`UPDATE kua_state_poll_settings SET last_run_at = ?, last_error = ?
        WHERE provider = ? AND profile_id = ?`),
      cleanup: db.prepare(`DELETE FROM kua_resource_state_events
        WHERE provider = ? AND profile_id = ? AND observed_at < ?`),
    };
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  /**
   * Record observed states; only changes produce events.
   * @param {{ provider, profileId, project?, resourceType, source, complete?, items: [{ key, name, state, details? }] }} input
   * @returns {number} events written
   */
  recordStates({ provider, profileId, project = null, resourceType, source = 'observed', complete = false, items = [] }) {
    assertType(resourceType);
    if (!SOURCES.has(source)) throw badRequest(`Unsupported source: ${source}`);
    if (!profileId) throw badRequest('profileId is required');
    const observedAt = this._iso();
    let written = 0;
    this.db.transaction(() => {
      const seen = new Set();
      for (const item of items) {
        if (!item?.key || !item.state) continue;
        seen.add(item.key);
        const last = this.st.last.get(provider, profileId, resourceType, item.key);
        if (last?.state === item.state) continue;
        this.st.insertEvent.run({
          provider, profileId, project, resourceType, resourceKey: item.key, resourceName: item.name || item.key,
          kind: 'state', source, state: item.state, previousState: last?.state ?? null, action: null,
          details: JSON.stringify(item.details || {}), observedAt,
        });
        this.st.upsertLast.run({ provider, profileId, resourceType, resourceKey: item.key, resourceName: item.name || item.key, state: item.state, observedAt });
        written++;
      }
      if (complete) {
        for (const last of this.st.lastForType.all(provider, profileId, resourceType)) {
          if (seen.has(last.resource_key) || last.state === 'MISSING') continue;
          this.st.insertEvent.run({
            provider, profileId, project, resourceType, resourceKey: last.resource_key, resourceName: last.resource_name,
            kind: 'state', source, state: 'MISSING', previousState: last.state, action: null,
            details: '{}', observedAt,
          });
          this.st.upsertLast.run({ provider, profileId, resourceType, resourceKey: last.resource_key, resourceName: last.resource_name, state: 'MISSING', observedAt });
          written++;
        }
      }
    })();
    return written;
  }

  /** Record a user action (start, stop, create, delete, labels, ssh-key…). */
  recordAction({ provider, profileId, project = null, resourceType, key, name, action, details = {} }) {
    assertType(resourceType);
    if (!action) throw badRequest('action is required');
    this.st.insertEvent.run({
      provider, profileId, project, resourceType, resourceKey: key, resourceName: name || key,
      kind: 'action', source: 'user', state: null, previousState: null, action,
      details: JSON.stringify(details), observedAt: this._iso(),
    });
  }

  listEvents({ provider, profileId, resourceType, key, limit = 100, before = null }) {
    assertType(resourceType);
    const rows = this.st.events.all({
      provider, profileId, resourceType, resourceKey: key,
      limit: Math.min(Math.max(Number(limit) || 100, 1), 500), before: before ? Number(before) : null,
    });
    return rows.map(r => ({
      id: r.id, kind: r.kind, source: r.source, state: r.state, previousState: r.previous_state,
      action: r.action, details: parseJson(r.details_json, {}), observedAt: r.observed_at,
      resourceName: r.resource_name,
    }));
  }

  getPollSettings(provider, profileId) {
    const row = this.st.getSettings.get(provider, profileId);
    if (!row) return { ...DEFAULT_POLL_SETTINGS, lastRunAt: null, lastError: null };
    return this._settings(row);
  }

  updatePollSettings(provider, profileId, changes = {}) {
    const current = this.getPollSettings(provider, profileId);
    const next = { ...current };
    if (changes.enabled !== undefined) next.enabled = changes.enabled === true;
    if (changes.intervalMinutes !== undefined) {
      const m = Number(changes.intervalMinutes);
      if (!Number.isInteger(m) || m < MIN_INTERVAL_MINUTES || m > MAX_INTERVAL_MINUTES) {
        throw badRequest(`Interval must be ${MIN_INTERVAL_MINUTES}-${MAX_INTERVAL_MINUTES} minutes.`);
      }
      next.intervalMinutes = m;
    }
    if (changes.resourceTypes !== undefined) {
      if (!Array.isArray(changes.resourceTypes) || !changes.resourceTypes.every(t => RESOURCE_TYPES.has(t))) {
        throw badRequest('Invalid resource types.');
      }
      next.resourceTypes = [...new Set(changes.resourceTypes)];
    }
    if (changes.retentionDays !== undefined) {
      const d = Number(changes.retentionDays);
      if (!Number.isInteger(d) || d < 1 || d > 3650) throw badRequest('Retention must be 1-3650 days.');
      next.retentionDays = d;
    }
    this.st.upsertSettings.run({
      provider, profileId, enabled: next.enabled ? 1 : 0, intervalMinutes: next.intervalMinutes,
      resourceTypes: JSON.stringify(next.resourceTypes), retentionDays: next.retentionDays, updatedAt: this._iso(),
    });
    return this.getPollSettings(provider, profileId);
  }

  listEnabledPollSettings(provider) {
    return this.st.enabledSettings.all(provider).map(row => ({ profileId: row.profile_id, ...this._settings(row) }));
  }

  markPollRun(provider, profileId, error = null) {
    this.st.markRun.run(this._iso(), error ? String(error).slice(0, 500) : null, provider, profileId);
  }

  /** Delete events older than the profile's retention. */
  cleanup(provider, profileId) {
    const { retentionDays } = this.getPollSettings(provider, profileId);
    const cutoff = new Date(this.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    return this.st.cleanup.run(provider, profileId, cutoff).changes;
  }

  _settings(row) {
    return {
      enabled: row.enabled === 1,
      intervalMinutes: row.interval_minutes,
      resourceTypes: parseJson(row.resource_types_json, DEFAULT_POLL_SETTINGS.resourceTypes),
      retentionDays: row.retention_days,
      lastRunAt: row.last_run_at,
      lastError: row.last_error,
    };
  }
}

let _instance = null;
/** Shared instance on the app's APM database. */
function getStateHistory() {
  if (!_instance) {
    const { getApmDatabase } = require('./apm/database');
    _instance = new StateHistory(getApmDatabase().db);
  }
  return _instance;
}

module.exports = { StateHistory, getStateHistory, DEFAULT_POLL_SETTINGS, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES };
