'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROXMOX_PLUGIN_ID, VERCEL_PLUGIN_ID, proxmoxPlugin, vercelPlugin } = require('./builtinPlugins');
const { createPluginRegistry } = require('./pluginRegistry');
const { PROVIDERS } = require('../providers');

const profiles = list => ({ listProfiles: async () => list });

test('the Vercel provider of the catalog belongs to the Vercel plugin', () => {
  assert.equal(PROVIDERS.find(provider => provider.id === 'vercel').plugin, VERCEL_PLUGIN_ID);
});

test('Vercel is on by default only where a Vercel profile already exists', async () => {
  const withProfile = createPluginRegistry({ plugins: [vercelPlugin(profiles([{ id: 'p1', provider: 'aws' }, { id: 'p2', provider: 'vercel' }]))] });
  assert.equal(withProfile.isActive('vercel'), true, 'on while the profiles are read');
  await withProfile.ready();
  assert.equal(withProfile.isActive('vercel'), true);

  const without = createPluginRegistry({ plugins: [vercelPlugin(profiles([{ id: 'p1', provider: 'aws' }]))] });
  await without.ready();
  assert.equal(without.isActive('vercel'), false);
});

test('the Vercel plugin declares what it reads, its credentials and that it is free', async () => {
  const registry = createPluginRegistry({ plugins: [vercelPlugin(profiles([{ id: 'p2', provider: 'vercel' }]))] });
  await registry.ready();
  const [{ manifest, status }] = await registry.list();
  assert.equal(manifest.cost.level, 'free');
  assert.deepEqual(manifest.credentialFields.map(field => [field.name, field.secret]), [['VERCEL_API_TOKEN', true], ['VERCEL_TEAM_ID', false]]);
  assert.deepEqual(manifest.resourceTypes, ['vercel-project']);
  assert.equal(manifest.capabilities.findings, true);
  assert.deepEqual(status, { state: 'connected', detail: '1 profile' });
});

test('Proxmox is a plugin that starts off and declares its secret and that it has no cloud cost', async () => {
  assert.equal(PROVIDERS.find(provider => provider.id === 'proxmox').plugin, PROXMOX_PLUGIN_ID);
  const registry = createPluginRegistry({ plugins: [proxmoxPlugin(profiles([{ id: 'p1', provider: 'proxmox' }]))] });
  await registry.ready();
  assert.equal(registry.isActive('proxmox'), false, 'off until the person turns it on');
  const [{ manifest }] = await registry.list();
  assert.deepEqual(manifest.credentialFields.filter(field => field.secret).map(field => field.name), ['PROXMOX_TOKEN_SECRET']);
  assert.equal(manifest.cost.level, 'free');
  await registry.setActive('proxmox', true);
  assert.deepEqual((await registry.list())[0].status, { state: 'connected', detail: '1 profile' });
});
