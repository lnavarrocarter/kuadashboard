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
    location: awsScope.location || (resource.provider === 'kubernetes' ? '' : application.region || ''),
    nativeIdentifier: resource.arn || resource.key,
    resourceType: canonicalKubernetesType(resource),
    displayName: resource.name,
    lineage: [{ kind: 'apm_resource', id: resource.id }],
  });
}

function canonicalFromNode(project, node, fallbackProvider = '') {
  const provider = architectureProvider(node, fallbackProvider);
  const nativeIdentifier = node.arn || node.nativeId || node.discoveryKey || node.id;
  const rawResourceType = node.resourceType || node.kind || 'resource';
  const resourceType = provider === 'kubernetes'
    ? canonicalKubernetesType({ type: 'kubernetes', kind: node.kind || rawResourceType })
    : rawResourceType;
  const displayName = String(node.name || '').trim();
  if (!provider || !nativeIdentifier || !resourceType || !displayName) return null;
  const awsScope = provider === 'aws' ? awsArnScope(node.arn) : {};
  return canonicalResource({
    provider,
    profileId: project.profileId,
    scopeId: node.accountId || node.kubeContext || awsScope.scopeId || '',
    location: node.region || node.location || awsScope.location || '',
    nativeIdentifier,
    resourceType,
    displayName,
    lineage: [{ kind: 'architecture_node', id: node.id }],
  });
}

const APM_ARCHITECTURE_TYPES = new Set([
  'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
  'gcp-cloud-run', 'gcp-function', 'vercel-project',
]);
const KUBERNETES_ARCHITECTURE_TYPES = new Set([
  'deployment', 'statefulset', 'daemonset', 'pod', 'service', 'ingress',
  'configmap', 'secret', 'pvc', 'kubernetes',
]);

function architectureProvider(node, fallbackProvider = '') {
  const explicitProvider = String(node?.provider || '').trim().toLowerCase();
  if (explicitProvider) return explicitProvider;
  const type = String(node?.resourceType || node?.kind || '').trim().toLowerCase();
  if (KUBERNETES_ARCHITECTURE_TYPES.has(type)) return 'kubernetes';
  return String(fallbackProvider || '').trim().toLowerCase();
}

function apmProjectionFromNode(application, node) {
  const architectureType = String(node.resourceType || node.kind || '').trim().toLowerCase();
  const isKubernetes = String(node.provider || '').trim().toLowerCase() === 'kubernetes' ||
    KUBERNETES_ARCHITECTURE_TYPES.has(architectureType);
  const type = isKubernetes ? 'kubernetes' : architectureType;
  if (!APM_ARCHITECTURE_TYPES.has(type)) return null;
  const key = String(node.arn || node.nativeId || node.discoveryKey || '').trim();
  const name = String(node.name || '').trim();
  if (!key || !name) return null;
  return {
    provider: architectureProvider(node, application.provider),
    type,
    key,
    arn: node.arn || null,
    kubeContext: node.kubeContext || null,
    namespace: node.namespace || null,
    kind: node.kind || (isKubernetes ? architectureType : type),
    name,
    service: node.service || '',
    logGroup: node.logGroup || null,
  };
}

function architectureNodeFromApm(application, resource) {
  const isKubernetes = resource.type === 'kubernetes';
  const resourceType = isKubernetes ? canonicalKubernetesType(resource) : resource.type;
  if (!APM_ARCHITECTURE_TYPES.has(resource.type)) return null;
  const nativeId = String(resource.arn || resource.key || '').trim();
  if (!nativeId || !resource.name) return null;
  const arnParts = String(resource.arn || '').split(':');
  const node = {
    id: `apm-resource:${resource.id}`,
    name: resource.name,
    provider: resource.provider,
    resourceType,
    kind: resource.kind || (isKubernetes ? resourceType : resource.type),
    nativeId,
    discoveryKey: resource.key,
    arn: resource.arn || null,
    kubeContext: resource.kubeContext || '',
    namespace: resource.namespace || '',
    region: resource.provider === 'kubernetes' ? '' : application.region || '',
    sourceId: `apm:application:${application.id}`,
    manual: true,
    evidence: [{ type: 'apm_membership', sourceId: `apm:application:${application.id}`, values: [resource.id, resource.associationSource] }],
  };
  if (isKubernetes) node.location = '';
  else if (/^\d{12}$/.test(arnParts[4] || '')) node.accountId = arnParts[4];
  return node;
}

function sameApmArchitectureResource(resource, node) {
  const resourceType = resource.type === 'kubernetes' ? canonicalKubernetesType(resource) : resource.type;
  const nodeType = String(node.resourceType || node.kind || '').trim().toLowerCase();
  if (resourceType !== nodeType) return false;
  const identities = [resource.arn, resource.key].filter(Boolean).map(value => String(value).toLowerCase());
  const nodeIdentities = [node.arn, node.nativeId, node.discoveryKey].filter(Boolean)
    .map(value => String(value).toLowerCase());
  return identities.some(identity => nodeIdentities.includes(identity));
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
    const project = application.architectureProjectId ? this.architectureDatabase.getProject(application.architectureProjectId) : null;
    let graph = project?.profileId === application.profileId ? this.architectureDatabase.getGraph(project.id) : null;
    let apmResources = this.database.listResources(application.id);
    if (project && graph) {
      const missingNodes = apmResources.map(resource => ({ resource, node: architectureNodeFromApm(application, resource) }))
        .filter(item => item.node)
        .filter(({ resource, node }) => !graph.document.nodes.some(existing => sameApmArchitectureResource(resource, existing)))
        .map(item => item.node);
      if (missingNodes.length) {
        const document = JSON.parse(JSON.stringify(graph.document));
        document.nodes.push(...missingNodes);
        this.architectureDatabase.saveGraph(project.id, document, {
          expectedRevision: graph.revision,
          change: {
            type: 'registry.project_apm_resource', subjectType: 'registry', subjectId: application.id,
            author: application.profileId, reason: 'Project shared APM resources into Architecture',
          },
        });
        graph = this.architectureDatabase.getGraph(project.id);
      }
      const projectedResources = graph.document.nodes.map(node => apmProjectionFromNode(application, node)).filter(Boolean);
      for (const resource of projectedResources) this.database.upsertArchitectureResource(application.id, resource);
      this.database.pruneArchitectureResources(application.id, projectedResources.map(resource => resource.key));
    }
    const resourcesBySource = new Map();
    apmResources = this.database.listResources(application.id);
    for (const resource of apmResources) {
      const canonical = canonicalFromApm(application, resource);
      const registered = this.database.upsertRegistryResource(canonical);
      this.database.addRegistryMembership({ applicationId: application.id, resourceId: registered.id, sourceKind: 'apm_resource', sourceReference: resource.id });
      resourcesBySource.set(`apm:${resource.id}`, registered);
    }
    this.database.pruneRegistryMemberships(application.id, 'apm_resource', apmResources.map(resource => resource.id));

    const nodeResourceIds = new Map();
    if (project && graph) {
      for (const node of graph.document.nodes) {
        const canonical = canonicalFromNode(project, node, application.provider);
        if (!canonical) continue;
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
  architectureNodeFromApm,
  apmProjectionFromNode,
  canonicalFromApm,
  canonicalKubernetesType,
  canonicalFromNode,
  canonicalResource,
  relationshipId,
};
