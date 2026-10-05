'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ApmDatabase } = require('../apm/database');
const { PostureStore, applyAcceptances, finalizeAdvisor, scopeKeys } = require('./posture');
const { check, buildReport } = require('./core');
const { createTeamAcceptances, teamScopeOf, decisionId } = require('./teamAcceptances');
const { teamDecisionHash, teamDecisionMessage, teamDecisionCounter, verifyTeamDecision } = require('../account/account');

const SCOPE = 'aws-account:123456789012';
const decision = (overrides = {}) => ({ id: 'd1', scope: SCOPE, ruleId: 'aws.public_ip', resourceKey: 'Instance||bastion', resourceLabel: 'Instance bastion', kind: 'accepted', reason: 'Bastion behind an allow list', expiresAt: null, revokedAt: null, author: { id: 'owner', email: 'owner@example.com' }, updatedAt: '2026-10-05T10:00:00.000Z', action: 'accept', ...overrides });

function fixture({ role = 'owner', plan = 'team', items = [decision()] } = {}) {
  const database = new ApmDatabase({ filePath: ':memory:' });
  const store = new PostureStore(database.db);
  const calls = [];
  const state = { items, role, plan };
  const account = () => ({
    status: () => ({ linked: true, plan: state.plan, entitlements: { team: state.role ? { id: 'team-1', role: state.role } : null } }),
    team: {
      advisorDecisions: async () => ({ team: { id: 'team-1' }, items: state.items }),
      decideAdvisor: async (teamId, body) => { calls.push(['decide', teamId, body]); state.items = [...state.items, decision({ id: `d${state.items.length + 1}`, ...body, author: { id: 'owner', email: 'owner@example.com' } })]; },
      revokeAdvisor: async (teamId, body) => { calls.push(['revoke', teamId, body]); state.items = state.items.map(item => (item.ruleId === body.ruleId && (item.resourceKey || null) === (body.resourceKey || null) ? { ...item, revokedAt: '2026-10-05T11:00:00.000Z' } : item)); },
    },
  });
  return { team: createTeamAcceptances({ account, store, log: { warn() {} } }), store, calls, state, close: () => database.close() };
}

test('team scopes name the cloud: AWS account, GCP project, a hash of the cluster API server', () => {
  assert.equal(teamScopeOf('aws', { accountId: '123456789012' }), SCOPE);
  assert.equal(teamScopeOf('aws', { accountId: null }), null);
  assert.equal(teamScopeOf('gcp', { projectId: 'analytics-prod' }), 'gcp-project:analytics-prod');
  assert.equal(teamScopeOf('gcp', { projectId: 'BAD project' }), null);
  assert.match(teamScopeOf('kubernetes', { clusterServer: 'https://ABC.gr7.us-east-1.eks.amazonaws.com' }), /^k8s-cluster:[a-f0-9]{32}$/);
  assert.equal(teamScopeOf('product', { projectId: 'x' }), null);
  // Same id as the control plane (src/teamAdvisor.js acceptanceId).
  assert.equal(decisionId('t', SCOPE, 'aws.public_ip', null), crypto.createHash('sha256').update(`t\n${SCOPE}\naws.public_ip\n`).digest('hex').slice(0, 32));
});

test('the team decisions are mirrored per scope; revoked ones and a left team empty the mirror', async () => {
  const subject = fixture({ items: [decision(), decision({ id: 'd2', scope: 'gcp-project:analytics-prod', ruleId: 'gcp.public_ip', resourceKey: null }), decision({ id: 'd3', ruleId: 'aws.root_mfa', revokedAt: '2026-10-05T09:00:00Z' })] });
  try {
    assert.deepEqual(await subject.team.sync(), { scopes: 2, decisions: 2 });
    const mirrored = subject.store.list(`team:${SCOPE}`);
    assert.deepEqual(mirrored.map(item => [item.ruleId, item.resourceKey, item.author]), [['aws.public_ip', 'Instance||bastion', 'owner@example.com']]);

    subject.state.items = subject.state.items.map(item => (item.id === 'd2' ? { ...item, revokedAt: '2026-10-05T12:00:00Z' } : item));
    await subject.team.sync();
    assert.equal(subject.store.list('team:gcp-project:analytics-prod').length, 0);

    subject.state.role = null;
    await subject.team.sync();
    assert.equal(subject.store.list(`team:${SCOPE}`).length, 0);
  } finally { subject.close(); }
});

test('owners and admins decide and revoke for the team; members cannot', async () => {
  const subject = fixture({ items: [] });
  try {
    assert.equal(subject.team.canDecide(), true);
    assert.equal(await subject.team.decide({ teamScope: SCOPE, ruleId: 'aws.root_mfa', resources: [], kind: 'accepted', reason: 'Break-glass', expiresAt: '2026-12-31T00:00:00Z' }), 1);
    assert.deepEqual(subject.calls[0], ['decide', 'team-1', { scope: SCOPE, ruleId: 'aws.root_mfa', resourceKey: null, resourceLabel: null, kind: 'accepted', reason: 'Break-glass', expiresAt: '2026-12-31T00:00:00.000Z' }]);
    const [mirrored] = subject.store.list(`team:${SCOPE}`);
    assert.equal(mirrored.ruleId, 'aws.root_mfa');

    await subject.team.revoke(mirrored);
    assert.deepEqual(subject.calls[1], ['revoke', 'team-1', { id: decisionId('team-1', SCOPE, 'aws.root_mfa', null), scope: SCOPE, ruleId: 'aws.root_mfa', resourceKey: null }]);
    assert.equal(subject.store.list(`team:${SCOPE}`).length, 0);

    subject.state.role = 'member';
    assert.equal(subject.team.canDecide(), false);
    await assert.rejects(subject.team.decide({ teamScope: SCOPE, ruleId: 'aws.root_mfa', reason: 'x' }), err => err.code === 'FORBIDDEN');
    subject.state.role = 'owner';
    await assert.rejects(subject.team.decide({ teamScope: 'aws:local:prod', ruleId: 'aws.root_mfa', reason: 'x' }), /no cloud identity/);
  } finally { subject.close(); }
});

test('reports apply the team decisions of their cloud next to the local ones', async () => {
  const subject = fixture();
  try {
    await subject.team.sync();
    const report = buildReport([check({ id: 'aws.public_ip', category: 'security', severity: 'high' }, [{ kind: 'Instance', name: 'bastion' }])]);
    const scopes = scopeKeys('aws', { profileId: 'p1', region: 'us-east-1', teamScope: SCOPE });
    const result = finalizeAdvisor(report, { scopes, store: subject.store, fresh: false, gate: value => value, teamCanDecide: () => true });
    assert.equal(result.findings.length, 0);
    assert.equal(result.accepted[0].acceptance.team, true);
    assert.deepEqual([result.posture.teamScope, result.posture.teamCanDecide], [SCOPE, true]);
    // Another account: the team decision does not apply.
    const other = finalizeAdvisor(report, { scopes: scopeKeys('aws', { profileId: 'p2', region: 'us-east-1', teamScope: 'aws-account:999999999999' }), store: subject.store, fresh: false, gate: value => value, teamCanDecide: () => false });
    assert.equal(other.findings.length, 1);
    assert.equal(applyAcceptances(report, []).findings.length, 1);
  } finally { subject.close(); }
});

test('a team decision is used only when the deciding computer and the pinned team key both signed it', () => {
  const device = crypto.generateKeyPairSync('ed25519');
  const teamKey = crypto.generateKeyPairSync('ed25519');
  const signerKey = device.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
  const item = decision({ version: 1, signedAt: '2026-10-05T10:00:00.000Z', signerKey });
  const hash = teamDecisionHash({ action: 'accept', scope: item.scope, ruleId: item.ruleId, resourceKey: item.resourceKey, kind: item.kind, reason: item.reason, expiresAt: item.expiresAt });
  item.signature = crypto.sign(null, Buffer.from(teamDecisionMessage({ userId: 'owner', teamId: 'team-1', hash, signedAt: item.signedAt })), device.privateKey).toString('base64url');
  item.teamSignature = crypto.sign(null, Buffer.from(teamDecisionCounter({ teamId: 'team-1', id: item.id, version: 1, hash })), teamKey.privateKey).toString('base64url');
  const pem = teamKey.publicKey.export({ format: 'pem', type: 'spki' });
  assert.equal(verifyTeamDecision(item, { teamId: 'team-1', teamKey: pem }), true);
  assert.equal(verifyTeamDecision({ ...item, reason: 'Changed by the server' }, { teamId: 'team-1', teamKey: pem }), false);
  assert.equal(verifyTeamDecision(item, { teamId: 'team-1', teamKey: crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }) }), false, 'another team key');
});
