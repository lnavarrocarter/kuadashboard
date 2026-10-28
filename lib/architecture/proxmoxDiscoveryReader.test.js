'use strict';
// Proxmox VE in Architecture and KUApps (#195).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readProxmoxInventory } = require('../proxmox/inventory');
const { createProxmoxDiscoveryReader } = require('./proxmoxDiscoveryReader');
const { apmProjectionFromNode, canonicalFromApm, canonicalFromNode } = require('../kua/applicationRegistryService');
const { ApmDatabase } = require('../apm/database');

const SECRET = '11111111-2222-3333-4444-555555555555';
const PROFILE = { url: 'https://pve1:8006', tokenId: 'kua@pve!audit', tokenSecret: SECRET, fingerprint: 'AA:BB', ca: null };
const CLUSTER = {
  '/cluster/status': [{ type: 'cluster', name: 'homelab', quorate: 1 }, { type: 'node', name: 'pve1', ip: '10.0.0.11' }, { type: 'node', name: 'pve2', ip: '10.0.0.12' }],
  '/nodes': [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }],
  '/nodes/pve1/version': { version: '8.2.4' },
  '/nodes/pve2/version': { version: '8.1.10' },
  '/cluster/resources?type=vm': [
    { id: 'qemu/100', vmid: 100, name: 'web', node: 'pve1', type: 'qemu', status: 'running', tags: 'prod' },
    { id: 'lxc/101', vmid: 101, name: 'dns', node: 'pve2', type: 'lxc', status: 'running' },
    { id: 'qemu/9000', vmid: 9000, name: 'ubuntu-template', node: 'pve1', type: 'qemu', status: 'stopped', template: 1 },
  ],
  '/cluster/resources?type=storage': [{ id: 'storage/pve1/local', storage: 'local', node: 'pve1', plugintype: 'dir', disk: 90, maxdisk: 100 }],
  '/cluster/backup': [],
  '/cluster/tasks': [],
};

function reader(answers = CLUSTER, failures = {}) {
  return createProxmoxDiscoveryReader({
    resolveProfile: async profileId => { assert.equal(profileId, 'proxmox:lab'); return PROFILE; },
    createClient: profile => {
      assert.equal(profile.tokenSecret, SECRET);
      return {
        async get(path) {
          if (failures[path]) throw failures[path];
          if (!(path in answers)) throw Object.assign(new Error('Not found'), { kind: 'not_found' });
          return structuredClone(answers[path]);
        },
      };
    },
    readInventory: readProxmoxInventory,
  });
}

test('nodes, guests and storage of the cluster become resources of proxmox:<cluster>, each guest running on its node', async () => {
  const preview = await reader().preview({ profileId: 'proxmox:lab' });
  assert.deepEqual(preview.scope, { id: 'proxmox:homelab', provider: 'proxmox', profileId: 'proxmox:lab', scopeId: 'homelab', region: '' });
  assert.deepEqual(preview.nodes.map(node => [node.resourceType, node.nativeId, node.name]), [
    ['proxmox-node', 'homelab/node/pve1', 'pve1'],
    ['proxmox-node', 'homelab/node/pve2', 'pve2'],
    ['proxmox-qemu', 'homelab/qemu/100', 'web'],
    ['proxmox-lxc', 'homelab/lxc/101', 'dns'],
    ['proxmox-storage', 'homelab/storage/pve1/local', 'local (pve1)'],
  ], 'templates are left out');
  assert.ok(preview.nodes.every(node => node.provider === 'proxmox' && node.accountId === 'homelab' && node.kind === node.resourceType));
  const byKey = new Map(preview.nodes.map(node => [node.nativeId, node.id]));
  assert.deepEqual(preview.relationships.map(edge => [edge.sourceNodeId, edge.relationType, edge.targetNodeId]), [
    [byKey.get('homelab/qemu/100'), 'runs_on', byKey.get('homelab/node/pve1')],
    [byKey.get('homelab/lxc/101'), 'runs_on', byKey.get('homelab/node/pve2')],
  ]);
  assert.deepEqual(preview.failures, []);
  assert.equal(preview.estimate.cost, 'none');
  assert.equal(JSON.stringify(preview).includes(SECRET), false, 'the token secret is in no id, key or evidence');
});

test('a section the token cannot read is a named failure, and nothing readable says why', async () => {
  const forbidden = Object.assign(new Error('Permission check failed'), { kind: 'forbidden' });
  const partial = await reader(CLUSTER, { '/cluster/resources?type=storage': forbidden }).preview({ profileId: 'proxmox:lab' });
  assert.equal(partial.nodes.some(node => node.resourceType === 'proxmox-storage'), false);
  assert.deepEqual(partial.failures, [{ section: 'storage', reason: 'forbidden', message: 'Permission check failed' }]);

  const invalid = Object.assign(new Error('authentication failure'), { kind: 'invalid_token' });
  const everything = Object.fromEntries(Object.keys(CLUSTER).map(path => [path, invalid]));
  await assert.rejects(reader(CLUSTER, everything).preview({ profileId: 'proxmox:lab' }), error => error.statusCode === 401 && /authentication failure/.test(error.message));
});

test('an imported Proxmox VM joins a KUA Application with its own provider and cluster scope', async () => {
  const preview = await reader().preview({ profileId: 'proxmox:lab' });
  const vm = preview.nodes.find(node => node.resourceType === 'proxmox-qemu');
  const application = { id: 'app-1', provider: 'generic', profileId: '' };
  const projection = apmProjectionFromNode(application, vm);
  assert.deepEqual([projection.provider, projection.type, projection.key, projection.scopeId, projection.location], ['proxmox', 'proxmox-qemu', 'homelab/qemu/100', 'homelab', '']);

  const database = new ApmDatabase({ filePath: ':memory:' });
  try {
    const app = database.createApplication({ name: 'Homelab web' });
    const { resource } = database.attachResource(app.id, { ...projection, associationSource: 'architecture' });
    assert.equal(resource.provider, 'proxmox');
    const fromApm = canonicalFromApm(database.getApplication(app.id), resource);
    const fromNode = canonicalFromNode({ profileId: '' }, vm);
    assert.equal(fromApm.identityKey, fromNode.identityKey, 'the APM resource and the Architecture node are the same resource');
  } finally { database.close(); }
});
