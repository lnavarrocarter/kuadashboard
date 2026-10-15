'use strict';
/**
 * lib/architecture/gcpDiscoveryReader.js
 * GCP resources for the architecture map, from the GCP resource catalog (VMs, disks, GKE, Cloud
 * SQL, buckets, Pub/Sub, Cloud Run, Functions, Firestore, Memorystore, Workflows, Scheduler, Tasks,
 * BigQuery). Like CloudFormation stacks on AWS, a preview can be limited to groups:
 *   - Infrastructure Manager deployments: the resources their latest revision manages
 *   - labels (key=value): what carries them (Terraform sets goog-terraform-provisioned=true)
 * It also draws the relationships the inventory proves: disk → VM and subscription → topic.
 * Only List/Get calls, which Google does not charge for.
 */

const crypto = require('crypto');
const { stableNodeId } = require('./cloudDiscoveryService');
const { listDeployments, listDeploymentResources } = require('./gcpInfraManager');

const MAX_DEPLOYMENTS = 10;
const MAX_NODES = 5000;

function resourceNode({ projectId, resourceType, name, location, nativeId, details, sourceId }) {
  return {
    id: stableNodeId({ provider: 'gcp', scopeId: projectId, location: location || 'global', resourceType, nativeId }),
    name,
    provider: 'gcp',
    accountId: projectId,
    projectId,
    region: location || 'global',
    location: location || 'global',
    resourceType,
    // Keep kind canonical so discoveryIdentityKeys correlates this node with the APM projection.
    kind: resourceType,
    nativeId,
    discoveryKey: nativeId,
    sourceId,
    manual: false,
    evidence: [{ type: 'gcp_inventory', sourceId, values: [nativeId, name, location, details?.uri].filter(Boolean) }],
    ...details,
  };
}

function edge(source, target, relationType, evidence) {
  const identity = `${source.id}:${target.id}:${relationType}`;
  return {
    id: `suggested:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
    sourceNodeId: source.id, targetNodeId: target.id, relationType, status: 'suggested', confidence: 0.99, evidence: [evidence],
  };
}

/** What the inventory itself proves: a disk attached to a VM, a subscription of a topic. */
function inventoryRelationships(nodes) {
  const byKey = new Map(nodes.map(node => [node.nativeId, node]));
  const vmsByName = new Map();
  for (const node of nodes.filter(item => item.resourceType === 'gcp-compute-instance')) {
    const list = vmsByName.get(node.name) || [];
    list.push(node);
    vmsByName.set(node.name, list);
  }
  const edges = [];
  for (const disk of nodes.filter(item => item.resourceType === 'gcp-disk')) {
    for (const vmName of disk.attachedTo || []) {
      const candidates = vmsByName.get(vmName) || [];
      const vm = candidates.find(item => item.location === disk.location) || (candidates.length === 1 ? candidates[0] : null);
      if (vm) edges.push(edge(disk, vm, 'attached_to', { type: 'gcp_disk_attachment', values: [disk.nativeId, vm.nativeId] }));
    }
  }
  for (const subscription of nodes.filter(item => item.resourceType === 'gcp-pubsub-subscription' && item.topic)) {
    const topic = byKey.get(`projects/${subscription.projectId}/topics/${subscription.topic}`);
    if (topic) edges.push(edge(subscription, topic, 'subscribes_to', { type: 'pubsub_subscription', values: [subscription.nativeId, topic.nativeId] }));
  }
  return edges;
}

function parseLabels(labels = []) {
  return labels.map(String).map(value => {
    const index = value.indexOf('=');
    return index > 0 ? { key: value.slice(0, index), value: value.slice(index + 1) } : { key: value, value: null };
  }).filter(label => label.key);
}

function createGcpDiscoveryReader({
  resolveAuth = profileId => require('../../routes/gcp').resolveGcpAuth(profileId),
  fetchJson = (...args) => require('../../routes/gcp').gcpFetch(...args),
  catalog = null,
} = {}) {
  const catalogOf = () => catalog || (catalog = require('../kua/resourceCatalog/gcp').createGcpResourceCatalog({ resolveAuth, fetchApi: fetchJson }));

  /** Every catalog item of the project (all pages of one snapshot). */
  async function readAll(profileId) {
    let page = await catalogOf().list({ profileId, limit: 500 });
    const items = [...page.items];
    const failures = [...(page.failures || [])];
    while (page.nextCursor && items.length < MAX_NODES) {
      page = await catalogOf().list({ profileId, cursor: page.nextCursor, limit: 500 });
      items.push(...page.items);
    }
    return { project: page.project, items, failures, partialTypes: page.partialTypes || [] };
  }

  async function infraManagerDeployments(authCtx) {
    try {
      return { deployments: await listDeployments(fetchJson, authCtx), status: 'available' };
    } catch (error) {
      const text = String(error?.message || '');
      const status = /SERVICE_DISABLED|has not been used|is disabled/i.test(text) ? 'api_disabled'
        : Number(error?.code) === 403 ? 'access_denied' : 'unavailable';
      return { deployments: [], status };
    }
  }

  return {
    /**
     * The groups a preview can be limited to, like CloudFormation stacks: Infrastructure Manager
     * deployments and the labels found on the project's resources (with how many carry each).
     */
    async groups({ profileId }) {
      const authCtx = await resolveAuth(profileId);
      if (!authCtx?.projectId) throw Object.assign(new Error('GCP_PROJECT_ID is required'), { statusCode: 400 });
      const [infra, inventory] = await Promise.all([infraManagerDeployments(authCtx), readAll(profileId)]);
      const counts = new Map();
      for (const item of inventory.items) {
        for (const [key, value] of Object.entries(item.labels || {})) {
          const label = `${key}=${value}`;
          counts.set(label, (counts.get(label) || 0) + 1);
        }
      }
      const labels = [...counts].map(([label, count]) => {
        const index = label.indexOf('=');
        return { key: label.slice(0, index), value: label.slice(index + 1), count };
      }).sort((left, right) => right.count - left.count || `${left.key}=${left.value}`.localeCompare(`${right.key}=${right.value}`));
      return {
        projectId: authCtx.projectId,
        infraManager: infra.status,
        deployments: infra.deployments,
        labels,
        total: inventory.items.length,
        failures: inventory.failures,
      };
    },

    async preview({ profileId, deployments = [], labels = [] }) {
      const authCtx = await resolveAuth(profileId);
      const projectId = authCtx?.projectId;
      if (!projectId) throw Object.assign(new Error('GCP_PROJECT_ID is required'), { statusCode: 400 });
      const selectedDeployments = [...new Set((Array.isArray(deployments) ? deployments : []).map(String).filter(Boolean))];
      if (selectedDeployments.length > MAX_DEPLOYMENTS) throw Object.assign(new Error(`Choose at most ${MAX_DEPLOYMENTS} deployments`), { statusCode: 400 });
      const selectedLabels = parseLabels(Array.isArray(labels) ? labels : []);
      const sourceId = `gcp:project:${projectId}`;
      const source = { id: sourceId, type: 'gcp_inventory', provider: 'gcp', projectId, name: projectId, readOnly: true };
      const scope = { id: `gcp:${projectId}`, provider: 'gcp', profileId, projectId, accountId: projectId, region: 'global' };

      const inventory = await readAll(profileId);
      let items = inventory.items;
      const unmapped = [];
      const groups = [];
      let requests = 0;
      // Deployments: the resources their latest revision manages; labels: what carries any of them.
      if (selectedDeployments.length) {
        const { deployments: known } = await infraManagerDeployments(authCtx);
        const wanted = new Set();
        for (const id of selectedDeployments) {
          const deployment = known.find(item => item.id === id || item.name === id);
          if (!deployment) throw Object.assign(new Error(`Infrastructure Manager deployment not found: ${id}`), { statusCode: 404, code: 'DEPLOYMENT_NOT_FOUND' });
          const resources = await listDeploymentResources(fetchJson, authCtx, deployment);
          requests += 1;
          groups.push({ type: 'deployment', id: deployment.id, name: deployment.name, resources: resources.length });
          for (const resource of resources) {
            const mapped = resource.keys.filter(key => items.some(item => item.key === key));
            mapped.forEach(key => wanted.add(key));
            // IAM bindings, service accounts, networks…: managed by the deployment but not in the catalog.
            if (!mapped.length) unmapped.push({ deployment: deployment.name, address: resource.address, terraformType: resource.terraformType });
          }
        }
        items = items.filter(item => wanted.has(item.key));
      }
      if (selectedLabels.length) {
        items = items.filter(item => selectedLabels.some(label => Object.prototype.hasOwnProperty.call(item.labels || {}, label.key)
          && (label.value === null || String(item.labels[label.key]) === label.value)));
        groups.push(...selectedLabels.map(label => ({ type: 'label', id: label.value === null ? label.key : `${label.key}=${label.value}` })));
      }

      const nodes = items.map(item => resourceNode({
        projectId, resourceType: item.type, name: item.name, location: item.location, nativeId: item.key, sourceId,
        details: { ...item.details, ...(Object.keys(item.labels || {}).length ? { labels: item.labels } : {}) },
      }));
      return {
        scope,
        sources: [source],
        nodes,
        relationships: inventoryRelationships(nodes),
        failures: inventory.failures.map(failure => ({ source: failure.type, code: failure.code })),
        groups,
        unmapped,
        estimate: { infraManagerRequests: requests, resources: nodes.length, partialTypes: inventory.partialTypes },
      };
    },
  };
}

module.exports = { createGcpDiscoveryReader, inventoryRelationships, parseLabels };
