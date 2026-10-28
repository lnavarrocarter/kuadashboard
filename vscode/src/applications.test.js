'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  advisorChildren, advisorProfile, applicationChildren, applicationNode, briefFor, githubRepository,
  issueBrief, originUrl, workspaceApplication,
} = require('./applications');
const { createApplicationsData, createApplicationsView } = require('./applicationsView');
const { translator } = require('./texts');

const NOW = Date.parse('2026-10-28T12:00:00Z');
let t;

test.before(async () => {
  // The real KUA texts, as the build copies them (frontend/src/locales).
  const load = async name => (await import(pathToFileURL(path.join(__dirname, '../../frontend/src/locales', `${name}.js`)).href)).default;
  t = translator({ en: await load('en'), es: await load('es') }, 'en');
});

const APP = { id: 'app-1', name: 'orders', environment: 'prod', local: { bindings: [{ scopeKey: 's', status: 'verified', profileId: 'p-aws' }] } };
const ISSUES = {
  counts: { critical: 1, warning: 1, info: 0 },
  issues: [
    { id: 'threshold:r1:errorRatePercent', kind: 'threshold', severity: 'critical', resourceName: 'checkout', resourceType: 'lambda', since: '2026-10-28T10:00:00Z', evidence: { metric: 'errorRatePercent', value: 30.04, threshold: 5, comparison: 'above' }, action: 'open_signals' },
    { id: 'gone:r2', kind: 'gone', severity: 'warning', resourceName: 'api-3.9.1', resourceType: 'kubernetes', resourceKind: 'Deployment', since: '2026-10-27T12:00:00Z', action: 'review_missing' },
  ],
};
const REGISTRY = {
  resources: [
    { id: 'r1', provider: 'aws', resourceType: 'lambda', displayName: 'checkout', signals: { state: 'current' } },
    { id: 'r2', provider: 'kubernetes', resourceType: 'deployment', displayName: 'api-3.9.1', signals: { state: 'gone' } },
  ],
};

test('GitHub remotes and .git/config give the repository of the workspace', () => {
  assert.equal(githubRepository('git@github.com:Acme/Orders.git'), 'acme/orders');
  assert.equal(githubRepository('https://github.com/acme/orders'), 'acme/orders');
  assert.equal(githubRepository('https://gitlab.com/acme/orders.git'), null);
  const config = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/kua/upstream.git\n[remote "origin"]\n\turl = git@github.com:acme/orders.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
  assert.equal(originUrl(config), 'git@github.com:acme/orders.git');
  assert.equal(originUrl('[core]\n'), null);
});

test('the workspace application is the configured one, else the only one with its repository', () => {
  const apps = [APP, { id: 'app-2', name: 'billing' }, { id: 'app-3', name: 'billing-staging' }];
  assert.equal(workspaceApplication(apps, { configured: 'billing' }).id, 'app-2');
  assert.equal(workspaceApplication(apps, { configured: 'app-1', repository: 'x/y' }).id, 'app-1');
  const repositoriesOf = id => ({ 'app-1': ['Acme/Orders'], 'app-2': ['acme/billing'], 'app-3': ['acme/billing'] })[id] || [];
  assert.equal(workspaceApplication(apps, { repository: 'acme/orders', repositoriesOf }).id, 'app-1');
  assert.equal(workspaceApplication(apps, { repository: 'acme/billing', repositoriesOf }), null, 'two candidates: none is guessed');
  assert.equal(workspaceApplication(apps, { configured: 'missing' }), null);
});

test('an application says what needs attention with KUA\'s own words', () => {
  const node = applicationNode(t, APP, { issues: ISSUES, linked: true });
  assert.equal(node.icon, 'error');
  assert.match(node.description, /\$\(pin\) prod 1 critical · 1 warning/);
  const [attention, resources, advisor] = applicationChildren(t, APP, { registry: REGISTRY, issues: ISSUES, now: NOW });
  assert.equal(attention.label, 'What needs attention');
  assert.deepEqual(attention.children.map(item => item.description), [
    'Observed error rate (%): 30 (threshold 5) · since 2 h ago',
    'No longer exists where it lived · since 24 h ago',
  ]);
  assert.deepEqual(attention.children.map(item => item.link.tab), ['signals', 'review']);
  assert.deepEqual(resources.children.map(item => item.label), ['api-3.9.1', 'checkout'], 'gone resources first');
  assert.match(resources.children[0].description, /No longer exists/);
  assert.equal(advisor.kind, 'advisor');
});

test('Advisor findings, a locked report, and the briefs for the chat', () => {
  const report = { findings: [{ id: 'product.no_owner', category: 'product', severity: 'medium', count: 1 }, { id: 'product.slo_breached', category: 'product', severity: 'high', count: 1 }] };
  const nodes = advisorChildren(t, APP, report);
  assert.equal(nodes.length, 2);
  assert.notEqual(nodes[0].label, 'advisor.rule.product.no_owner.title', 'the rule title is translated');
  assert.equal(advisorChildren(t, APP, { locked: true, totals: { findings: 3 } })[0].icon, 'lock');
  const one = briefFor(t, APP, report, { findings: [report.findings[1]], now: NOW });
  assert.match(one, /orders/);
  assert.match(one, /product\.slo_breached/);
  assert.doesNotMatch(one, /product\.no_owner/);
  const issue = issueBrief(t, APP, ISSUES.issues[0], NOW);
  assert.match(issue, /checkout/);
  assert.match(issue, /error rate \(%\): 30 \(threshold 5\)/);
  assert.equal(advisorProfile(APP), 'p-aws');
  assert.equal(advisorProfile({ local: { legacy: { profileId: 'legacy' } } }), 'legacy');
  assert.equal(advisorProfile({}), null);
});

test('Spanish follows the editor language', () => {
  const es = translator({ en: { a: 'A {n}' }, es: { a: 'Á {n}' } }, 'es-419');
  assert.equal(es('a', { n: 2 }), 'Á 2');
  assert.equal(translator({ en: { a: 'A' }, es: {} }, 'es')('a'), 'A', 'English when a key is missing');
  assert.equal(translator({}, 'en')('missing.key'), 'missing.key');
});

function fakeVscode() {
  class EventEmitter { constructor() { this.listeners = []; this.event = listener => this.listeners.push(listener); } fire() { this.listeners.forEach(listener => listener()); } dispose() {} }
  return {
    EventEmitter,
    TreeItem: class { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  };
}

test('the view lists applications (the workspace one first), loads children on demand and says when KUA is closed', async () => {
  const calls = [];
  const answers = {
    '/api/kua-apps/applications': [{ id: 'app-2', name: 'billing' }, APP],
    '/api/kua-apps/applications/app-1/observability/issues': ISSUES,
    '/api/kua-apps/applications/app-2/observability/issues': { counts: {}, issues: [] },
    '/api/kua-apps/applications/app-1/registry': REGISTRY,
    '/api/kua-apps/applications/app-1/github': { repositories: [], discovered: [{ repository: 'acme/orders' }] },
    '/api/kua-apps/applications/app-2/github': null,
    '/api/architecture/applications/app-1/advisor': { findings: [] },
  };
  const get = async (pathName, headers = {}) => { calls.push([pathName, headers['X-Profile-Id'] || null]); return answers[pathName] ?? null; };
  let open = true;
  const view = createApplicationsView({ vscode: fakeVscode(), data: createApplicationsData({ get }), t, reachable: () => open, workspace: () => ({ configured: '', repository: 'acme/orders' }) });
  const roots = await view.getChildren();
  assert.deepEqual(roots.map(node => [node.label, node.linked]), [['orders', true], ['billing', false]]);
  assert.equal(view.getTreeItem(roots[0]).collapsibleState, 2, 'the workspace application opens expanded');
  assert.equal(view.getTreeItem(roots[0]).contextValue, 'kua.application');
  const groups = await view.getChildren(roots[0]);
  assert.equal((await view.getChildren(groups[0])).length, 2);
  const advisor = await view.getChildren(groups[2]);
  assert.equal(advisor[0].label, t('agentBrief.noFindings'));
  assert.deepEqual(calls.find(call => call[0].endsWith('/advisor')), ['/api/architecture/applications/app-1/advisor', 'p-aws']);
  assert.ok(!calls.some(call => call[0].includes('/api/cloud/')), 'no cloud routes');

  open = false;
  const closed = await view.getChildren();
  assert.equal(closed[0].kind, 'message');
  assert.match(closed[0].label, /not running/);
});
