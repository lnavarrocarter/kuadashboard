'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ApmDatabase } = require('../apm/database');
const { ArchitectureDatabase } = require('../architecture/database');
const { markGone } = require('../apm/resourcePresence');
const { ApplicationRegistryService } = require('./applicationRegistryService');
const { createKuaExtensionRegistry } = require('./extensionRegistry');
const {
  createGithubCicd, createGithubClient, deliveryMetrics, likelyCause, parseRepository,
} = require('./githubCicd');

const GONE_AT = Date.UTC(2026, 9, 8, 8, 20);
const CONTEXT = 'arn:aws:eks:us-east-1:111111111111:cluster/dev';

const run = (id, name, at, extra = {}) => ({
  id, run_number: id, name, status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), head_branch: 'main',
  triggering_actor: { login: 'ana' }, updated_at: at, html_url: `https://github.com/acme/api/actions/runs/${id}`,
  head_commit: { message: 'Release 3.9.2\n\nbody', timestamp: '2026-10-08T07:50:00Z', author: { name: 'Ana' } }, ...extra,
});

function fakeClient({ runs = [], deployments = [], failing = {} } = {}) {
  const calls = [];
  return {
    calls,
    user: async () => ({ login: 'octocat' }),
    workflowRuns: async repository => {
      calls.push(['runs', repository]);
      if (failing[repository]) throw Object.assign(new Error('Repository not found or not visible to the token'), { code: 'GITHUB_NOT_FOUND' });
      return { workflow_runs: runs };
    },
    deployments: async repository => { calls.push(['deployments', repository]); return deployments; },
  };
}

test('parses repositories from names and URLs and rejects anything else', () => {
  assert.equal(parseRepository('acme/api'), 'acme/api');
  assert.equal(parseRepository('https://github.com/acme/api.git'), 'acme/api');
  assert.equal(parseRepository('git@github.com:acme/api.git'), 'acme/api');
  for (const bad of ['', 'acme', 'https://evil.test/acme/api', 'acme/../x', 'a b/c', '-x/y']) {
    assert.throws(() => parseRepository(bad), { code: 'INVALID_REPOSITORY' }, bad);
  }
});

test('the client only runs read-only gh commands and maps CLI failures', async () => {
  const seen = [];
  const client = (output, failure) => createGithubClient({
    exec: async args => { seen.push(args); if (failure) throw failure; return output; },
  });
  await client('{"workflow_runs":[]}').workflowRuns('acme/api');
  assert.deepEqual(seen[0].slice(0, 3), ['api', '--method', 'GET']);
  assert.match(seen[0][3], /^repos\/acme\/api\/actions\/runs\?/);
  assert.deepEqual((await client('[{"nameWithOwner":"acme/api"}]').availableRepositories()), [{ nameWithOwner: 'acme/api' }]);
  assert.deepEqual(seen[1].slice(0, 2), ['repo', 'list']);
  const failing = failure => client('', failure).user();
  await assert.rejects(failing(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })), { code: 'GH_NOT_INSTALLED' });
  await assert.rejects(failing(Object.assign(new Error('x'), { stderr: 'To get started with GitHub CLI, please run:  gh auth login' })), { code: 'GH_NOT_AUTHENTICATED' });
  await assert.rejects(failing(Object.assign(new Error('x'), { stderr: 'gh: Not Found (HTTP 404)' })), { code: 'GITHUB_NOT_FOUND' });
  await assert.rejects(failing(Object.assign(new Error('x'), { stderr: 'API rate limit exceeded' })), { code: 'GITHUB_RATE_LIMITED' });
  await assert.rejects(client('not json').user(), { code: 'GITHUB_ERROR' });
});

test('connection reports whether the gh CLI is usable, and caches it briefly', async () => {
  let calls = 0;
  let failure = null;
  const github = createGithubCicd({ client: { ...fakeClient(), user: async () => { calls++; if (failure) throw failure; return { login: 'octocat' }; } } });
  assert.deepEqual(await github.connection(), { available: true, authenticated: true, login: 'octocat', readOnly: true });
  await github.connection();
  assert.equal(calls, 1);
  failure = Object.assign(new Error('The GitHub CLI is not logged in: run "gh auth login"'), { code: 'GH_NOT_AUTHENTICATED' });
  const status = await github.connection({ refresh: true });
  assert.equal(status.authenticated, false);
  assert.equal(status.code, 'GH_NOT_AUTHENTICATED');
  failure = Object.assign(new Error('missing'), { code: 'GH_NOT_INSTALLED' });
  assert.equal((await github.connection({ refresh: true })).available, false);
});

test('picks the deploy shortly before the change, not a failed or later one', () => {
  const events = [
    { id: 'ci', name: 'CI', deploy: false, conclusion: 'success', at: '2026-10-08T08:10:00.000Z' },
    { id: 'old', name: 'Deploy', deploy: true, conclusion: 'success', at: '2026-10-08T07:00:00.000Z' },
    { id: 'failed', name: 'Deploy', deploy: true, conclusion: 'failure', at: '2026-10-08T08:15:00.000Z' },
    { id: 'later', name: 'Deploy', deploy: true, conclusion: 'success', at: '2026-10-09T08:00:00.000Z' },
  ];
  const cause = likelyCause(events, new Date(GONE_AT).toISOString());
  assert.equal(cause.event.id, 'old');
  assert.equal(cause.confidence, 'probable');
  assert.equal(cause.minutesBefore, 80);
  assert.equal(likelyCause(events.slice(0, 1), new Date(GONE_AT).toISOString()).confidence, 'possible');
  assert.equal(likelyCause(events, '2026-12-01T00:00:00Z'), null);
});

test('activity maps runs and deployments, reports a failing repository and caches', async () => {
  const client = fakeClient({
    runs: [run(1, 'Deploy to production', '2026-10-08T08:05:00Z'), { ...run(2, 'CI', '2026-10-08T08:00:00Z'), status: 'in_progress' }],
    deployments: [{ id: 9, environment: 'production', sha: 'b'.repeat(40), ref: 'main', creator: { login: 'bob' }, created_at: '2026-10-08T08:06:00Z' }],
    failing: { 'acme/private': true },
  });
  const github = createGithubCicd({ client, now: () => GONE_AT });
  assert.deepEqual(github.configure('app-1', { repositories: ['acme/api', 'https://github.com/acme/private', 'ACME/api'] }), { enabled: false, repositories: ['acme/api', 'acme/private'] });
  assert.deepEqual((await github.activity('app-1')).events, [], 'sync is off until the user turns it on');
  assert.equal(client.calls.length, 0);
  github.configure('app-1', { enabled: true });
  const result = await github.activity('app-1');
  assert.deepEqual(result.events.map(event => event.id), ['deployment:acme/api:9', 'run:acme/api:1']);
  assert.equal(result.events[1].deploy, true);
  assert.equal(result.events[1].commit.message, 'Release 3.9.2');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].repository, 'acme/private');
  const calls = client.calls.length;
  await github.activity('app-1');
  assert.equal(client.calls.length, calls);
  await github.activity('app-1', { refresh: true });
  assert.ok(client.calls.length > calls);
});

test('explains a missing resource with the deploy, and only when the application syncs with GitHub', async () => {
  const github = createGithubCicd({ client: fakeClient({ runs: [run(7, 'Deploy', '2026-10-08T08:05:00Z')] }), now: () => GONE_AT });
  const items = [{ resourceId: 'r1', goneSince: new Date(GONE_AT).toISOString(), successors: [] }];
  assert.deepEqual(await github.explainMissing('app-1', items), items);
  github.configure('app-1', { enabled: true, repositories: ['acme/api'] });
  const [explained] = await github.explainMissing('app-1', items);
  assert.equal(explained.cause.event.number, 7);
  assert.equal(explained.cause.event.actor, 'ana');
  assert.equal(explained.cause.source, 'github.cicd');
});

test('delivery metrics: frequency and median lead time from commit to deploy', () => {
  const now = Date.parse('2026-10-10T00:00:00Z');
  const deploy = (at, commitAt) => ({ deploy: true, at, commit: commitAt ? { at: commitAt } : null });
  const metrics = deliveryMetrics([
    deploy('2026-10-08T10:00:00Z', '2026-10-08T08:00:00Z'),
    deploy('2026-10-05T10:00:00Z', '2026-10-05T06:00:00Z'),
    deploy('2026-10-01T10:00:00Z', null),
    deploy('2026-08-01T10:00:00Z', '2026-08-01T09:00:00Z'),
    { deploy: false, at: '2026-10-09T10:00:00Z' },
  ], { days: 30, now });
  assert.deepEqual(metrics, { days: 30, deploys: 3, perWeek: 0.7, leadTimeHours: 3, leadTimeSamples: 2 });
});

test('evidence goes through the extension contract as history, scoped to the missing resource', async () => {
  const apm = new ApmDatabase({ filePath: ':memory:', now: () => GONE_AT });
  const architecture = new ArchitectureDatabase({ filePath: ':memory:' });
  try {
    const application = apm.createApplication({ name: 'Desarrollo' });
    const attached = apm.attachResource(application.id, {
      provider: 'kubernetes', type: 'kubernetes', kind: 'Deployment', key: `${CONTEXT}/backend360/Deployment/attencion-3.9.1`,
      kubeContext: CONTEXT, namespace: 'backend360', name: 'attencion-3.9.1', associationSource: 'architecture',
    }).resource;
    markGone(apm, attached.id, { now: GONE_AT });
    new ApplicationRegistryService({ database: apm, architectureDatabase: architecture }).reconcile(apm.getApplication(application.id));
    const github = createGithubCicd({ apmDatabase: apm, client: fakeClient({ runs: [run(7, 'Deploy', '2026-10-08T08:05:00Z')] }), now: () => GONE_AT });
    const registry = createKuaExtensionRegistry({ apmDatabase: apm, architectureDatabase: architecture, adapters: [github.adapter] });

    // Sync off: no evidence, and the source is still available.
    let result = await registry.queryEvidence({ applicationId: application.id, resourceIds: apm.listRegistryResources(application.id).map(item => item.id) });
    assert.equal(result.sources.find(source => source.id === 'github.cicd').state, 'available');
    assert.equal(result.evidence.filter(item => item.sourceId === 'github.cicd').length, 0);

    github.configure(application.id, { enabled: true, repositories: ['acme/api'] });
    const resourceIds = apm.listRegistryResources(application.id).map(item => item.id);
    result = await registry.queryEvidence({ applicationId: application.id, resourceIds });
    const records = result.evidence.filter(item => item.sourceId === 'github.cicd');
    assert.equal(records.length, 2);
    assert.ok(records.every(record => record.class === 'history' && record.reference.uri.startsWith('https://github.com/')));
    const scoped = records.find(record => record.scope.resourceId);
    assert.ok(resourceIds.includes(scoped.scope.resourceId));
    assert.match(scoped.summary, /Probably replaced attencion-3.9.1/);
    assert.equal(apm.listRegistryResources(application.id).length, resourceIds.length, 'evidence never changes membership');
  } finally {
    apm.close();
    architecture.close();
  }
});

test('sync settings persist per computer and list the repositories of the gh account', async () => {
  const files = new Map();
  const fileSystem = { readFileSync: file => { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); }, mkdirSync() {}, writeFileSync: (file, data) => files.set(file, data) };
  const client = { ...fakeClient(), availableRepositories: async () => [{ nameWithOwner: 'acme/api' }, { nameWithOwner: 'acme/web' }], organizations: async () => [{ login: 'acme' }], searchRepositories: async () => [{ fullName: 'acme/api' }] };
  const first = createGithubCicd({ dataDir: '/data', client, fileSystem });
  first.configure('app-1', { enabled: true, repositories: ['acme/api'] });
  const second = createGithubCicd({ dataDir: '/data', client, fileSystem });
  assert.deepEqual(second.settings('app-1'), { enabled: true, repositories: ['acme/api'] });
  assert.deepEqual(second.settings('other'), { enabled: false, repositories: [] });
  assert.deepEqual(await second.availableRepositories({ owner: 'acme' }), ['acme/api', 'acme/web']);
  assert.deepEqual(await second.owners(), ['octocat', 'acme']);
  await assert.rejects(second.availableRepositories({ owner: '--web' }), { code: 'INVALID_OWNER' });
  await assert.rejects(second.availableRepositories({ query: 'ab' }), { code: 'INVALID_QUERY' });
  await assert.rejects(second.availableRepositories({ query: '--web' }), { code: 'INVALID_QUERY' });
  assert.deepEqual(await second.availableRepositories({ query: 'api' }), ['acme/api']);
  second.configure('app-1', { enabled: false, repositories: [] });
  assert.deepEqual(createGithubCicd({ dataDir: '/data', client, fileSystem }).settings('app-1'), { enabled: false, repositories: [] });
  assert.throws(() => second.configure('app-1', { repositories: ['nope'] }), { code: 'INVALID_REPOSITORY' });
});
