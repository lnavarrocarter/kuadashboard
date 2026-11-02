'use strict';
/**
 * lib/architecture/proxmoxDiscoveryReader.js
 * Proxmox VE in Architecture and KUApps (#195): the nodes, QEMU VMs, LXC containers and storage of
 * a cluster (or a single node) as discovered resources of the scope `proxmox:<cluster>`, with each
 * guest running on its node. One inventory read (lib/proxmox/inventory.js), on the local network:
 * no cloud cost. Templates are not resources an application runs on, so they are left out.
 *
 * Keys carry the cluster name (`<cluster>/qemu/101`): vmids and node names repeat across clusters.
 * The token secret is never part of a key, a scope or an evidence value.
 */

const { createProxmoxClient } = require('../proxmox/client');
const { readProxmoxInventory } = require('../proxmox/inventory');
const { stableNodeId } = require('./cloudDiscoveryService');

const GUEST_TYPES = { qemu: 'proxmox-qemu', lxc: 'proxmox-lxc' };

function relationship(source, target, relationType, sourceId) {
  return {
    id: `proxmox:${source.id}:${relationType}:${target.id}`,
    sourceNodeId: source.id,
    targetNodeId: target.id,
    relationType,
    status: 'suggested',
    confidence: 0.99,
    evidence: [{ type: 'proxmox_inventory', sourceId, values: [source.discoveryKey, target.discoveryKey] }],
  };
}

/** The preview of one inventory: { scope, sources, nodes, relationships, failures, estimate }. */
function discoveryFromInventory(inventory, { profileId }) {
  const cluster = inventory?.cluster?.name;
  if (!cluster) {
    // Nothing could be read (wrong token, TLS, host down): the reason of the first failed section.
    const failed = Object.values(inventory?.sections || {}).find(section => section?.available === false) || {};
    throw Object.assign(new Error(failed.error || 'Proxmox did not name its cluster or node; check the token can read /cluster/status or /nodes'), { kind: failed.reason, ...(failed.fingerprint ? { fingerprint: failed.fingerprint } : {}) });
  }
  const sourceId = `proxmox:cluster:${cluster}`;
  const source = { id: sourceId, type: 'proxmox_inventory', provider: 'proxmox', name: cluster, readOnly: true };
  const scope = { id: `proxmox:${cluster}`, provider: 'proxmox', profileId, scopeId: cluster, region: '' };
  const node = (resourceType, key, name, details = {}) => ({
    id: stableNodeId({ provider: 'proxmox', scopeId: cluster, location: 'cluster', resourceType, nativeId: key }),
    name,
    provider: 'proxmox',
    accountId: cluster,
    region: '',
    resourceType,
    // Keep kind canonical so discoveryIdentityKeys correlates this node with the APM projection.
    kind: resourceType,
    nativeId: key,
    discoveryKey: key,
    sourceId,
    manual: false,
    evidence: [{ type: 'proxmox_inventory', sourceId, values: [key, name] }],
    ...details,
  });

  const { nodes = {}, guests = {}, storage = {} } = inventory.sections || {};
  const hostNodes = (nodes.items || []).map(item => node('proxmox-node', `${cluster}/node/${item.name}`, item.name, { status: item.status, version: item.version || null }));
  const hostByName = new Map(hostNodes.map(item => [item.name, item]));
  const guestNodes = (guests.items || []).filter(guest => !guest.template).map(guest => node(GUEST_TYPES[guest.type], `${cluster}/${guest.type}/${guest.vmid}`, guest.name, {
    vmid: guest.vmid, node: guest.node, status: guest.status, tags: guest.tags || [], haState: guest.haState || null, backupJob: guest.backupJob ?? null,
  }));
  const storageNodes = (storage.items || []).map(item => node('proxmox-storage', `${cluster}/storage/${item.node}/${item.storage}`, `${item.storage} (${item.node})`, {
    node: item.node, storageType: item.type, shared: !!item.shared, usedPercent: item.usedPercent ?? null,
  }));

  const relationships = [];
  for (const guest of guestNodes) {
    const host = hostByName.get(guest.node);
    if (host) relationships.push(relationship(guest, host, 'runs_on', sourceId));
  }
  // A section the token cannot read is named, so the preview never looks like "nothing there".
  const failures = Object.entries({ nodes, guests, storage })
    .filter(([, section]) => section && section.available === false)
    .map(([section, value]) => ({ section, reason: value.reason, message: value.error }));

  return {
    scope,
    sources: [source],
    nodes: [...hostNodes, ...guestNodes, ...storageNodes],
    relationships,
    failures,
    estimate: { requests: 6 + hostNodes.length, cost: 'none', nodes: hostNodes.length, guests: guestNodes.length, storage: storageNodes.length },
  };
}

function createProxmoxDiscoveryReader({
  resolveProfile = (...args) => require('../../routes/proxmox').resolveProxmoxProfile(...args),
  createClient = createProxmoxClient,
  readInventory = readProxmoxInventory,
} = {}) {
  return {
    async preview({ profileId }) {
      try {
        return discoveryFromInventory(await readInventory(createClient(await resolveProfile(profileId))), { profileId });
      } catch (error) {
        const { STATUS_BY_KIND } = require('../../routes/proxmox');
        throw Object.assign(error, { statusCode: error.statusCode || STATUS_BY_KIND[error.kind] || 502 });
      }
    },
  };
}

module.exports = { createProxmoxDiscoveryReader, discoveryFromInventory };
