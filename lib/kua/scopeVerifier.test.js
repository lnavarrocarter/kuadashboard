'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createScopeVerifier } = require('./scopeVerifier');

const now = () => Date.UTC(2026, 9, 6, 12);
const verifier = createScopeVerifier({
  now,
  resolvers: {
    async aws(profileId) {
      if (profileId === 'expired') throw new Error('The security token included in the request is expired');
      return { identity: profileId === 'prod' ? '111111111111' : '222222222222' };
    },
    async vercel() { return { identity: null }; },
    async kubernetes(profileId) {
      if (profileId !== 'eks-prod') throw new Error(`Kube context not found: ${profileId}`);
      return { identity: profileId, anyScope: true };
    },
  },
});

test('a profile reaching the scope account is verified', async () => {
  const result = await verifier.verify({ provider: 'aws', scopeId: '111111111111', location: 'us-east-1' }, 'prod');
  assert.equal(result.status, 'verified');
  assert.equal(result.verifiedIdentity, '111111111111');
  assert.equal(result.completedScopeId, undefined);
});

test('a profile reaching another account is a mismatch', async () => {
  const result = await verifier.verify({ provider: 'aws', scopeId: '111111111111' }, 'dev');
  assert.equal(result.status, 'mismatch');
  assert.match(result.lastError, /222222222222/);
});

test('a scope without account is completed by the verified identity', async () => {
  const result = await verifier.verify({ provider: 'aws', scopeId: '' }, 'prod');
  assert.equal(result.status, 'verified');
  assert.equal(result.completedScopeId, '111111111111');
});

test('a failed read leaves the binding unverified, never a mismatch', async () => {
  const result = await verifier.verify({ provider: 'aws', scopeId: '111111111111' }, 'expired');
  assert.equal(result.status, 'unverified');
  assert.match(result.lastError, /expired/);
});

test('a profile that names no team, or a provider without verification, stays unverified', async () => {
  assert.equal((await verifier.verify({ provider: 'vercel', scopeId: 'team_1' }, 'token')).status, 'unverified');
  const plugin = await verifier.verify({ provider: 'zabbix', scopeId: 'noc' }, 'any');
  assert.equal(plugin.status, 'unverified');
  assert.match(plugin.lastError, /No verification for provider zabbix/);
});

test('any existing kube context verifies a Kubernetes scope, since context names differ between computers', async () => {
  assert.equal((await verifier.verify({ provider: 'kubernetes', scopeId: 'prod-cluster' }, 'eks-prod')).status, 'verified');
  assert.equal((await verifier.verify({ provider: 'kubernetes', scopeId: 'prod-cluster' }, 'missing')).status, 'unverified');
});
