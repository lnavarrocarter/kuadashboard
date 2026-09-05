'use strict';

const { resolveGcpAuth, gcpFetch } = require('../../routes/gcp');
const { stableNodeId } = require('./cloudDiscoveryService');

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

function createGcpDiscoveryReader({ resolveAuth = resolveGcpAuth, fetchJson = gcpFetch, createRunClient = auth => {
  const { ServicesClient } = require('@google-cloud/run').v2;
  return new ServicesClient({ auth });
} } = {}) {
  return {
    async preview({ profileId }) {
      const authCtx = await resolveAuth(profileId);
      const { auth, projectId } = authCtx;
      if (!projectId) throw Object.assign(new Error('GCP_PROJECT_ID is required'), { statusCode: 400 });
      const sourceId = `gcp:project:${projectId}`;
      const source = { id: sourceId, type: 'gcp_inventory', provider: 'gcp', projectId, name: projectId, readOnly: true };
      const scope = { id: `gcp:${projectId}`, provider: 'gcp', profileId, projectId, accountId: projectId, region: 'global' };
      const [runClient, functionsData] = await Promise.all([
        createRunClient(auth),
        fetchJson(`https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/-/functions`, authCtx),
      ]);
      const [services] = await runClient.listServices({ parent: `projects/${projectId}/locations/-` });
      const nodes = [];
      for (const service of services || []) {
        const parts = String(service.name || '').split('/');
        const location = parts[3] || 'global';
        const name = parts[5] || service.name;
        nodes.push(resourceNode({
          projectId, resourceType: 'gcp-cloud-run', name, location, nativeId: service.name,
          sourceId,
          details: { uri: service.uri || null, status: service.reconciling ? 'reconciling' : 'ready', minInstances: service.template?.scaling?.minInstanceCount ?? 0, maxInstances: service.template?.scaling?.maxInstanceCount ?? null },
        }));
      }
      for (const fn of functionsData.functions || []) {
        const parts = String(fn.name || '').split('/');
        const location = parts[3] || 'global';
        const name = parts[5] || fn.name;
        nodes.push(resourceNode({
          projectId, resourceType: 'gcp-function', name, location, nativeId: fn.name,
          sourceId,
          details: { uri: fn.serviceConfig?.uri || null, runtime: fn.buildConfig?.runtime || null, state: fn.state || null, trigger: fn.eventTrigger?.eventType ? 'EVENT' : 'HTTPS', updatedAt: fn.updateTime || null },
        }));
      }
      return { scope, sources: [source], nodes, relationships: [], failures: [], estimate: { requests: 2, services: nodes.filter(node => node.resourceType === 'gcp-cloud-run').length, functions: nodes.filter(node => node.resourceType === 'gcp-function').length } };
    },
  };
}

module.exports = { createGcpDiscoveryReader };
