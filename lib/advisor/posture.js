'use strict';
/**
 * lib/advisor/posture.js
 * What a team decided about the Advisor findings, and how the posture evolves.
 *
 *   acceptances  a finding accepted (a known, owned risk) or silenced (does
 *                not apply here), for the whole rule or for some resources,
 *                with a reason and an optional expiry. Accepted findings are
 *                listed apart and leave the score: they are neither passed
 *                nor failed checks. When the acceptance expires the finding
 *                comes back.
 *   history      one summary per analysis (identical results within an hour
 *                are one point), kept a year, to chart passed checks and
 *                high findings per category.
 *
 * Scopes are strings built by scopeKeys(): acceptances follow the account or
 * cluster (a rule accepted for a profile applies in every region), history
 * follows exactly what was analysed (region, project, namespace).
 */

const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_RETENTION_DAYS = 365;
// Identical analyses within this window are the same point (the Kubernetes overview polls).
const HISTORY_COALESCE_MS = 60 * 60 * 1000;
const EXPIRING_SOON_MS = 7 * DAY_MS;
const KINDS = new Set(['accepted', 'silenced']);
const MAX_REASON = 500;

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

/** Stable key of a finding resource ({ kind, namespace, name }). */
function resourceKey(resource = {}) {
  return [resource.kind || '', resource.namespace || '', resource.name || ''].join('|');
}

function resourceLabel(resource = {}) {
  return `${resource.kind ? `${resource.kind} ` : ''}${resource.namespace ? `${resource.namespace}/` : ''}${resource.name || ''}`.trim();
}

/**
 * Where acceptances and history of a report belong.
 * @param kind 'aws' | 'gcp' | 'kubernetes' | 'product'
 */
function scopeKeys(kind, { profileId = '', region = '', projectId = '', context = '', namespace = '', applicationId = '' } = {}) {
  switch (kind) {
    case 'aws': return { acceptance: `aws:${profileId}`, history: `aws:${profileId}:${region}` };
    case 'gcp': return { acceptance: `gcp:${profileId}`, history: `gcp:${profileId}:${projectId}` };
    case 'kubernetes': return { acceptance: `kubernetes:${context}`, history: `kubernetes:${context}:${namespace || 'all'}` };
    case 'product': return { acceptance: `product:${applicationId}`, history: `product:${applicationId}` };
    default: throw new Error(`Unknown Advisor scope ${kind}`);
  }
}

class PostureStore {
  /** @param {import('better-sqlite3').Database} db  the APM database (migration 18) */
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    this.st = {
      active: db.prepare(`SELECT * FROM kua_advisor_acceptances
        WHERE scope_key = ? AND revoked_at IS NULL ORDER BY created_at`),
      byId: db.prepare('SELECT * FROM kua_advisor_acceptances WHERE id = ?'),
      insert: db.prepare(`INSERT INTO kua_advisor_acceptances
        (id, scope_key, rule_id, resource_key, resource_label, kind, reason, author, created_at, expires_at)
        VALUES (@id, @scopeKey, @ruleId, @resourceKey, @resourceLabel, @kind, @reason, @author, @createdAt, @expiresAt)`),
      revoke: db.prepare('UPDATE kua_advisor_acceptances SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL'),
      lastPoint: db.prepare('SELECT captured_at, content_hash FROM kua_advisor_history WHERE scope_key = ? ORDER BY captured_at DESC, id DESC LIMIT 1'),
      insertPoint: db.prepare(`INSERT INTO kua_advisor_history (scope_key, captured_at, summary_json, findings_json, content_hash)
        VALUES (?, ?, ?, ?, ?)`),
      points: db.prepare(`SELECT * FROM kua_advisor_history WHERE scope_key = ? AND captured_at >= ?
        ORDER BY captured_at ASC, id ASC`),
      prune: db.prepare('DELETE FROM kua_advisor_history WHERE captured_at < ?'),
    };
  }

  _acceptance(row) {
    if (!row) return null;
    const now = this.now();
    return {
      id: row.id,
      scope: row.scope_key,
      ruleId: row.rule_id,
      resourceKey: row.resource_key || null,
      resourceLabel: row.resource_label || null,
      kind: row.kind,
      reason: row.reason,
      author: row.author,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      expired: !!row.expires_at && row.expires_at <= now,
      expiringSoon: !!row.expires_at && row.expires_at > now && row.expires_at - now <= EXPIRING_SOON_MS,
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    };
  }

  /** Acceptances not revoked, including expired ones (`expired: true`). */
  list(scopeKey) {
    return this.st.active.all(scopeKey).map(row => this._acceptance(row));
  }

  get(id) {
    return this._acceptance(this.st.byId.get(id));
  }

  /**
   * Accepts or silences a rule, or some of its resources (one acceptance each).
   * @returns the created acceptances
   */
  accept({ scopeKey, ruleId, resources = [], kind = 'accepted', reason, expiresAt = null, author = 'local' }) {
    if (!scopeKey || !ruleId) throw badRequest('scope and ruleId are required');
    if (!KINDS.has(kind)) throw badRequest('kind must be accepted or silenced');
    const text = String(reason || '').trim();
    if (!text) throw badRequest('A reason is required');
    if (text.length > MAX_REASON) throw badRequest(`The reason is longer than ${MAX_REASON} characters`);
    let expires = null;
    if (expiresAt) {
      expires = new Date(expiresAt).getTime();
      if (!Number.isFinite(expires) || expires <= this.now()) throw badRequest('The expiry must be a future date');
    }
    const targets = resources.length ? resources.map(resource => ({ key: resourceKey(resource), label: resourceLabel(resource) })) : [{ key: null, label: null }];
    const created = [];
    this.db.transaction(() => {
      for (const target of targets) {
        const id = crypto.randomUUID();
        this.st.insert.run({ id, scopeKey, ruleId, resourceKey: target.key, resourceLabel: target.label, kind, reason: text, author: String(author || 'local'), createdAt: this.now(), expiresAt: expires });
        created.push(this.get(id));
      }
    })();
    return created;
  }

  /**
   * Makes the scope hold exactly these acceptances (from a KUAAppBundle):
   * the ones it lacks are added with their original author and dates, the
   * ones not listed are revoked. Expired ones are skipped. Identity is the
   * rule, resource, author and creation time.
   */
  replaceFrom(scopeKey, acceptances = [], { by = 'sync' } = {}) {
    const identity = item => [item.ruleId, item.resourceKey || '', item.author, item.createdAt].join('\u0000');
    const now = this.now();
    const wanted = new Map(acceptances
      .filter(item => item?.ruleId && KINDS.has(item.kind) && String(item.reason || '').trim() && (!item.expiresAt || new Date(item.expiresAt).getTime() > now))
      .map(item => [identity(item), item]));
    const current = this.list(scopeKey);
    this.db.transaction(() => {
      for (const item of current) if (!wanted.has(identity(item))) this.st.revoke.run(now, by, item.id);
      const have = new Set(current.map(identity));
      for (const [key, item] of wanted) {
        if (have.has(key)) continue;
        this.st.insert.run({
          id: crypto.randomUUID(), scopeKey, ruleId: String(item.ruleId), resourceKey: item.resourceKey || null, resourceLabel: item.resourceLabel || null,
          kind: item.kind, reason: String(item.reason).trim().slice(0, MAX_REASON), author: String(item.author || 'local'),
          createdAt: new Date(item.createdAt).getTime() || now, expiresAt: item.expiresAt ? new Date(item.expiresAt).getTime() : null,
        });
      }
    })();
    return this.list(scopeKey);
  }

  /** Ends an acceptance: the finding counts again from the next analysis. */
  revoke(id, { by = 'local' } = {}) {
    const acceptance = this.get(id);
    if (!acceptance || acceptance.revokedAt) return null;
    this.st.revoke.run(this.now(), String(by || 'local'), id);
    return this.get(id);
  }

  /**
   * Records a summary of the analysis. A result identical to the last point
   * within an hour does not add a point.
   */
  record(scopeKey, report) {
    if (!report || report.error || !report.summary) return false;
    const summary = report.summary;
    const findings = (report.findings || []).map(finding => ({ id: finding.id, category: finding.category, severity: finding.severity, count: finding.count }));
    const summaryJson = JSON.stringify(summary);
    const findingsJson = JSON.stringify(findings);
    const hash = crypto.createHash('sha256').update(summaryJson).update(findingsJson).digest('hex');
    const now = this.now();
    const last = this.st.lastPoint.get(scopeKey);
    if (last && last.content_hash === hash && now - last.captured_at < HISTORY_COALESCE_MS) return false;
    this.st.insertPoint.run(scopeKey, now, summaryJson, findingsJson, hash);
    this.st.prune.run(now - HISTORY_RETENTION_DAYS * DAY_MS);
    return true;
  }

  /** Points of the last `days`, oldest first: { capturedAt, summary, findings }. */
  history(scopeKey, { days = 90 } = {}) {
    const window = Math.min(Math.max(Number(days) || 90, 1), HISTORY_RETENTION_DAYS);
    return this.st.points.all(scopeKey, this.now() - window * DAY_MS).map(row => ({
      capturedAt: new Date(row.captured_at).toISOString(),
      summary: JSON.parse(row.summary_json),
      findings: JSON.parse(row.findings_json),
    }));
  }
}

/**
 * The report without the accepted findings, which move to `accepted` with
 * their acceptance. Resource acceptances remove those resources; a finding
 * whose listed resources are all accepted moves too. Expired acceptances are
 * ignored, so the finding is back.
 */
function applyAcceptances(report, acceptances = [], { now = Date.now() } = {}) {
  if (!report || report.error || !Array.isArray(report.findings)) return report;
  const active = acceptances.filter(item => !item.revokedAt && (!item.expiresAt || new Date(item.expiresAt).getTime() > now));
  const summary = JSON.parse(JSON.stringify(report.summary || {}));
  for (const bucket of Object.values(summary)) bucket.accepted = 0;
  const findings = [];
  const accepted = [];

  const moveToAccepted = (finding, acceptance) => {
    accepted.push({ ...finding, acceptance });
    const bucket = summary[finding.category];
    if (!bucket) return;
    bucket.findings -= 1;
    bucket[finding.severity] -= 1;
    // Neither passed nor failed: it leaves the score.
    bucket.checks -= 1;
    bucket.accepted += 1;
  };

  for (const finding of report.findings) {
    const forRule = active.filter(item => item.ruleId === finding.id);
    const whole = forRule.find(item => !item.resourceKey);
    if (whole) { moveToAccepted(finding, whole); continue; }
    const byResource = new Map(forRule.filter(item => item.resourceKey).map(item => [item.resourceKey, item]));
    if (!byResource.size) { findings.push(finding); continue; }
    const kept = [];
    const acceptedResources = [];
    for (const resource of finding.resources || []) {
      const acceptance = byResource.get(resourceKey(resource));
      if (acceptance) acceptedResources.push({ resource, acceptance });
      else kept.push(resource);
    }
    if (!acceptedResources.length) { findings.push(finding); continue; }
    const remaining = finding.count - acceptedResources.length;
    if (remaining <= 0 && !finding.truncated) {
      moveToAccepted({ ...finding, acceptedResources }, acceptedResources[0].acceptance);
      continue;
    }
    findings.push({ ...finding, count: remaining, resources: kept, acceptedResources });
  }

  return { ...report, summary, findings, accepted };
}

/**
 * What every Advisor route answers: acceptances applied, the analysis
 * recorded (fresh scans only), then the plan gate (lib/plans.js). `posture`
 * tells the UI where to post acceptances and read history.
 */
function finalizeAdvisor(report, { scopes, store, fresh = true, gate = require('../plans').gateAdvisor, log = console } = {}) {
  if (!report || report.error || !scopes || !store) return gate(report);
  let result = report;
  try {
    const acceptances = store.list(scopes.acceptance);
    result = applyAcceptances(report, acceptances, { now: store.now() });
    result.posture = {
      acceptanceScope: scopes.acceptance,
      historyScope: scopes.history,
      expiringSoon: acceptances.filter(item => item.expiringSoon).length,
      expired: acceptances.filter(item => item.expired).length,
    };
    if (fresh) store.record(scopes.history, result);
  } catch (err) {
    log.warn?.('[advisor] posture:', err.message);
  }
  const gated = gate(result);
  // Free: the counts stay, the accepted list (resources and reasons) does not.
  return gated?.locked ? { ...gated, posture: result.posture } : gated;
}

let shared = null;
function getPostureStore() {
  if (!shared) shared = new PostureStore(require('../apm/database').getApmDatabase().db);
  return shared;
}

module.exports = {
  PostureStore, applyAcceptances, finalizeAdvisor, getPostureStore, scopeKeys, resourceKey, resourceLabel,
  HISTORY_COALESCE_MS, HISTORY_RETENTION_DAYS, EXPIRING_SOON_MS,
};
