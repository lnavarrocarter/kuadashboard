'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeVercel } = require('./vercelOverview');

const deployment = (uid, readyState, target, createdAt) => ({ uid, url: `${uid}.vercel.app`, readyState, target, createdAt });

test('summarizes production, recent deployments, domains and env var types per project', () => {
  const summary = summarizeVercel({
    projects: [
      { id: 'a', name: 'shop', framework: 'nextjs', nodeVersion: '22.x', link: { type: 'github', repo: 'acme/shop' } },
      { id: 'b', name: 'docs', framework: 'nextjs', targets: { production: { readyState: 'READY', url: 'docs.vercel.app', createdAt: 5 } } },
      { id: 'c', name: 'old', paused: true },
    ],
    deployments: new Map([
      ['a', [deployment('a2', 'ERROR', 'production', 20), deployment('a1', 'READY', null, 10), deployment('a0', 'CANCELED', null, 5)]],
      ['b', [deployment('b1', 'BUILDING', null, 30)]],
    ]),
    envs: new Map([['a', [{ key: 'X', type: 'plain' }, { key: 'Y', type: 'sensitive' }, { key: 'Z', type: 'sensitive' }]]]),
    domains: new Map([['a', [{ name: 'shop.com', verified: true }, { name: 'new.shop.com', verified: false }]]]),
  });

  assert.equal(summary.health, 'critical');
  assert.deepEqual(summary.production, { healthy: 1, failed: 1, building: 0, none: 1 });
  assert.deepEqual(summary.deployments, { total: 4, ready: 1, error: 1, building: 1, canceled: 1, lastAt: 30, failureRate: 50 });
  assert.deepEqual(summary.domains, { total: 2, unverified: 1 });
  assert.deepEqual(summary.env, { total: 3, byType: { plain: 1, sensitive: 2 } });
  assert.deepEqual(summary.projects, { total: 3, paused: 1, withGit: 1, frameworks: [{ name: 'nextjs', count: 2 }, { name: 'other', count: 1 }] });
  assert.deepEqual(summary.rows.map(row => row.name), ['docs', 'shop', 'old']);
  const shop = summary.rows.find(row => row.id === 'a');
  assert.deepEqual(shop.production, { state: 'ERROR', url: 'a2.vercel.app', createdAt: 20 });
  assert.deepEqual(shop.recent, { finished: 2, failed: 1 });
  assert.equal(shop.git, 'acme/shop');
  assert.equal(summary.rows.find(row => row.id === 'b').production.url, 'docs.vercel.app');
});

test('health is degraded by paused projects, unverified domains or unread sources, healthy otherwise', () => {
  const project = { id: 'a', name: 'shop', targets: { production: { readyState: 'READY' } } };
  assert.equal(summarizeVercel({ projects: [project] }).health, 'healthy');
  assert.equal(summarizeVercel({ projects: [project], unavailable: [{ source: 'env' }] }).health, 'degraded');
  assert.equal(summarizeVercel({ projects: [project], domains: { a: [{ name: 'x.com', verified: false }] } }).health, 'degraded');
  assert.equal(summarizeVercel({ projects: [] }).deployments.failureRate, null);
});
