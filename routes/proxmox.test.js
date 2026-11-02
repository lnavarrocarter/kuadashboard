'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createProxmoxRouter, resolveProxmoxProfile } = require('./proxmox');

async function serve(options) {
  const app = express();
  app.use('/api/cloud/proxmox', createProxmoxRouter(options));
  const server = await new Promise(resolve => { const instance = app.listen(0, () => resolve(instance)); });
  const request = async (path, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cloud/proxmox${path}`, { headers });
    return { status: response.status, body: await response.json() };
  };
  return { request, close: () => new Promise(resolve => server.close(resolve)) };
}

const inventoryOf = (available = true) => ({
  scope: available ? { provider: 'proxmox', scopeId: 'homelab', label: 'homelab' } : null,
  cluster: { name: available ? 'homelab' : null, singleNode: false, quorate: available || null, available, ...(available ? {} : { reason: 'tls' }) },
  summary: {},
  sections: Object.fromEntries(['nodes', 'guests', 'storage', 'backups', 'tasks'].map(name => [name, available
    ? { available: true, items: [] }
    : { available: false, reason: 'tls', error: 'The server certificate does not match the pinned fingerprint', fingerprint: 'EE:FF', items: [] }])),
});

test('profiles need the URL, the token id and the secret, and never return the secret', async () => {
  const store = keys => ({ getRawKeys: async id => (id === 'p1' ? keys : null) });
  await assert.rejects(resolveProxmoxProfile('', store({})), { kind: 'invalid_profile' });
  await assert.rejects(resolveProxmoxProfile('missing', store({})), { kind: 'not_found' });
  await assert.rejects(resolveProxmoxProfile('p1', store({ PROXMOX_URL: 'https://pve:8006' })), /PROXMOX_TOKEN_ID/);
  const profile = await resolveProxmoxProfile('p1', store({ PROXMOX_URL: 'https://pve:8006', PROXMOX_TOKEN_ID: 'kua@pve!ro', PROXMOX_TOKEN_SECRET: 's3cret', PROXMOX_TLS_FINGERPRINT: 'AB' }));
  assert.deepEqual(profile, { url: 'https://pve:8006', tokenId: 'kua@pve!ro', tokenSecret: 's3cret', fingerprint: 'AB', ca: null });
});

test('the inventory is read with the profile, cached 30 s, and read again on refresh', async () => {
  let clock = 1_000_000;
  const reads = [];
  const subject = await serve({
    resolveProfile: async id => ({ url: 'https://pve:8006', tokenId: 'kua@pve!ro', tokenSecret: 'never-shown', profileId: id }),
    createClient: profile => ({ profile }),
    readInventory: async client => { reads.push(client.profile.profileId); return inventoryOf(true); },
    now: () => clock,
  });
  try {
    const first = await subject.request('/inventory', { 'X-Profile-Id': 'p1' });
    assert.equal(first.status, 200);
    assert.equal(first.body.cluster.name, 'homelab');
    assert.ok(!JSON.stringify(first.body).includes('never-shown'));
    assert.equal((await subject.request('/inventory', { 'X-Profile-Id': 'p1' })).body.cached, true);
    await subject.request('/inventory?refresh=1', { 'X-Profile-Id': 'p1' });
    clock += 31_000;
    await subject.request('/inventory', { 'X-Profile-Id': 'p1' });
    assert.deepEqual(reads, ['p1', 'p1', 'p1']);
  } finally { await subject.close(); }
});

test('nothing readable answers the reason; a bad profile is a 400; the certificate is read on its own', async () => {
  const subject = await serve({
    resolveProfile: async id => { if (id === 'bad') throw Object.assign(new Error('The Proxmox URL must use https'), { kind: 'invalid_profile' }); return {}; },
    createClient: () => ({}),
    readInventory: async () => inventoryOf(false),
    readCertificate: async url => { if (!url) throw Object.assign(new Error('The Proxmox URL is not valid'), { kind: 'invalid_profile' }); return { fingerprint: 'AB:CD', subject: 'pve' }; },
  });
  try {
    const denied = await subject.request('/inventory', { 'X-Profile-Id': 'p1' });
    assert.deepEqual([denied.status, denied.body.code, denied.body.fingerprint], [502, 'tls', 'EE:FF']);
    assert.equal((await subject.request('/inventory', { 'X-Profile-Id': 'bad' })).status, 400);
    assert.deepEqual((await subject.request('/fingerprint?url=https%3A%2F%2Fpve%3A8006')).body, { fingerprint: 'AB:CD', subject: 'pve' });
    assert.equal((await subject.request('/fingerprint')).status, 400);
  } finally { await subject.close(); }
});
