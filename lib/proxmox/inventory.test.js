'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProxmoxInventory } = require('./inventory');

const NOW = Date.parse('2026-10-28T12:00:00Z');
const at = iso => Date.parse(iso) / 1000;

// Answers of a three-node cluster, as /api2/json returns them.
const CLUSTER = {
  '/cluster/status': [
    { type: 'cluster', name: 'homelab', quorate: 1, nodes: 3, version: 5 },
    { type: 'node', name: 'pve1', online: 1, ip: '10.0.0.11' },
    { type: 'node', name: 'pve2', online: 1, ip: '10.0.0.12' },
    { type: 'node', name: 'pve3', online: 0, ip: '10.0.0.13' },
  ],
  '/nodes': [
    { node: 'pve1', status: 'online', cpu: 0.12, maxcpu: 16, mem: 8e9, maxmem: 32e9, uptime: 86400 },
    { node: 'pve2', status: 'online', cpu: 0.4, maxcpu: 16, mem: 24e9, maxmem: 32e9, uptime: 3600 },
    { node: 'pve3', status: 'offline' },
  ],
  '/nodes/pve1/version': { version: '8.2.4' },
  '/nodes/pve2/version': { version: '8.1.10' },
  '/cluster/resources?type=vm': [
    { id: 'qemu/100', vmid: 100, name: 'web', node: 'pve1', type: 'qemu', status: 'running', cpu: 0.05, maxcpu: 2, mem: 1e9, maxmem: 4e9, tags: 'prod;web', hastate: 'started' },
    { id: 'lxc/101', vmid: 101, name: 'dns', node: 'pve2', type: 'lxc', status: 'running', maxcpu: 1, mem: 2e8, maxmem: 5e8 },
    { id: 'qemu/102', vmid: 102, name: 'lab', node: 'pve2', type: 'qemu', status: 'stopped' },
    { id: 'qemu/9000', vmid: 9000, name: 'ubuntu-template', node: 'pve1', type: 'qemu', status: 'stopped', template: 1 },
  ],
  '/cluster/resources?type=storage': [
    { id: 'storage/pve1/local', storage: 'local', node: 'pve1', plugintype: 'dir', content: 'iso,backup', status: 'available', disk: 90, maxdisk: 100 },
    { id: 'storage/pve1/ceph', storage: 'ceph', node: 'pve1', plugintype: 'rbd', shared: 1, content: 'images', status: 'available', disk: 10, maxdisk: 100 },
  ],
  '/cluster/backup': [
    { id: 'backup-nightly', schedule: '01:00', enabled: 1, storage: 'local', mode: 'snapshot', all: 1, exclude: '102' },
    { id: 'backup-off', schedule: 'sun', enabled: 0, storage: 'local', vmid: '102' },
  ],
  '/cluster/tasks': [
    { upid: 'UPID:pve1:1', node: 'pve1', type: 'vzdump', id: '100', user: 'root@pam', starttime: at('2026-10-28T01:00:00Z'), endtime: at('2026-10-28T01:10:00Z'), status: 'OK' },
    { upid: 'UPID:pve2:2', node: 'pve2', type: 'vzdump', id: '101', user: 'root@pam', starttime: at('2026-10-28T01:20:00Z'), endtime: at('2026-10-28T01:21:00Z'), status: 'job errors' },
    { upid: 'UPID:pve2:3', node: 'pve2', type: 'qmstart', id: '102', user: 'ana@pve', starttime: at('2026-10-26T09:00:00Z'), endtime: at('2026-10-26T09:00:05Z'), status: 'unable to start' },
    { upid: 'UPID:pve1:4', node: 'pve1', type: 'vncproxy', id: '100', user: 'ana@pve', starttime: at('2026-10-28T11:59:00Z') },
  ],
};

function fakeClient(answers, failures = {}) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      if (failures[path]) throw failures[path];
      if (!(path in answers)) throw Object.assign(new Error('Not found in Proxmox'), { kind: 'not_found' });
      return structuredClone(answers[path]);
    },
  };
}

test('a cluster: quorum, nodes with versions, guests, storage, backup coverage and recent tasks', async () => {
  const inventory = await readProxmoxInventory(fakeClient(CLUSTER), { now: () => NOW });
  assert.deepEqual(inventory.scope, { provider: 'proxmox', scopeId: 'homelab', label: 'homelab' });
  assert.deepEqual(inventory.cluster, { name: 'homelab', singleNode: false, quorate: true, available: true });
  assert.deepEqual(inventory.summary, {
    nodes: 3, nodesOnline: 2, vms: 2, containers: 1, running: 2, storageFull: 1, backupJobs: 2, guestsWithoutBackup: 1, failedTasks24h: 1,
  });
  const nodes = inventory.sections.nodes.items;
  assert.deepEqual(nodes.map(node => [node.name, node.version, node.ip]), [['pve1', '8.2.4', '10.0.0.11'], ['pve2', '8.1.10', '10.0.0.12'], ['pve3', null, '10.0.0.13']]);
  assert.equal(nodes[1].memPercent, 75);
  const web = inventory.sections.guests.items.find(guest => guest.vmid === 100);
  assert.deepEqual([web.type, web.tags, web.haState, web.backupJob], ['qemu', ['prod', 'web'], 'started', true]);
  assert.equal(inventory.sections.guests.items.find(guest => guest.vmid === 102).backupJob, false, 'excluded from the only enabled job');
  assert.deepEqual(inventory.sections.storage.items.map(item => [item.storage, item.usedPercent, item.shared]), [['local', 90, false], ['ceph', 10, true]]);
  assert.deepEqual(inventory.sections.backups.items[0], { id: 'backup-nightly', enabled: true, schedule: '01:00', storage: 'local', mode: 'snapshot', node: null, comment: '', all: true, vmids: [], exclude: [102] });
  const tasks = inventory.sections.tasks.items;
  assert.deepEqual(tasks.map(task => task.state), ['running', 'error', 'ok', 'error'], 'newest first');
  assert.equal(tasks[1].message, 'job errors');
});

test('a single node without a cluster is named after the node', async () => {
  const single = {
    ...CLUSTER,
    '/cluster/status': [{ type: 'node', name: 'pve', online: 1, local: 1 }],
    '/nodes': [{ node: 'pve', status: 'online', maxcpu: 4, mem: 1, maxmem: 4 }],
    '/nodes/pve/version': { version: '8.2.4' },
  };
  const inventory = await readProxmoxInventory(fakeClient(single), { now: () => NOW });
  assert.deepEqual(inventory.cluster, { name: 'pve', singleNode: true, quorate: true, available: true });
  assert.equal(inventory.scope.scopeId, 'pve');
  assert.equal(inventory.summary.nodes, 1);
});

test('a section the token cannot read is unavailable and the rest is still read', async () => {
  const forbidden = Object.assign(new Error('The API token has no permission for this path'), { kind: 'forbidden' });
  const client = fakeClient(CLUSTER, { '/cluster/backup': forbidden, '/cluster/tasks': forbidden, '/nodes/pve2/version': forbidden });
  const inventory = await readProxmoxInventory(client, { now: () => NOW });
  assert.equal(inventory.sections.backups.available, false);
  assert.equal(inventory.sections.backups.reason, 'forbidden');
  assert.equal(inventory.summary.backupJobs, null, 'unknown is not zero');
  assert.equal(inventory.summary.guestsWithoutBackup, null);
  assert.equal(inventory.summary.failedTasks24h, null);
  assert.equal(inventory.sections.guests.items[0].backupJob, null);
  assert.equal(inventory.summary.vms, 2);
  assert.equal(inventory.sections.nodes.items[1].version, null);
});

test('nothing readable: every section says why and no scope is invented', async () => {
  const down = Object.assign(new Error('Proxmox is not reachable'), { kind: 'unreachable' });
  const failures = Object.fromEntries(Object.keys(CLUSTER).map(path => [path, down]));
  const inventory = await readProxmoxInventory(fakeClient({}, failures), { now: () => NOW });
  assert.equal(inventory.scope, null);
  assert.equal(inventory.cluster.available, false);
  assert.equal(inventory.cluster.quorate, null);
  assert.ok(Object.values(inventory.sections).every(item => item.available === false && item.reason === 'unreachable'));
  assert.ok(Object.values(inventory.summary).every(value => value === null));
});
