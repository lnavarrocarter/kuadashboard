'use strict';
/**
 * lib/advisor/teamAcceptances.js
 * Advisor decisions shared by a KUA team (Team plan; control plane
 * src/teamAdvisor.js). An owner or admin accepts or silences a finding once
 * for every member whose KUA analyses the same cloud:
 *
 *   aws-account:<12 digits>   gcp-project:<id>   k8s-cluster:<sha256 of the API server, 32 hex>
 *
 * Local acceptances (lib/advisor/posture.js) are keyed by this computer's
 * profiles; these team scopes name the cloud itself, so they match on every
 * member's computer. The team's decisions are mirrored locally as
 * "team:<scope>" acceptances, after both signatures (the deciding computer
 * and the team key, pinned) were verified (lib/account/account.js).
 */

const crypto = require('node:crypto');

const TEAM_SCOPE = /^(aws-account:\d{12}|gcp-project:[a-z][a-z0-9-]{4,61}[a-z0-9]|k8s-cluster:[a-f0-9]{32})$/;
const PREFIX = 'team:';

/** The team scope of a report, or null when the cloud identity is unknown. */
function teamScopeOf(kind, { accountId = null, projectId = null, clusterServer = null } = {}) {
  let scope = null;
  if (kind === 'aws' && accountId) scope = `aws-account:${accountId}`;
  if (kind === 'gcp' && projectId) scope = `gcp-project:${projectId}`;
  if (kind === 'kubernetes' && clusterServer) scope = `k8s-cluster:${crypto.createHash('sha256').update(String(clusterServer)).digest('hex').slice(0, 32)}`;
  return scope && TEAM_SCOPE.test(scope) ? scope : null;
}

/** Same id as the control plane gives a decision (one per team, scope, rule and resource). */
const decisionId = (teamId, scope, ruleId, resourceKey) => crypto.createHash('sha256').update(`${teamId}\n${scope}\n${ruleId}\n${resourceKey || ''}`).digest('hex').slice(0, 32);

/**
 * @param options.account  () => the KUA account (status, team.advisorDecisions/decideAdvisor/revokeAdvisor)
 * @param options.store    PostureStore
 */
function createTeamAcceptances({ account, store, log = console }) {
  const teamOf = () => {
    try {
      const status = account().status();
      const team = status.entitlements?.team;
      return status.linked && team?.id && status.plan === 'team' ? team : null;
    } catch { return null; }
  };

  /** May this computer decide for the team (owner or admin of a Team-plan team)? */
  const canDecide = () => ['owner', 'admin'].includes(teamOf()?.role);

  /**
   * Mirrors the team's decisions: verified ones replace the "team:" scopes,
   * revoked or expired ones disappear. Without a team, the mirrors empty.
   */
  async function sync() {
    const team = teamOf();
    const known = new Set(store.scopesWithPrefix(PREFIX).map(key => key.slice(PREFIX.length)));
    if (!team) {
      for (const scope of known) store.replaceFrom(`${PREFIX}${scope}`, [], { by: 'team' });
      return { scopes: 0, decisions: 0 };
    }
    const { items } = await account().team.advisorDecisions();
    const byScope = new Map();
    for (const item of items) {
      if (item.revokedAt || !TEAM_SCOPE.test(item.scope)) continue;
      // createdAt = updatedAt: a new version (other reason, kind or expiry) replaces the mirrored one.
      const entry = { ruleId: item.ruleId, resourceKey: item.resourceKey, resourceLabel: item.resourceLabel, kind: item.kind, reason: item.reason, author: item.author?.email || 'team', createdAt: item.updatedAt, expiresAt: item.expiresAt };
      byScope.set(item.scope, [...(byScope.get(item.scope) || []), entry]);
      known.add(item.scope);
    }
    let decisions = 0;
    for (const scope of known) {
      const entries = byScope.get(scope) || [];
      store.replaceFrom(`${PREFIX}${scope}`, entries, { by: 'team' });
      decisions += entries.length;
    }
    return { scopes: byScope.size, decisions };
  }

  /** An owner or admin decides for the team (one decision per resource, or the whole rule). */
  async function decide({ teamScope, ruleId, resources = [], kind, reason, expiresAt = null }) {
    const team = teamOf();
    if (!team || !canDecide()) throw Object.assign(new Error('Only a team owner or admin decides for the team'), { statusCode: 403, code: 'FORBIDDEN' });
    if (!TEAM_SCOPE.test(String(teamScope || ''))) throw Object.assign(new Error('This analysis has no cloud identity to share with the team'), { statusCode: 400 });
    const { resourceKey, resourceLabel } = require('./posture');
    const targets = resources.length ? resources.map(resource => ({ resourceKey: resourceKey(resource), resourceLabel: resourceLabel(resource) })) : [{ resourceKey: null, resourceLabel: null }];
    for (const target of targets) {
      await account().team.decideAdvisor(team.id, { scope: teamScope, ruleId, ...target, kind, reason, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null });
    }
    await sync();
    return targets.length;
  }

  /** Revokes the team decision behind a mirrored acceptance. */
  async function revoke(acceptance) {
    const team = teamOf();
    if (!team || !canDecide()) throw Object.assign(new Error('Only a team owner or admin revokes a team decision'), { statusCode: 403, code: 'FORBIDDEN' });
    const scope = String(acceptance.scope || '').slice(PREFIX.length);
    await account().team.revokeAdvisor(team.id, { id: decisionId(team.id, scope, acceptance.ruleId, acceptance.resourceKey), scope, ruleId: acceptance.ruleId, resourceKey: acceptance.resourceKey });
    await sync();
  }

  return { sync, decide, revoke, canDecide, teamOf };
}

let shared = null;
function getTeamAcceptances() {
  if (!shared) shared = createTeamAcceptances({ account: () => require('../account/account').getAccount(), store: require('./posture').getPostureStore() });
  return shared;
}

module.exports = { createTeamAcceptances, getTeamAcceptances, teamScopeOf, decisionId, TEAM_SCOPE, PREFIX };
