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

const PROVIDER_BY_RESOURCE_TYPE = {
  kubernetes: 'kubernetes',
  'gcp-cloud-run': 'gcp',
  'gcp-function': 'gcp',
  'vercel-project': 'vercel',
};

// A resource's provider must come from what it actually is, never from its parent application's
// hosting cloud (e.g. a Kubernetes workload inside an AWS-hosted EKS app is still provider "kubernetes").
function resourceOwnProvider(resource) {
  return PROVIDER_BY_RESOURCE_TYPE[resource.type] || resource.provider;
}

function canonicalFromApm(application, resource) {
  // apm_resources.provider reflects the hosting cloud of the *application* (e.g. an AWS-hosted EKS
  // app stores provider "aws" on every resource, including its Kubernetes workloads). The registry
  // identity must use the resource's own provider so it matches the Architecture Kubernetes adapter.
  const provider = resourceOwnProvider(resource);
  const awsScope = provider === 'aws' ? awsArnScope(resource.arn) : {};
  return canonicalResource({
    provider,
    profileId: application.profileId,
    scopeId: awsScope.scopeId || resource.kubeContext || '',
    location: awsScope.location || (provider === 'kubernetes' ? '' : application.region || ''),
    nativeIdentifier: resource.arn || resource.key,
    resourceType: canonicalKubernetesType(resource),
    displayName: resource.name,
    lineage: [{ kind: 'apm_resource', id: resource.id }],
  });
}

function canonicalFromNode(project, node, fallbackProvider = '') {
  const provider = architectureProvider(node, fallbackProvider);
  // Kubernetes objects are re-created with new UIDs (rollouts, restarts); the stable identity
  // shared with APM is the context/namespace/kind/name key, not the ephemeral UID.
  const nativeIdentifier = provider === 'kubernetes'
    ? (node.discoveryKey || node.nativeId || node.id)
    : (node.arn || node.nativeId || node.discoveryKey || node.id);
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
// Resource types Architecture can discover (S3, SNS, DynamoDB, and any generic ARN-derived type) that
// apm_resources has no schema support for yet: these can structurally never gain an 'apm_resource'
// membership, so they must never be counted as "divergent" — that diagnostic only makes sense for
// types both sides can actually observe.
const CORRELATABLE_RESOURCE_TYPES = new Set([...APM_ARCHITECTURE_TYPES, ...KUBERNETES_ARCHITECTURE_TYPES]);

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
  const key = isKubernetes
    ? String(node.discoveryKey || node.nativeId || '').trim()
    : String(node.arn || node.nativeId || node.discoveryKey || '').trim();
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
    provider: resourceOwnProvider(resource),
    resourceType,
    kind: resource.kind || (isKubernetes ? resourceType : resource.type),
    nativeId,
    discoveryKey: resource.key,
    arn: resource.arn || null,
    kubeContext: resource.kubeContext || '',
    namespace: resource.namespace || '',
    region: isKubernetes ? '' : application.region || '',
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

  // Wraps _reconcile so every trigger (manual button, automatic side-effects from resource/graph
  // mutations) persists a diagnostic: last success/duration or last error, and divergence counts.
  reconcile(application) {
    const startedAt = Date.now();
    try {
      const result = this._reconcile(application);
      const divergentResourceCount = result.resources
        .filter(resource => CORRELATABLE_RESOURCE_TYPES.has(resource.resourceType))
        .filter(resource => (resource.sources || []).length < 2).length;
      const divergentRelationshipCount = result.relationships.filter(relationship => relationship.status === 'suggested').length;
      this.database.recordRegistrySyncSuccess(application.id, {
        durationMs: Date.now() - startedAt,
        divergentResourceCount,
        divergentRelationshipCount,
      });
      return { ...result, syncStatus: this.database.getRegistrySyncStatus(application.id) };
    } catch (error) {
      this.database.recordRegistrySyncFailure(application.id, { durationMs: Date.now() - startedAt, error: error.message });
      throw error;
    }
  }

  _reconcile(application) {
    const project = application.architectureProjectId ? this.architectureDatabase.getProject(application.architectureProjectId) : null;
    const graph = project?.profileId === application.profileId ? this.architectureDatabase.getGraph(project.id) : null;
    let apmResources = this.database.listResources(application.id);
    // One reconcile() call must produce at most one Architecture revision, even though it can both
    // project missing APM resources into the graph and stamp registry correlation ids: both mutations
    // are merged into a single working document and saved once at the end, instead of twice.
    let document = null;
    let addedApmNodes = false;
    if (project && graph) {
      document = JSON.parse(JSON.stringify(graph.document));
      const missingNodes = apmResources.map(resource => ({ resource, node: architectureNodeFromApm(application, resource) }))
        .filter(item => item.node)
        .filter(({ resource, node }) => !document.nodes.some(existing => sameApmArchitectureResource(resource, existing)))
        .map(item => item.node);
      if (missingNodes.length) {
        document.nodes.push(...missingNodes);
        addedApmNodes = true;
      }
      const projectedResources = document.nodes.map(node => apmProjectionFromNode(application, node)).filter(Boolean);
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
    if (project && document) {
      for (const node of document.nodes) {
        const canonical = canonicalFromNode(project, node, application.provider);
        if (!canonical) continue;
        const registered = this.database.upsertRegistryResource(canonical);
        this.database.addRegistryMembership({ applicationId: application.id, resourceId: registered.id, sourceKind: 'architecture_node', sourceReference: node.id });
        nodeResourceIds.set(node.id, registered.id);
      }
      this.database.pruneRegistryMemberships(application.id, 'architecture_node', document.nodes.map(node => node.id));
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
    let stampsChanged = false;
    if (document) {
      for (const edge of document.edges) {
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
      for (const node of document.nodes) {
        const registryResourceId = nodeResourceIds.get(node.id);
        if (registryResourceId && node.registryResourceId !== registryResourceId) {
          node.registryResourceId = registryResourceId;
          stampsChanged = true;
        }
      }
      for (const edge of document.edges) {
        const registryRelationshipId = relationshipIds.get(`architecture:${edge.id}`);
        if (registryRelationshipId && edge.registryRelationshipId !== registryRelationshipId) {
          edge.registryRelationshipId = registryRelationshipId;
          stampsChanged = true;
        }
      }
      if (addedApmNodes || stampsChanged) {
        this.architectureDatabase.saveGraph(project.id, document, {
          expectedRevision: graph.revision,
          change: {
            type: addedApmNodes ? 'registry.project_apm_resource' : 'registry.reconcile',
            subjectType: 'registry', subjectId: application.id, author: application.profileId,
            reason: addedApmNodes
              ? 'Project shared APM resources into Architecture and correlated registry identifiers'
              : 'Project shared registry correlation identifiers',
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
  resourceOwnProvider,
};
