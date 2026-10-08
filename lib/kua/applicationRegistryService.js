'use strict';

const crypto = require('crypto');
const { DECLARATIVE_CONFIDENCE } = require('../architecture/graphService');
const { portableResourceIdentity } = require('./applicationContract');

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
  if (!provider || !nativeIdentifier || !resourceType || !displayName) {
    throw new Error('Canonical resource requires provider, identifier, type and name');
  }
  // Identity v2 (lib/kua/applicationContract.js): the profile stays as local lineage only, so the
  // same resource reached through two profiles, or on two computers, is one resource.
  const { id, identityKey } = portableResourceIdentity({ provider, scopeId, location, resourceType, nativeIdentifier });
  return {
    ...input,
    id,
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

function apmArchitectureType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return normalized === 'loadbalancer' || normalized === 'aws::elasticloadbalancingv2::loadbalancer'
    ? 'elb'
    : normalized;
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

// S3 bucket names are globally unique across all of AWS (no account/region in their ARN), so identity
// must never depend on account/region scope — apm_resources has no accountId column to reproduce
// whatever an Architecture node's node.accountId happens to be, so including it would split one real
// bucket into two registry resources instead of correlating them.
const GLOBALLY_SCOPED_RESOURCE_TYPES = new Set(['s3']);

// The provider scope (account/project/context and location) an APM resource lives in, derived from
// the resource itself; the application's region is only a fallback for identifiers without one.
function resourceScopeFromApm(application, resource) {
  // apm_resources.provider reflects the hosting cloud of the *application* (e.g. an AWS-hosted EKS
  // app stores provider "aws" on every resource, including its Kubernetes workloads). The registry
  // identity must use the resource's own provider so it matches the Architecture Kubernetes adapter.
  const provider = resourceOwnProvider(resource);
  const resourceType = canonicalKubernetesType(resource);
  const globallyScoped = GLOBALLY_SCOPED_RESOURCE_TYPES.has(resourceType);
  const awsScope = provider === 'aws' ? awsArnScope(resource.arn) : {};
  return {
    provider,
    resourceType,
    scopeId: globallyScoped ? '' : (awsScope.scopeId || resource.scopeId || resource.kubeContext || ''),
    location: globallyScoped ? '' : (awsScope.location || resource.location || (provider === 'kubernetes' ? '' : application.region || '')),
  };
}

function canonicalFromApm(application, resource) {
  const { provider, resourceType, scopeId, location } = resourceScopeFromApm(application, resource);
  return canonicalResource({
    provider,
    profileId: application.profileId,
    scopeId,
    location,
    nativeIdentifier: resource.arn || resource.key,
    resourceType,
    displayName: resource.name,
    lineage: [{
      kind: 'apm_resource',
      id: resource.id,
      ...(provider === 'kubernetes' ? { kubeContext: resource.kubeContext || '', namespace: resource.namespace || '' } : {}),
    }],
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
    : apmArchitectureType(rawResourceType);
  const displayName = String(node.name || '').trim();
  if (!provider || !nativeIdentifier || !resourceType || !displayName) return null;
  const globallyScoped = GLOBALLY_SCOPED_RESOURCE_TYPES.has(resourceType);
  const awsScope = provider === 'aws' ? awsArnScope(node.arn) : {};
  return canonicalResource({
    provider,
    profileId: project.profileId,
    scopeId: globallyScoped ? '' : (node.accountId || node.kubeContext || awsScope.scopeId || ''),
    location: globallyScoped ? '' : (node.region || node.location || awsScope.location || ''),
    nativeIdentifier,
    resourceType,
    displayName,
    lineage: [{
      kind: 'architecture_node',
      id: node.id,
      ...(provider === 'kubernetes' ? { kubeContext: node.kubeContext || '', namespace: node.namespace || '' } : {}),
    }],
  });
}

const APM_ARCHITECTURE_TYPES = new Set([
  'lambda', 'kubernetes', 'sqs', 'eventbridge', 'stepfunctions', 'ecs',
  'gcp-cloud-run', 'gcp-function', 'vercel-project', 's3', 'sns', 'dynamodb',
  'ec2', 'eks', 'rds', 'apigateway', 'cloudfront', 'autoscaling', 'elasticache', 'elb',
]);
const KUBERNETES_ARCHITECTURE_TYPES = new Set([
  'deployment', 'statefulset', 'daemonset', 'pod', 'service', 'ingress',
  'configmap', 'secret', 'pvc', 'node', 'kubernetes',
]);
// Resource types Architecture can discover generically (Kinesis, API destinations, KMS, RDS, ...) that
// apm_resources still has no schema support for: these can structurally never gain an 'apm_resource'
// membership, so they must never be counted as "divergent" — that diagnostic only makes sense for
// types both sides can actually observe.
const CORRELATABLE_RESOURCE_TYPES = new Set([...APM_ARCHITECTURE_TYPES, ...KUBERNETES_ARCHITECTURE_TYPES]);

// Lets callers (e.g. the registry API response) flag a resource as structurally single-source so the
// UI never asks the user to "resolve" a divergence that Observability has no way to ever confirm.
function isCorrelatableResourceType(resourceType) {
  return CORRELATABLE_RESOURCE_TYPES.has(String(resourceType || '').trim().toLowerCase());
}

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
  const type = isKubernetes ? 'kubernetes' : apmArchitectureType(architectureType);
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
    metadata: type === 'elb' ? { targetGroups: node.targetGroups || [] } : {},
    // Resources discovered from CloudFormation have no ARN: keep the account and region of the node.
    scopeId: isKubernetes ? '' : String(node.accountId || ''),
    location: isKubernetes ? '' : String(node.region || node.location || ''),
  };
}

function architectureNodeFromApm(application, resource) {
  const isKubernetes = resource.type === 'kubernetes';
  const resourceType = isKubernetes ? canonicalKubernetesType(resource) : resource.type === 'elb' ? 'loadbalancer' : resource.type;
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
  const nodeType = apmArchitectureType(node.resourceType || node.kind || '');
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

  attachResource(application, input, options = {}) {
    const { created, resource } = this.database.attachResource(application.id, input, options);
    const canonical = canonicalFromApm(this.database.getApplication(application.id), resource);
    this.database.clearRegistryDetachment(application.id, canonical.identityKey);
    const result = this.reconcile(this.database.getApplication(application.id));
    return { created, resource, registry: result };
  }

  /**
   * Attaches several resources and reconciles once (an import, #153). Each attach is idempotent;
   * unlike attachResource, a detachment the user made is kept, and a resource that cannot be
   * attached is reported instead of failing the others.
   */
  attachResources(application, inputs = []) {
    const results = inputs.map(input => {
      try {
        return { input, ...this.database.attachResource(application.id, input) };
      } catch (error) {
        return { input, error: error.message };
      }
    });
    const registry = this.reconcile(this.database.getApplication(application.id));
    return { results, registry };
  }

  updateResource(application, resourceId, changes, options = {}) {
    const resource = this.database.getResource(resourceId);
    if (!resource || resource.applicationId !== application.id) {
      throw Object.assign(new Error('Resource not found'), { statusCode: 404 });
    }
    const updated = this.database.updateResource(resourceId, changes, options);
    const registry = this.reconcile(this.database.getApplication(application.id));
    return { resource: updated, registry };
  }

  detachResource(application, resourceId, options = {}) {
    const resource = this.database.getResource(resourceId);
    if (!resource && this.database.isRegistryResourceDetached(application.id, resourceId)) {
      const registry = this.reconcile(this.database.getApplication(application.id));
      return { id: resourceId, detached: false, registry };
    }
    if (!resource || resource.applicationId !== application.id) {
      throw Object.assign(new Error('Resource not found'), { statusCode: 404 });
    }
    const canonical = canonicalFromApm(application, resource);
    this.database.removeResource(resourceId, { ...options, identityKey: canonical.identityKey });
    const registry = this.reconcile(this.database.getApplication(application.id));
    return { id: resourceId, detached: true, registry };
  }

  detachRegistryResource(application, resourceId, options = {}) {
    const detached = this.database.detachRegistryResource(application.id, resourceId, options);
    if (!detached && !this.database.isRegistryResourceDetached(application.id, resourceId)) {
      throw Object.assign(new Error('Registry resource not found'), { statusCode: 404 });
    }
    const registry = this.reconcile(this.database.getApplication(application.id));
    return { id: resourceId, detached, registry };
  }

  // Wraps _reconcile so every trigger (manual button, automatic side-effects from resource/graph
  // mutations) persists a diagnostic: last success/duration or last error, and divergence counts.
  reconcile(application) {
    const startedAt = Date.now();
    try {
      const result = this._reconcile(application);
      // Stamp per-item divergence so callers (registry API, UI) never need to re-derive the same rule -
      // a resource is only "divergent" if its type is structurally capable of a second source.
      const resources = result.resources.map(resource => {
        const correlatable = isCorrelatableResourceType(resource.resourceType);
        return { ...resource, correlatable, divergent: correlatable && (resource.sources || []).length < 2 };
      });
      const relationships = result.relationships.map(relationship => ({ ...relationship, divergent: relationship.status === 'suggested' }));
      const divergentResourceCount = resources.filter(resource => resource.divergent).length;
      const divergentRelationshipCount = relationships.filter(relationship => relationship.divergent).length;
      this.database.recordRegistrySyncSuccess(application.id, {
        durationMs: Date.now() - startedAt,
        divergentResourceCount,
        divergentRelationshipCount,
      });
      return { ...result, resources, relationships, syncStatus: this.database.getRegistrySyncStatus(application.id) };
    } catch (error) {
      this.database.recordRegistrySyncFailure(application.id, { durationMs: Date.now() - startedAt, error: error.message });
      throw error;
    }
  }

  _reconcile(application) {
    const boundProfiles = new Set(this.database.listScopeBindings(application.id)
      .filter(binding => binding.status === 'verified')
      .map(binding => binding.profileId));
    const projectIds = application.architectureProjectIds?.length
      ? application.architectureProjectIds
      : [application.architectureProjectId].filter(Boolean);
    const projectDocuments = projectIds
      .map(projectId => this.architectureDatabase.getProject(projectId))
      .filter(project => project && (
        project.profileId === application.profileId || boundProfiles.has(project.profileId) || !application.profileId
      ))
      .map(project => ({ project, graph: this.architectureDatabase.getGraph(project.id) }))
      .filter(item => item.graph)
      .map(item => ({ ...item, document: JSON.parse(JSON.stringify(item.graph.document)) }));
    const detachedIdentityKeys = new Set(this.database.listRegistryDetachmentKeys(application.id));
    const isDetached = canonical => canonical && detachedIdentityKeys.has(canonical.identityKey);
    let apmResources = this.database.listResources(application.id)
      .filter(resource => !isDetached(canonicalFromApm(application, resource)));
    let addedApmNodes = false;
    const projectedResourceKeys = new Set();
    for (const item of projectDocuments) {
      const missingNodes = apmResources.map(resource => ({ resource, node: architectureNodeFromApm(application, resource) }))
        .filter(candidate => candidate.node)
        .filter(({ resource, node }) => !item.document.nodes.some(existing => sameApmArchitectureResource(resource, existing)))
        .map(item => item.node);
      if (missingNodes.length) {
        item.document.nodes.push(...missingNodes);
        addedApmNodes = true;
      }
      item.document.nodes.map(node => ({ node, canonical: canonicalFromNode(item.project, node, application.provider) }))
        .filter(({ canonical }) => !isDetached(canonical))
        .map(({ node }) => {
          const targetGroups = item.document.edges
            .filter(edge => edge.sourceNodeId === node.id && ['routes_to', 'routes-to'].includes(edge.relationType))
            .map(edge => item.document.nodes.find(candidate => candidate.id === edge.targetNodeId))
            .filter(target => target && apmArchitectureType(target.resourceType || target.kind) === 'targetgroup')
            .map(target => target.arn || target.nativeId || target.discoveryKey)
            .filter(Boolean);
          return apmProjectionFromNode(application, { ...node, targetGroups });
        }).filter(Boolean)
        .forEach(resource => {
          projectedResourceKeys.add(resource.key);
          this.database.upsertArchitectureResource(application.id, resource);
        });
    }
    if (projectDocuments.length) this.database.pruneArchitectureResources(application.id, [...projectedResourceKeys]);
    const resourcesBySource = new Map();
    apmResources = this.database.listResources(application.id)
      .filter(resource => !isDetached(canonicalFromApm(application, resource)));
    const apmPairs = [];
    for (const resource of apmResources) {
      const canonical = canonicalFromApm(application, resource);
      const registered = this.database.upsertRegistryResource(canonical);
      this.database.addRegistryMembership({ applicationId: application.id, resourceId: registered.id, sourceKind: 'apm_resource', sourceReference: resource.id });
      apmPairs.push({ resourceId: registered.id, sourceReference: resource.id });
      resourcesBySource.set(`apm:${resource.id}`, registered);
    }
    this.database.pruneRegistryMembershipPairs(application.id, 'apm_resource', apmPairs);

    const nodeResourceIds = new Map();
    const architectureNodeReferences = [];
    for (const item of projectDocuments) {
      for (const node of item.document.nodes) {
        const canonical = canonicalFromNode(item.project, node, application.provider);
        if (!canonical) continue;
        if (isDetached(canonical)) continue;
        const registered = this.database.upsertRegistryResource(canonical);
        const nodeReference = `${item.project.id}:${node.id}`;
        this.database.addRegistryMembership({ applicationId: application.id, resourceId: registered.id, sourceKind: 'architecture_node', sourceReference: nodeReference });
        architectureNodeReferences.push({ resourceId: registered.id, sourceReference: nodeReference });
        nodeResourceIds.set(nodeReference, registered.id);
      }
    }
    this.database.pruneRegistryMembershipPairs(application.id, 'architecture_node', architectureNodeReferences);

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
    for (const item of projectDocuments) {
      for (const edge of item.document.edges) {
        // Relationships already in the graph from an earlier discovery are re-evaluated here, so
        // enabling auto-confirmation does not require re-importing everything.
        if (edge.status === 'suggested' && Number(edge.confidence) >= DECLARATIVE_CONFIDENCE) {
          edge.status = 'automatic';
          stampsChanged = true;
        }
        const sourceResourceId = nodeResourceIds.get(`${item.project.id}:${edge.sourceNodeId}`);
        const targetResourceId = nodeResourceIds.get(`${item.project.id}:${edge.targetNodeId}`);
        if (!sourceResourceId || !targetResourceId || sourceResourceId === targetResourceId) continue;
        const id = relationshipId(application.id, sourceResourceId, targetResourceId, edge.relationType || 'depends_on');
        this.database.upsertRegistryRelationship({
          id, applicationId: application.id, sourceResourceId, targetResourceId,
          relationType: edge.relationType || 'depends_on', status: edge.status || 'suggested', evidence: edge.evidence || [],
        });
        relationshipIds.set(`architecture:${item.project.id}:${edge.id}`, id);
      }
      for (const node of item.document.nodes) {
        const registryResourceId = nodeResourceIds.get(`${item.project.id}:${node.id}`);
        if (registryResourceId && node.registryResourceId !== registryResourceId) {
          node.registryResourceId = registryResourceId;
          stampsChanged = true;
        } else if (!registryResourceId && node.registryResourceId) {
          delete node.registryResourceId;
          stampsChanged = true;
        }
      }
      for (const edge of item.document.edges) {
        const registryRelationshipId = relationshipIds.get(`architecture:${item.project.id}:${edge.id}`);
        if (registryRelationshipId && edge.registryRelationshipId !== registryRelationshipId) {
          edge.registryRelationshipId = registryRelationshipId;
          stampsChanged = true;
        } else if (!registryRelationshipId && edge.registryRelationshipId) {
          delete edge.registryRelationshipId;
          stampsChanged = true;
        }
      }
      if (addedApmNodes || stampsChanged) {
        this.architectureDatabase.saveGraph(item.project.id, item.document, {
          expectedRevision: item.graph.revision,
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
      projectId: projectDocuments[0]?.project.id || null,
      projectIds: projectDocuments.map(item => item.project.id),
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
  isCorrelatableResourceType,
  relationshipId,
  resourceOwnProvider,
  resourceScopeFromApm,
};
