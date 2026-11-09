'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readProxmoxTelemetry, rrdPath } = require('./telemetry');

const inventory = {
  sections: {
    nodes: { available: true, items: [{ name: 'pve 1' }] },
    guests: { available: true, items: [
      { type: 'lxc', vmid: 101, name: 'dns', node: 'pve 1', status: 'running', template: false },
      { type: 'qemu', vmid: 200, name: 'template', node: 'pve 1', template: true },
    ] },
  },
};

test('uses the node and guest RRD endpoints and normalizes 24 hour metrics', async () => {
  const calls = [];
  const subject = await readProxmoxTelemetry({ async get(path) {
    calls.push(path);
    return [{ time: 1794000000, cpu: 0.25, mem: 50, maxmem: 100, disk: 25, maxdisk: 50, netin: 1200, netout: 600 }];
  } }, inventory, { now: () => 1794000000000 });
  assert.deepEqual(calls, [
    '/nodes/pve%201/rrddata?timeframe=day&cf=AVERAGE',
    '/nodes/pve%201/lxc/101/rrddata?timeframe=day&cf=AVERAGE',
  ]);
  assert.deepEqual(subject.entities.map(item => item.id), ['node/pve 1', 'lxc/101']);
  assert.deepEqual(subject.entities[0].points[0], {
    t: 1794000000000, cpuPercent: 25, memoryPercent: 50, diskPercent: 50, netIn: 1200, netOut: 600,
  });
});

test('persists each metric series under the local Proxmox profile and resource key', async () => {
  const writes = [];
  const history = { retentionDays: 30, write: (key, window) => writes.push({ key, window }) };
  await readProxmoxTelemetry({ async get() { return [{ time: 1794000000, cpu: 0.2, mem: 2, maxmem: 4, disk: 1, maxdisk: 2, netin: 10, netout: 20 }]; } }, inventory, {
    history, profileId: 'profile-local', now: () => 1794000000000,
  });
  assert.equal(writes.length, 10);
  assert.ok(writes.every(write => write.key.provider === 'proxmox' && write.key.profileId === 'profile-local'));
  assert.deepEqual(writes[0].window.points, [{ t: 1794000000000, v: 20 }]);
});

test('one unavailable guest does not hide the rest of the telemetry', async () => {
  const result = await readProxmoxTelemetry({ async get(path) {
    if (path.includes('/lxc/')) throw Object.assign(new Error('no permission'), { kind: 'forbidden' });
    return [{ time: 1794000000, cpu: 0.1 }];
  } }, inventory);
  assert.equal(result.entities[0].available, true);
  assert.equal(result.entities[1].available, false);
  assert.equal(result.entities[1].reason, 'forbidden');
});

test('a stopped guest shows no data instead of zero values', async () => {
  let guestReads = 0;
  const stoppedInventory = { ...inventory, sections: { ...inventory.sections, guests: { available: true, items: [
    { type: 'lxc', vmid: 101, name: 'dns', node: 'pve 1', status: 'stopped', template: false },
  ] } } };
  const result = await readProxmoxTelemetry({ async get(path) {
    if (path.includes('/lxc/')) guestReads += 1;
    return [{ time: 1794000000, cpu: 0, mem: 0, maxmem: 100, disk: 0, maxdisk: 100, netin: 0, netout: 0 }];
  } }, stoppedInventory);
  const guest = result.entities.find(entity => entity.type === 'lxc');
  assert.equal(guestReads, 0);
  assert.equal(guest.available, false);
  assert.equal(guest.reason, 'no_data');
  assert.deepEqual(guest.points, []);
});

test('serves the locally stored series when Proxmox is temporarily unreachable', async () => {
  const history = {
    retentionDays: 30,
    write() {},
    read(key) { return key.metric === 'cpuPercent' ? [{ t: 1794000000000, v: 20 }] : []; },
  };
  const result = await readProxmoxTelemetry({ async get() { throw Object.assign(new Error('offline'), { kind: 'unreachable' }); } }, inventory, {
    history, profileId: 'profile-local', now: () => 1794000000000,
  });
  assert.equal(result.entities[0].available, true);
  assert.equal(result.entities[0].stale, true);
  assert.deepEqual(result.entities[0].points, [{ t: 1794000000000, cpuPercent: 20 }]);
});

test('validates timeframes and encodes path segments', async () => {
  assert.equal(rrdPath({ type: 'qemu', vmid: 10, node: 'pve/one' }, 'month'), '/nodes/pve%2Fone/qemu/10/rrddata?timeframe=month&cf=AVERAGE');
  assert.rejects(() => readProxmoxTelemetry({ get() {} }, inventory, { timeframe: 'invalid' }), { kind: 'invalid_profile' });
});
