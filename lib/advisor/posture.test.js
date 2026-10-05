'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ApmDatabase } = require('../apm/database');
const { check, buildReport } = require('./core');
const { PostureStore, applyAcceptances, finalizeAdvisor, scopeKeys, HISTORY_COALESCE_MS } = require('./posture');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-10-05T10:00:00Z');

function fixture() {
  let clock = T0;
  const database = new ApmDatabase({ filePath: ':memory:' });
  const store = new PostureStore(database.db, { now: () => clock });
  return { store, tick: ms => { clock += ms; }, close: () => database.close() };
}

const BASTION = { kind: 'Instance', name: 'bastion' };
const WEB = { kind: 'Instance', name: 'web' };

function report() {
  return buildReport([
    check({ id: 'aws.public_ip', category: 'security', severity: 'high' }, [BASTION, WEB]),
    check({ id: 'aws.root_mfa', category: 'security', severity: 'high' }, [{ kind: 'Account', name: 'root' }]),
    check({ id: 'aws.rds_backup', category: 'infrastructure', severity: 'medium' }, []),
  ], { now: T0 });
}

const score = summary => Object.values(summary).reduce((sum, bucket) => ({ passed: sum.passed + bucket.passed, checks: sum.checks + bucket.checks }), { passed: 0, checks: 0 });

test('an accepted rule leaves the score and comes back when the acceptance expires', () => {
  const { store, tick, close } = fixture();
  try {
    const before = score(report().summary);
    assert.deepEqual(before, { passed: 1, checks: 3 });

    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'Break-glass account kept in a safe', expiresAt: new Date(T0 + 30 * DAY).toISOString(), author: 'ana@example.com' });
    const applied = applyAcceptances(report(), store.list('aws:p1'), { now: store.now() });
    assert.deepEqual(applied.findings.map(f => f.id), ['aws.public_ip']);
    assert.deepEqual(applied.accepted.map(f => [f.id, f.acceptance.reason, f.acceptance.author]), [['aws.root_mfa', 'Break-glass account kept in a safe', 'ana@example.com']]);
    assert.deepEqual(applied.summary.security, { high: 1, medium: 0, low: 0, findings: 1, passed: 0, checks: 1, accepted: 1 });
    assert.deepEqual(score(applied.summary), { passed: 1, checks: 2 });

    tick(31 * DAY);
    const expired = applyAcceptances(report(), store.list('aws:p1'), { now: store.now() });
    assert.deepEqual(expired.findings.map(f => f.id), ['aws.public_ip', 'aws.root_mfa']);
    assert.equal(expired.accepted.length, 0);
    assert.equal(store.list('aws:p1')[0].expired, true);
  } finally { close(); }
});

test('accepting some resources keeps the finding for the others; all of them moves it', () => {
  const { store, close } = fixture();
  try {
    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.public_ip', resources: [BASTION], kind: 'accepted', reason: 'SSH bastion behind an IP allow list' });
    const partial = applyAcceptances(report(), store.list('aws:p1'), { now: store.now() });
    const finding = partial.findings.find(f => f.id === 'aws.public_ip');
    assert.equal(finding.count, 1);
    assert.deepEqual(finding.resources, [WEB]);
    assert.equal(finding.acceptedResources[0].resource.name, 'bastion');
    assert.equal(partial.summary.security.findings, 2);

    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.public_ip', resources: [WEB], kind: 'silenced', reason: 'Public web server by design' });
    const all = applyAcceptances(report(), store.list('aws:p1'), { now: store.now() });
    assert.equal(all.findings.some(f => f.id === 'aws.public_ip'), false);
    assert.equal(all.accepted.find(f => f.id === 'aws.public_ip').acceptedResources.length, 2);
  } finally { close(); }
});

test('acceptances need a reason and a future expiry, and are scoped', () => {
  const { store, close } = fixture();
  try {
    assert.throws(() => store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: '  ' }), /reason is required/);
    assert.throws(() => store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x', expiresAt: new Date(T0 - 1).toISOString() }), /future date/);
    assert.throws(() => store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x', kind: 'ignored' }), /accepted or silenced/);
    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x' });
    assert.equal(store.list('aws:p2').length, 0);
  } finally { close(); }
});

test('a revoked acceptance stops applying', () => {
  const { store, close } = fixture();
  try {
    const [acceptance] = store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'temporary' });
    assert.equal(store.revoke(acceptance.id, { by: 'ana' }).revokedAt, new Date(T0).toISOString());
    assert.equal(store.revoke(acceptance.id), null);
    assert.equal(store.list('aws:p1').length, 0);
    assert.equal(applyAcceptances(report(), store.list('aws:p1')).accepted.length, 0);
  } finally { close(); }
});

test('history keeps one point per analysis and coalesces identical ones within an hour', () => {
  const { store, tick, close } = fixture();
  try {
    assert.equal(store.record('aws:p1:us-east-1', report()), true);
    tick(5 * 60 * 1000);
    assert.equal(store.record('aws:p1:us-east-1', report()), false);
    tick(HISTORY_COALESCE_MS);
    assert.equal(store.record('aws:p1:us-east-1', report()), true);
    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x' });
    tick(60 * 1000);
    assert.equal(store.record('aws:p1:us-east-1', applyAcceptances(report(), store.list('aws:p1'))), true);

    const points = store.history('aws:p1:us-east-1');
    assert.equal(points.length, 3);
    assert.equal(points[0].summary.security.high, 2);
    assert.equal(points[2].summary.security.high, 1);
    assert.deepEqual(points[2].findings, [{ id: 'aws.public_ip', category: 'security', severity: 'high', count: 2, params: {} }]);
    assert.equal(store.record('aws:p1:us-east-1', { error: 'AccessDenied' }), false);
  } finally { close(); }
});

test('finalizeAdvisor applies acceptances, records fresh scans only, and keeps the Free gate', () => {
  const { store, tick, close } = fixture();
  try {
    const scopes = scopeKeys('aws', { profileId: 'p1', region: 'us-east-1' });
    assert.deepEqual(scopes, { acceptance: 'aws:p1', history: 'aws:p1:us-east-1' });
    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x', expiresAt: new Date(T0 + 3 * DAY).toISOString() });

    const pro = finalizeAdvisor(report(), { scopes, store, gate: value => value });
    assert.equal(pro.accepted.length, 1);
    assert.deepEqual(pro.posture, { acceptanceScope: 'aws:p1', historyScope: 'aws:p1:us-east-1', expiringSoon: 1, expired: 0, teamScope: null, teamCanDecide: false });
    tick(2 * HISTORY_COALESCE_MS);
    finalizeAdvisor(report(), { scopes, store, fresh: false, gate: value => value });
    assert.equal(store.history('aws:p1:us-east-1').length, 1);

    const { gateAdvisor, PLANS } = require('../plans');
    const free = finalizeAdvisor(report(), { scopes, store, gate: value => gateAdvisor(value, PLANS.free) });
    assert.equal(free.locked, true);
    assert.equal(free.accepted, undefined);
    assert.equal(free.totals.high, 1);
    assert.equal(free.posture.acceptanceScope, 'aws:p1');

    assert.deepEqual(finalizeAdvisor({ error: 'boom' }, { scopes, store, gate: value => value }), { error: 'boom' });
  } finally { close(); }
});

// Posture alerts: what changed between two analyses of a scope.
const withFindings = findings => buildReport(findings.map(([id, severity, count]) => check({ id, category: 'security', severity }, Array.from({ length: count }, (_, i) => ({ kind: 'Pod', name: `${id}-${i}` })))), { now: T0 });

test('a new analysis alerts the high and medium findings that appeared and the ones fixed; the first one is the baseline', () => {
  const { store, tick, close } = fixture();
  try {
    store.record('kubernetes:ctx:all', withFindings([['k8s.privileged', 'high', 1], ['k8s.no_limits', 'low', 3]]));
    assert.equal(store.alerts().alerts.length, 0);

    tick(2 * HISTORY_COALESCE_MS);
    store.record('kubernetes:ctx:all', withFindings([['k8s.no_limits', 'low', 3], ['k8s.root', 'medium', 2], ['k8s.latest_tag', 'low', 1]]), { label: 'shop' });
    const { unread, alerts } = store.alerts();
    assert.equal(unread, 2);
    assert.deepEqual(alerts.map(a => [a.type, a.ruleId, a.severity]).sort(), [['fixed', 'k8s.privileged', 'info'], ['new_finding', 'k8s.root', 'medium']]);
    assert.deepEqual(alerts.find(a => a.type === 'new_finding').data, { category: 'security', count: 2, params: {}, scopeLabel: 'shop' });
  } finally { close(); }
});

test('a finding that left because it was accepted is not fixed, and one change alerts once a day', () => {
  const { store, tick, close } = fixture();
  try {
    const scope = 'aws:p1:us-east-1';
    store.record(scope, report());
    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x' });
    tick(2 * HISTORY_COALESCE_MS);
    store.record(scope, applyAcceptances(report(), store.list('aws:p1')));
    assert.equal(store.alerts().alerts.length, 0);

    // The finding flaps: back (new), gone (fixed), back again the same day → still one "new" alert.
    const withMfa = () => report();
    const withoutMfa = () => buildReport([check({ id: 'aws.public_ip', category: 'security', severity: 'high' }, [BASTION, WEB])], { now: T0 });
    store.record(scope, withoutMfa());
    for (const build of [withMfa, withoutMfa, withMfa]) { tick(2 * HISTORY_COALESCE_MS); store.record(scope, build()); }
    assert.equal(store.alerts().alerts.filter(a => a.type === 'new_finding' && a.ruleId === 'aws.root_mfa').length, 1);
  } finally { close(); }
});

test('acceptances about to expire or expired alert once each, and hooks receive new alerts', () => {
  const { store, tick, close } = fixture();
  try {
    const received = [];
    store.onAlert(alert => received.push(alert.type));
    store.onAlert(() => { throw new Error('webhook down'); });
    store.accept({ scopeKey: 'aws:p1', ruleId: 'aws.root_mfa', reason: 'x', expiresAt: new Date(T0 + 3 * DAY).toISOString() });
    const scopes = scopeKeys('aws', { profileId: 'p1', region: 'us-east-1' });
    finalizeAdvisor(report(), { scopes, store, gate: value => value });
    finalizeAdvisor(report(), { scopes, store, fresh: false, gate: value => value });
    tick(4 * DAY);
    finalizeAdvisor(report(), { scopes, store, fresh: false, gate: value => value });
    assert.deepEqual(store.alerts().alerts.map(a => [a.type, a.severity]), [['acceptance_expired', 'high'], ['acceptance_expiring', 'medium']]);
    assert.deepEqual(received, ['acceptance_expiring', 'acceptance_expired']);

    assert.equal(store.markRead({ ids: [store.alerts().alerts[1].id] }), 1);
    assert.equal(store.alerts().unread, 1);
    assert.equal(store.markRead({ all: true }), 1);
    assert.equal(store.alerts().unread, 0);
  } finally { close(); }
});
