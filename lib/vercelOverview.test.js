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
  }, { now: 100 });

  assert.equal(summary.health, 'critical');
  assert.deepEqual(summary.production, { healthy: 1, failed: 1, failedInactive: 0, building: 0, none: 1 });
  const { windows, ...deployments } = summary.deployments;
  assert.deepEqual(deployments, { total: 4, ready: 1, error: 1, building: 1, canceled: 1, lastAt: 30, failureRate: 50 });
  assert.deepEqual(windows['24h'], { finished: 2, failed: 1, failureRate: 50 });
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

test('activity windows count finished deployments by age', () => {
  const now = Date.UTC(2026, 9, 10);
  const day = 24 * 60 * 60 * 1000;
  const summary = summarizeVercel({
    projects: [{ id: 'a', name: 'shop' }],
    deployments: { a: [
      deployment('d1', 'ERROR', null, now - 2 * 60 * 60 * 1000),
      deployment('d2', 'READY', null, now - 3 * day),
      deployment('d3', 'READY', null, now - 20 * day),
      deployment('d4', 'ERROR', null, now - 200 * day),
      deployment('d5', 'BUILDING', null, now - 60 * 1000),
    ] },
  }, { now });
  assert.deepEqual(summary.deployments.windows, {
    '24h': { finished: 1, failed: 1, failureRate: 100 },
    '7d':  { finished: 2, failed: 1, failureRate: 50 },
    '30d': { finished: 3, failed: 1, failureRate: 33 },
  });
  assert.equal(summary.deployments.failureRate, 50);   // the whole sample, old failure included
});

test('a failing production in a project inactive for 30 days is history, not an incident', () => {
  const now = Date.UTC(2026, 9, 10);
  const old = Date.UTC(2023, 4, 1);
  const summary = summarizeVercel({
    projects: [{ id: 'a', name: 'legacy' }, { id: 'b', name: 'shop', targets: { production: { readyState: 'READY', createdAt: now } } }],
    deployments: { a: [deployment('a1', 'ERROR', 'production', old)] },
  }, { now });
  assert.equal(summary.health, 'degraded');
  assert.equal(summary.production.failed, 0);
  assert.equal(summary.production.failedInactive, 1);
  assert.equal(summary.rows.find(row => row.id === 'a').inactive, true);
  assert.equal(summary.rows.find(row => row.id === 'b').inactive, false);
  assert.equal(summary.deployments.windows['30d'].finished, 0);
});
