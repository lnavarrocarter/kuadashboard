'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adviseVercel, collectVercel } = require('./vercel');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const byId = (report, id) => report.findings.find(f => f.id === id);
const ENDPOINTS = { projects: '/v10/projects', deployments: '/v7/deployments' };

const protectedProject = { id: 'p1', name: 'shop', nodeVersion: '22.x', ssoProtection: { deploymentType: 'preview' }, link: { type: 'github', repo: 'acme/shop' }, targets: { production: { id: 'd0' } } };
const deployment = (uid, state, target, createdAt) => ({ uid, url: `${uid}.vercel.app`, readyState: state, target, createdAt });

test('a well configured project passes every check', () => {
  const report = adviseVercel({
    projects: [protectedProject],
    deployments: { p1: [deployment('d1', 'READY', 'production', 3), deployment('d2', 'READY', null, 2)] },
    envs: { p1: [{ key: 'DATABASE_PASSWORD', type: 'sensitive', target: ['production'] }, { key: 'NEXT_PUBLIC_SITE', type: 'plain', target: ['production', 'preview'] }] },
    domains: { p1: [{ name: 'shop.example.com', verified: true }] },
    teamId: 'team_1',
    now: NOW,
  });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.scope, { provider: 'vercel', teamId: 'team_1' });
  assert.ok(report.summary.security.checks >= 4);
});

test('flags readable secrets, secrets shared with previews and non-sensitive production secrets', () => {
  const report = adviseVercel({
    projects: [protectedProject],
    envs: { p1: [
      { key: 'STRIPE_SECRET_KEY', type: 'plain', target: ['production'] },
      { key: 'API_TOKEN', type: 'encrypted', target: ['production', 'preview'] },
      { key: 'BRANCH_TOKEN', type: 'encrypted', target: ['production', 'preview'], gitBranch: 'staging' },
      { key: 'VERCEL_URL', type: 'system', target: ['production'] },
    ] },
    now: NOW,
  });
  assert.equal(byId(report, 'vercel.plain_secret_env').resources[0].detail, 'STRIPE_SECRET_KEY');
  assert.equal(byId(report, 'vercel.secret_shared_with_preview').resources[0].detail, 'API_TOKEN');
  assert.equal(byId(report, 'vercel.secret_not_sensitive').resources[0].detail, 'API_TOKEN, BRANCH_TOKEN');
});

test('flags unprotected previews, fork builds, paused projects, old Node.js and CLI-only projects', () => {
  const report = adviseVercel({
    projects: [
      { id: 'p2', name: 'blog', nodeVersion: '18.x', gitForkProtection: false, link: { type: 'github', repo: 'acme/blog' } },
      { id: 'p3', name: 'legacy', nodeVersion: '20.x', paused: true, passwordProtection: { deploymentType: 'all' } },
    ],
    now: NOW,
  });
  assert.deepEqual(byId(report, 'vercel.preview_unprotected').resources.map(r => r.name), ['blog']);
  assert.equal(byId(report, 'vercel.fork_protection_off').resources[0].detail, 'acme/blog');
  assert.deepEqual(byId(report, 'vercel.project_paused').resources.map(r => r.name), ['legacy']);
  assert.deepEqual(byId(report, 'vercel.node_deprecated').resources.map(r => r.detail), ['Node.js 18.x', 'Node.js 20.x']);
  assert.deepEqual(byId(report, 'vercel.no_git_link').resources.map(r => r.name), ['legacy']);
});

test('reads deployments: failed production, failure rate, no production and no preview flow', () => {
  const report = adviseVercel({
    projects: [
      { ...protectedProject, id: 'a', name: 'failing' },
      { ...protectedProject, id: 'b', name: 'previews-only', targets: {} },
      { ...protectedProject, id: 'c', name: 'straight-to-prod' },
    ],
    deployments: {
      a: [deployment('a1', 'ERROR', 'production', 5), deployment('a2', 'ERROR', null, 4), deployment('a3', 'READY', 'production', 3), deployment('a4', 'ERROR', null, 2), deployment('a5', 'CANCELED', null, 1)],
      b: [deployment('b1', 'READY', null, 1)],
      c: [1, 2, 3, 4, 5].map(i => deployment(`c${i}`, 'READY', 'production', i)),
    },
    now: NOW,
  });
  assert.equal(byId(report, 'vercel.production_deploy_failed').resources[0].detail, 'a1.vercel.app');
  assert.equal(byId(report, 'vercel.deploy_failure_rate').resources[0].detail, '3/4');
  assert.deepEqual(byId(report, 'vercel.no_production').resources.map(r => r.name), ['previews-only']);
  assert.deepEqual(byId(report, 'vercel.no_preview_flow').resources.map(r => r.name), ['straight-to-prod']);
});

test('lists unverified domains with their project', () => {
  const report = adviseVercel({ projects: [protectedProject], domains: new Map([['p1', [{ name: 'new.example.com', verified: false }]]]), now: NOW });
  assert.deepEqual(byId(report, 'vercel.domain_unverified').resources, [{ kind: 'Domain', name: 'new.example.com', namespace: 'shop' }]);
});

test('skips the checks of a source that could not be read, but not of a partial one', () => {
  const projects = [{ ...protectedProject, nodeVersion: '16.x' }];
  const envs = { p1: [{ key: 'DB_PASSWORD', type: 'plain', target: ['production'] }] };
  const skipped = adviseVercel({ projects, envs, unavailable: [{ source: 'env', error: 'forbidden' }], now: NOW });
  assert.equal(byId(skipped, 'vercel.plain_secret_env'), undefined);
  assert.ok(byId(skipped, 'vercel.node_deprecated'));
  assert.deepEqual(skipped.unavailable, [{ source: 'env', error: 'forbidden' }]);
  const partial = adviseVercel({ projects, envs, unavailable: [{ source: 'env', error: 'timeout', partial: true, action: 'env (1/2 projects)' }], now: NOW });
  assert.ok(byId(partial, 'vercel.plain_secret_env'));
  assert.equal(partial.unavailable[0].action, 'env (1/2 projects)');
});

test('collectVercel reads every project, drops env values and reports partial failures', async () => {
  const calls = [];
  const fetchJson = async path => {
    calls.push(path);
    if (path.startsWith('/v10/projects')) return { projects: [{ id: 'p1' }, { id: 'p2' }] };
    if (path.startsWith('/v7/deployments')) return { deployments: [{ uid: path.includes('p1') ? 'd1' : 'd2' }] };
    if (path.endsWith('/env')) return { envs: [{ key: 'TOKEN', type: 'encrypted', target: ['production'], value: 'ciphertext' }] };
    if (path.includes('p2/domains')) throw new Error('rate limited');
    return { domains: [{ name: 'a.example.com', verified: true }] };
  };
  const collected = await collectVercel({ fetchJson, endpoints: ENDPOINTS, concurrency: 2 });
  assert.equal(calls.length, 7);
  assert.equal(collected.deployments.get('p2')[0].uid, 'd2');
  assert.deepEqual(collected.envs.get('p1'), [{ key: 'TOKEN', type: 'encrypted', target: ['production'], gitBranch: null }]);
  assert.deepEqual(collected.domains.get('p2'), []);
  assert.deepEqual(collected.unavailable, [{ source: 'domains', error: 'rate limited', partial: true, action: 'domains (1/2 projects)' }]);
});

test('collectVercel marks a source unavailable when it fails for every project', async () => {
  const fetchJson = async path => {
    if (path.startsWith('/v10/projects')) return { projects: [{ id: 'p1' }] };
    if (path.endsWith('/env')) throw new Error('forbidden');
    return {};
  };
  const collected = await collectVercel({ fetchJson, endpoints: ENDPOINTS });
  assert.deepEqual(collected.unavailable, [{ source: 'env', error: 'forbidden' }]);
});
