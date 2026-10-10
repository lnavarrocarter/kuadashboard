'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapFirewall, mapRoute, byPriority } = require('./gcpNetwork');

test('maps an ingress allow rule with its ranges, tags and ports', () => {
  const rule = mapFirewall({
    name: 'allow-ssh', direction: 'INGRESS', priority: 1000,
    allowed: [{ IPProtocol: 'tcp', ports: ['22'] }],
    sourceRanges: ['0.0.0.0/0'], targetTags: ['bastion'], logConfig: { enable: true },
  });
  assert.deepEqual(rule.protocols, [{ protocol: 'tcp', ports: ['22'] }]);
  assert.equal(rule.action, 'allow');
  assert.deepEqual(rule.sourceRanges, ['0.0.0.0/0']);
  assert.deepEqual(rule.targetTags, ['bastion']);
  assert.equal(rule.allInstances, false);
  assert.equal(rule.logging, true);
  assert.equal(rule.disabled, false);
});

test('a deny egress rule without targets applies to every instance', () => {
  const rule = mapFirewall({ name: 'deny-all-out', direction: 'EGRESS', priority: 65534, denied: [{ IPProtocol: 'all' }], destinationRanges: ['0.0.0.0/0'], disabled: true });
  assert.equal(rule.action, 'deny');
  assert.equal(rule.direction, 'EGRESS');
  assert.deepEqual(rule.protocols, [{ protocol: 'all', ports: [] }]);
  assert.equal(rule.allInstances, true);
  assert.equal(rule.disabled, true);
});

test('names the next hop of a route and marks the routes GCP creates', () => {
  const internet = mapRoute({ name: 'default-route', destRange: '0.0.0.0/0', priority: 1000, nextHopGateway: 'projects/p/global/gateways/default-internet-gateway', routeType: 'STATIC' });
  assert.deepEqual(internet.nextHop, { kind: 'gateway', value: 'default-internet-gateway' });
  assert.equal(internet.system, false);
  const subnet = mapRoute({ name: 'subnet-route', destRange: '10.0.0.0/24', priority: 0, nextHopNetwork: 'projects/p/global/networks/main', routeType: 'SUBNET' });
  assert.deepEqual(subnet.nextHop, { kind: 'network', value: 'main' });
  assert.equal(subnet.system, true);
  assert.deepEqual(mapRoute({ name: 'x', nextHopIp: '10.0.0.5' }).nextHop, { kind: 'ip', value: '10.0.0.5' });
  assert.deepEqual(mapRoute({ name: 'y' }).nextHop, { kind: 'unknown', value: '' });
});

test('sorts by priority, the lowest number first', () => {
  const sorted = [{ name: 'b', priority: 1000 }, { name: 'a', priority: 1000 }, { name: 'c', priority: 10 }].sort(byPriority);
  assert.deepEqual(sorted.map(item => item.name), ['c', 'a', 'b']);
});
