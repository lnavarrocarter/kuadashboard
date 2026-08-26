'use strict';

const crypto = require('crypto');

function stableId(prefix, value) {
  return `${prefix}:${crypto.createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
}

function canonicalResource(input) {
  const provider = String(input.provider || '').trim().toLowerCase();
  const profileId = String(input.profileId || '').trim();
  const scopeId = String(input.scopeId || '').trim();
  const location = String(input.location || '').trim();
  const nativeIdentifier = String(input.nativeIdentifier || '').trim();
  const resourceType = String(input.resourceType || '').trim().toLowerCase();
  const displayName = String(input.displayName || '').trim();
  if (!provider || !profileId || !nativeIdentifier || !resourceType || !displayName) {
    throw new Error('Canonical resource requires provider, profile, identifier, type and name');
  }
  const identityKey = JSON.stringify([provider, profileId, scopeId, location, resourceType, nativeIdentifier].map(value => value.toLowerCase()));
  return {
    ...input,
    id: stableId('kua-resource', identityKey),
    identityKey,
    provider,
    profileId,
    scopeId,
    location,
    nativeIdentifier,
    resourceType,
    displayName,
  };
}

function awsArnScope(arn) {
  const parts = String(arn || '').split(':');
  return parts[0] === 'arn' && parts[1] === 'aws' ? { scopeId: parts[4] || '', location: parts[3] || '' } : {};
}

function canonicalKubernetesType(resource) {
  if (resource.type !== 'kubernetes') return resource.type;
  const kind = String(resource.kind || '').trim().toLowerCase();
  return {
    deployment: 'deployment', statefulset: 'statefulset', daemonset: 'daemonset', pod: 'pod',
    service: 'service', ingress: 'ingress', configmap: 'configmap', secret: 'secret',
    persistentvolumeclaim: 'pvc', pvc: 'pvc',
  }[kind] || 'kubernetes';
}

function canonicalFromApm(application, resource) {
  const awsScope = resource.provider === 'aws' ? awsArnScope(resource.arn) : {};
  return canonicalResource({
    provider: resource.provider,
    profileId: application.profileId,
    scopeId: awsScope.scopeId || resource.kubeContext || '',
    location: awsScope.location || application.region || '',
    nativeIdentifier: resource.arn || resource.key,
    resourceType: canonicalKubernetesType(resource),
    displayName: resource.name,
    lineage: [{ kind: 'apm_resource', id: resource.id }],
  });
}

function canonicalFromNode(project, node) {
  return canonicalResource({
    provider: node.provider,
    profileId: project.profileId,
    scopeId: node.accountId || node.kubeContext || '',
    location: node.region || node.location || '',
    nativeIdentifier: node.arn || node.nativeId || node.discoveryKey || node.id,
    resourceType: node.resourceType || node.kind || 'resource',
    displayName: node.name,
    lineage: [{ kind: 'architecture_node', id: node.id }],
  });
}

function relationshipId(applicationId, sourceResourceId, targetResourceId, relationType) {
  return stableId('kua-relationship', [applicationId, sourceResourceId, targetResourceId, relationType].join(':'));
}

class ApplicationRegistryService {
  constructor({ database, architectureDatabase }) {
    if (!database || !architectureDatabase) throw new Error('database and architectureDatabase are required');
    this.database = database;
    this.architectureDatabase = architectureDatabase;
  }

  reconcile(application) {
    const resourcesBySource = new Map();
    const apmResources = this.database.listResources(application.id);
    for (const resource of apmResources) {
      const canonical = canonicalFromApm(application, resource);
      const registered = this.database.upsertRegistryResource(canonical);
      this.database.addRegistryMembership({ applicationId: application.id, resourceId: registered.id, sourceKind: 'apm_resource', sourceReference: resource.id });
      resourcesBySource.set(`apm:${resource.id}`, registered);
    }
    this.database.pruneRegistryMemberships(application.id, 'apm_resource', apmResources.map(resource => resource.id));

    const project = application.architectureProjectId ? this.architectureDatabase.getProject(application.architectureProjectId) : null;
    const graph = project?.profileId === application.profileId ? this.architectureDatabase.getGraph(project.id) : null;
    const nodeResourceIds = new Map();
    if (project && graph) {
      for (const node of graph.document.nodes) {
        const canonical = canonicalFromNode(project, node);
        const registered = this.database.upsertRegistryResource(canonical);
        this.database.addRegistryMembership({ applicationId: application.id, resourceId: registered.id, sourceKind: 'architecture_node', sourceReference: node.id });
        nodeResourceIds.set(node.id, registered.id);
      }
      this.database.pruneRegistryMemberships(application.id, 'architecture_node', graph.document.nodes.map(node => node.id));
    } else {
      this.database.pruneRegistryMemberships(application.id, 'architecture_node', []);
    }

    const relationshipIds = new Map();
    for (const edge of this.database.listEdges(application.id)) {
      const source = resourcesBySource.get(`apm:${edge.sourceResourceId}`);
      const target = resourcesBySource.get(`apm:${edge.targetResourceId}`);
      if (!source || !target) continue;
      const id = relationshipId(application.id, source.id, target.id, edge.relationType);
      this.database.upsertRegistryRelationship({
        id, applicationId: application.id, sourceResourceId: source.id, targetResourceId: target.id,
        relationType: edge.relationType, status: 'confirmed', evidence: [{ kind: 'apm_edge', id: edge.id }],
      });
      relationshipIds.set(`apm:${edge.id}`, id);
    }
    if (graph) {
      for (const edge of graph.document.edges) {
        const sourceResourceId = nodeResourceIds.get(edge.sourceNodeId);
        const targetResourceId = nodeResourceIds.get(edge.targetNodeId);
        if (!sourceResourceId || !targetResourceId || sourceResourceId === targetResourceId) continue;
        const id = relationshipId(application.id, sourceResourceId, targetResourceId, edge.relationType || 'depends_on');
        this.database.upsertRegistryRelationship({
          id, applicationId: application.id, sourceResourceId, targetResourceId,
          relationType: edge.relationType || 'depends_on', status: edge.status || 'suggested', evidence: edge.evidence || [],
        });
        relationshipIds.set(`architecture:${edge.id}`, id);
      }
      const document = JSON.parse(JSON.stringify(graph.document));
      let changed = false;
      for (const node of document.nodes) {
        const registryResourceId = nodeResourceIds.get(node.id);
        if (registryResourceId && node.registryResourceId !== registryResourceId) {
          node.registryResourceId = registryResourceId;
          changed = true;
        }
      }
      for (const edge of document.edges) {
        const registryRelationshipId = relationshipIds.get(`architecture:${edge.id}`);
        if (registryRelationshipId && edge.registryRelationshipId !== registryRelationshipId) {
          edge.registryRelationshipId = registryRelationshipId;
          changed = true;
        }
      }
      if (changed) {
        this.architectureDatabase.saveGraph(project.id, document, {
          expectedRevision: graph.revision,
          change: {
            type: 'registry.reconcile', subjectType: 'registry', subjectId: application.id,
            author: application.profileId, reason: 'Project shared registry correlation identifiers',
          },
        });
      }
    }
    this.database.pruneRegistryRelationships(application.id, [...new Set(relationshipIds.values())]);
    return {
      projectId: project?.id || null,
      resources: this.database.listRegistryResources(application.id),
      relationships: this.database.listRegistryRelationships(application.id),
      apmResourceCount: apmResources.length,
      architectureNodeCount: nodeResourceIds.size,
    };
  }
}

module.exports = {
  ApplicationRegistryService,
  canonicalFromApm,
  canonicalKubernetesType,
  canonicalFromNode,
  canonicalResource,
  relationshipId,
};
