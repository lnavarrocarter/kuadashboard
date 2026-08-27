'use strict';

const express = require('express');
const { discoverResourceCandidates } = require('../lib/apm/correlation');
const { createAwsDeploymentReader } = require('../lib/apm/awsDeploymentReader');
const { createEksWorkloadReader } = require('../lib/apm/eksWorkloadReader');
const { evaluateThresholds } = require('../lib/apm/thresholds');
const { analyzeTopology } = require('../lib/apm/topologyAnalysis');
const { createAwsTopologyReader } = require('../lib/apm/awsTopologyReader');
const { createAwsProcessTracer } = require('../lib/apm/awsProcessTracer');
const { ApplicationRegistryService, resourceOwnProvider } = require('../lib/kua/applicationRegistryService');
const { KubernetesAdapter } = require('../lib/kua/kubernetesAdapter');

const AWS_TOPOLOGY_RESOURCE_TYPES = new Set(['lambda', 'stepfunctions', 'sqs', 'eventbridge', 'ecs']);

function createApmRouter({
  database,
  architectureDatabase,
  registryService,
  kubernetesAdapter = new KubernetesAdapter(),
  scheduler,
  auditLog,
  provider = 'aws',
  deploymentReader = createAwsDeploymentReader(),
  eksWorkloadReader = createEksWorkloadReader(),
  topologyReader = createAwsTopologyReader(),
  processTracer = createAwsProcessTracer(),
}) {
  if (!database || !scheduler) throw new Error('database and scheduler are required');
  const router = express.Router();
  const registry = registryService || (architectureDatabase
    ? new ApplicationRegistryService({ database, architectureDatabase })
    : null);

  function profileId(req, res) {
    const value = req.get('X-Profile-Id');
    if (!value) res.status(400).json({ error: 'X-Profile-Id header is required' });
    return value;
  }

  function scopedApplication(req, res) {
    const profile = profileId(req, res);
    if (!profile) return null;
    const application = database.getApplication(req.params.applicationId);
    if (!application || application.profileId !== profile || application.provider !== provider) {
      res.status(404).json({ error: 'Application not found' });
      return null;
    }
    return application;
  }

  function handleError(res, error) {
    const status = error.statusCode || error.$metadata?.httpStatusCode ||
      (/UNIQUE constraint failed/.test(error.message) ? 409 : 500);
    res.status(status).json({ error: error.message || 'Internal server error' });
  }

  function log(action, resource, context, details) {
    auditLog?.log({ category: 'apm', action, resource, context, details });
  }

  function architectureLinkStatus(application) {
    if (!application.architectureProjectId) {
      return { linked: false, project: null, resources: { matched: [], unmatched: [], duplicateIdentityWarnings: [] } };
    }
    if (!architectureDatabase) {
      throw Object.assign(new Error('Architecture integration is unavailable'), { statusCode: 503 });
    }
    const project = architectureDatabase.getProject(application.architectureProjectId);
    if (!project || project.profileId !== application.profileId) {
      return { linked: false, status: 'missing', project: null, resources: { matched: [], unmatched: [], duplicateIdentityWarnings: [] } };
    }
    const graph = architectureDatabase.getGraph(project.id);
    const resources = database.listResources(application.id);
    const matchedNodeIds = new Set();
    const matched = [];
    const unmatched = [];
    const duplicateIdentityWarnings = [];
    for (const resource of resources) {
      const identities = [resource.arn, resource.key].filter(Boolean).map(value => String(value).toLowerCase());
      const nodes = (graph?.document.nodes || []).filter(node => {
        if (node.provider && node.provider !== resource.provider) return false;
        const nodeIdentities = [node.arn, node.nativeId, node.discoveryKey].filter(Boolean)
          .map(value => String(value).toLowerCase());
        return identities.some(identity => nodeIdentities.includes(identity));
      });
      if (!nodes.length) {
        unmatched.push(resource);
        continue;
      }
      nodes.forEach(node => matchedNodeIds.add(node.id));
      matched.push({ resource, nodeIds: nodes.map(node => node.id) });
      if (nodes.length > 1) duplicateIdentityWarnings.push({ resourceId: resource.id, nodeIds: nodes.map(node => node.id) });
    }
    return {
      linked: true,
      status: 'linked',
      project,
      resources: {
        matched,
        unmatched,
        unmatchedNodeIds: (graph?.document.nodes || []).filter(node => !matchedNodeIds.has(node.id)).map(node => node.id),
        duplicateIdentityWarnings,
      },
    };
  }

  function architectureResourceType(resource) {
    if (resource.type !== 'kubernetes') return resource.type;
    const kind = String(resource.kind || '').trim().toLowerCase();
    return {
      deployment: 'deployment', statefulset: 'statefulset', daemonset: 'daemonset',
      pod: 'pod', service: 'service', ingress: 'ingress', configmap: 'configmap',
      secret: 'secret', persistentvolumeclaim: 'pvc', pvc: 'pvc',
    }[kind] || 'kubernetes';
  }

  function architectureDocumentFromApplication(application, projectId) {
    const resources = database.listResources(application.id);
    const nodeIdByResourceId = new Map();
    const nodes = resources.map(resource => {
      const id = `apm-resource:${resource.id}`;
      nodeIdByResourceId.set(resource.id, id);
      const isKubernetes = resource.type === 'kubernetes';
      return {
        id,
        name: resource.name,
        provider: resourceOwnProvider(resource),
        resourceType: architectureResourceType(resource),
        kind: resource.kind || resource.type,
        nativeId: resource.arn || resource.key,
        discoveryKey: resource.key,
        arn: resource.arn || null,
        kubeContext: resource.kubeContext || '',
        namespace: resource.namespace || '',
        region: isKubernetes ? '' : application.region,
        sourceId: `apm:application:${application.id}`,
        manual: true,
        evidence: [{ type: 'apm_membership', sourceId: `apm:application:${application.id}`, values: [resource.id, resource.associationSource] }],
      };
    });
    const edges = database.listEdges(application.id).flatMap(edge => {
      const sourceNodeId = nodeIdByResourceId.get(edge.sourceResourceId);
      const targetNodeId = nodeIdByResourceId.get(edge.targetResourceId);
      if (!sourceNodeId || !targetNodeId) return [];
      return [{
        id: `apm-edge:${edge.id}`,
        sourceNodeId,
        targetNodeId,
        relationType: edge.relationType,
        status: 'manual',
        confidence: 1,
        evidence: [{ type: 'apm_confirmed_dependency', sourceId: `apm:application:${application.id}`, values: [edge.id] }],
      }];
    });
    return {
      projectId,
      scopes: [{ id: `apm:application:${application.id}`, provider: application.provider, profileId: application.profileId, region: application.region }],
      sources: [{ id: `apm:application:${application.id}`, type: 'apm_application', provider: application.provider, profileId: application.profileId, name: application.name, readOnly: true }],
      nodes,
      edges,
    };
  }

  router.get('/applications', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    res.json(database.listApplications({ provider, profileId: profile, region: req.query.region || undefined }));
  });

  router.post('/applications', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      const application = database.createApplication({ ...req.body, provider, profileId: profile });
      log('Application created', application.name, profile, { region: application.region });
      res.status(201).json(application);
    } catch (error) { handleError(res, error); }
  });

  function reconcileRegistry(application) {
    if (!registry || !application) return null;
    return registry.reconcile(application);
  }

  router.post('/candidates', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    const resources = req.body?.resources;
    if (!Array.isArray(resources) || resources.length > 500 ||
        resources.some(resource => !resource || typeof resource !== 'object' || Array.isArray(resource))) {
      return res.status(400).json({ error: 'resources must be an array with at most 500 objects' });
    }
    const applications = database.listApplications({ provider, profileId: profile });
    const candidateApplication = req.body?.application;
    if (candidateApplication?.name && !applications.some(application =>
      application.name.trim().toLowerCase() === String(candidateApplication.name).trim().toLowerCase())) {
      applications.push({ ...candidateApplication, id: null });
    }
    res.json({
      estimate: { awsRequests: 0, kubernetesRequests: 0 },
      candidates: discoverResourceCandidates(resources, applications),
    });
  });

  router.get('/deployments', async (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      res.json(await deploymentReader.listDeployments({
        profileId: profile,
        region: req.query.region || 'us-east-1',
      }));
    } catch (error) { handleError(res, error); }
  });

  router.post('/deployment-resources', async (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      res.json(await deploymentReader.preview({
        profileId: profile,
        region: req.body?.region || 'us-east-1',
        stackNames: req.body?.stackNames,
      }));
    } catch (error) { handleError(res, error); }
  });

  async function listKubernetesWorkloads(req, res) {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      const contexts = String(req.query.contexts || '').split(',').map(value => value.trim()).filter(Boolean);
      res.json(await eksWorkloadReader.listWorkloads({ provider, contexts }));
    } catch (error) { handleError(res, error); }
  }

  router.get('/kubernetes-workloads', listKubernetesWorkloads);
  router.get('/eks-workloads', listKubernetesWorkloads);

  router.get('/kubernetes-contexts', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      res.json({ contexts: eksWorkloadReader.listContexts({ provider }) });
    } catch (error) { handleError(res, error); }
  });

  router.get('/applications/:applicationId/discovery/kubernetes/contexts', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      res.json({ applicationId: application.id, contexts: kubernetesAdapter.listContexts({ provider }) });
    } catch (error) { handleError(res, error); }
  });

  router.post('/applications/:applicationId/discovery/kubernetes/preview', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const preview = await kubernetesAdapter.preview({
        provider,
        contexts: req.body?.contexts,
        namespaces: req.body?.namespaces,
      });
      res.json({
        ...preview,
        applicationId: application.id,
        profileId: application.profileId,
        sources: preview.sources.map(source => ({ ...source, profileId: application.profileId })),
      });
    } catch (error) { handleError(res, error); }
  });

  router.get('/applications/:applicationId', (req, res) => {
    const application = scopedApplication(req, res);
    if (application) res.json(application);
  });

  router.patch('/applications/:applicationId', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const updated = database.updateApplication(application.id, req.body);
      log('Application updated', updated.name, updated.profileId, {
        pollingEnabled: updated.pollingEnabled,
      });
      res.json(updated);
    } catch (error) { handleError(res, error); }
  });

  router.delete('/applications/:applicationId', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    database.deleteApplication(application.id);
    log('Application deleted', application.name, application.profileId);
    res.status(204).end();
  });

  router.get('/applications/:applicationId/architecture-link', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      res.json(architectureLinkStatus(application));
    } catch (error) { handleError(res, error); }
  });

  router.patch('/applications/:applicationId/architecture-link', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      if (!architectureDatabase) throw Object.assign(new Error('Architecture integration is unavailable'), { statusCode: 503 });
      const projectId = String(req.body?.projectId || '').trim();
      if (!projectId) throw Object.assign(new Error('projectId is required'), { statusCode: 400 });
      const project = architectureDatabase.getProject(projectId);
      if (!project || project.profileId !== application.profileId) {
        throw Object.assign(new Error('Architecture project not found'), { statusCode: 404 });
      }
      const updated = database.updateArchitectureProjectLink(application.id, project.id);
      reconcileRegistry(updated);
      log('Architecture project linked', application.name, application.profileId, { projectId: project.id });
      res.json({ application: updated, ...architectureLinkStatus(updated) });
    } catch (error) { handleError(res, error); }
  });

  router.post('/applications/:applicationId/architecture-link/project', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      if (!architectureDatabase) throw Object.assign(new Error('Architecture integration is unavailable'), { statusCode: 503 });
      const project = architectureDatabase.createProject({
        profileId: application.profileId,
        name: String(req.body?.name || application.name).trim(),
        description: String(req.body?.description || `Architecture view for ${application.name}`).trim(),
      });
      const document = architectureDocumentFromApplication(application, project.id);
      const graph = architectureDatabase.saveGraph(project.id, document, {
        expectedRevision: 0,
        change: {
          type: 'apm.architecture_project.create', subjectType: 'application', subjectId: application.id,
          author: application.profileId, reason: 'Create Architecture view from confirmed APM membership',
        },
      });
      const updated = database.updateArchitectureProjectLink(application.id, project.id);
      reconcileRegistry(updated);
      log('Architecture project created and linked', application.name, application.profileId, { projectId: project.id });
      res.status(201).json({ application: updated, graph, ...architectureLinkStatus(updated) });
    } catch (error) { handleError(res, error); }
  });

  router.delete('/applications/:applicationId/architecture-link', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const updated = database.updateArchitectureProjectLink(application.id, null);
      reconcileRegistry(updated);
      log('Architecture project unlinked', application.name, application.profileId, {
        projectId: application.architectureProjectId,
      });
      res.json(updated);
    } catch (error) { handleError(res, error); }
  });

  router.get('/applications/:applicationId/registry', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      res.json({
        projectId: application.architectureProjectId,
        resources: database.listRegistryResources(application.id),
        relationships: database.listRegistryRelationships(application.id),
        syncStatus: database.getRegistrySyncStatus(application.id),
      });
    } catch (error) { handleError(res, error); }
  });

  router.post('/applications/:applicationId/registry/reconcile', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      if (!registry) throw Object.assign(new Error('Architecture integration is unavailable'), { statusCode: 503 });
      const result = registry.reconcile(application);
      log('Shared registry reconciled', application.name, application.profileId, {
        resourceCount: result.resources.length, relationshipCount: result.relationships.length,
      });
      res.json(result);
    } catch (error) { handleError(res, error); }
  });

  router.get('/applications/:applicationId/thresholds', (req, res) => {
    const application = scopedApplication(req, res);
    if (application) res.json(application.thresholds);
  });

  router.patch('/applications/:applicationId/thresholds', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const thresholds = database.updateThresholds(application.id, req.body);
      log('Thresholds updated', application.name, application.profileId, {
        fields: Object.keys(req.body || {}),
      });
      res.json(thresholds);
    } catch (error) { handleError(res, error); }
  });

  router.get('/applications/:applicationId/resources', (req, res) => {
    const application = scopedApplication(req, res);
    if (application) res.json(database.listResources(application.id));
  });

  router.post('/applications/:applicationId/resources', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const resource = database.addResource(application.id, req.body);
      reconcileRegistry(database.getApplication(application.id));
      log('Resource associated', `${resource.type}/${resource.name}`, application.profileId, {
        source: resource.associationSource,
      });
      res.status(201).json(resource);
    } catch (error) { handleError(res, error); }
  });

  router.patch('/applications/:applicationId/resources/:resourceId', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    const resource = database.getResource(req.params.resourceId);
    if (!resource || resource.applicationId !== application.id) return res.status(404).json({ error: 'Resource not found' });
    try {
      const updated = database.updateResource(resource.id, req.body);
      reconcileRegistry(database.getApplication(application.id));
      log('Resource updated', `${updated.type}/${updated.name}`, application.profileId, { enabled: updated.enabled });
      res.json(updated);
    } catch (error) { handleError(res, error); }
  });

  router.delete('/applications/:applicationId/resources/:resourceId', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    const resource = database.getResource(req.params.resourceId);
    if (!resource || resource.applicationId !== application.id) return res.status(404).json({ error: 'Resource not found' });
    database.removeResource(resource.id);
    reconcileRegistry(database.getApplication(application.id));
    log('Resource removed', `${resource.type}/${resource.name}`, application.profileId);
    res.status(204).end();
  });

  router.get('/applications/:applicationId/topology', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    const resources = database.listResources(application.id);
    const edges = database.listEdges(application.id);
    res.json({
      application,
      resources,
      edges,
      analysis: analyzeTopology(application, resources, edges),
    });
  });

  router.post('/applications/:applicationId/topology/analyze-cloud', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    if (provider !== 'aws') return res.status(400).json({ error: 'Cloud topology analysis is only available for AWS applications' });
    try {
      const resources = database.listResources(application.id);
      const edges = database.listEdges(application.id);
      const cloudResourceIds = new Set(resources.filter(resource => AWS_TOPOLOGY_RESOURCE_TYPES.has(resource.type)).map(resource => resource.id));
      const cloudResources = resources.filter(resource => cloudResourceIds.has(resource.id));
      const cloudEdges = edges.filter(edge => cloudResourceIds.has(edge.sourceResourceId) && cloudResourceIds.has(edge.targetResourceId));
      const evidence = await topologyReader.analyze({ application, resources: cloudResources, edges: cloudEdges });
      log('Cloud topology analyzed', application.name, application.profileId, { requests: evidence.requests });
      res.json({ application, resources, edges, analysis: analyzeTopology(application, resources, edges, evidence) });
    } catch (error) { handleError(res, error); }
  });

  router.post('/applications/:applicationId/process-traces', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    if (provider !== 'aws') return res.status(400).json({ error: 'Process tracing is only available for AWS applications' });
    try {
      const result = await processTracer.trace({
        application,
        resources: database.listResources(application.id),
        database,
        requestId: req.body?.requestId,
        executionArn: req.body?.executionArn,
        stateMachineArn: req.body?.stateMachineArn,
        includeData: req.body?.includeData === true,
      });
      log('Process trace queried', application.name, application.profileId, {
        requests: result.requests, traces: result.traces.length,
      });
      res.json(result);
    } catch (error) { handleError(res, error); }
  });

  router.post('/applications/:applicationId/edges', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const edge = database.addEdge(application.id, req.body);
      reconcileRegistry(database.getApplication(application.id));
      log('Dependency confirmed', edge.id, application.profileId);
      res.status(201).json(edge);
    } catch (error) { handleError(res, error); }
  });

  router.delete('/applications/:applicationId/edges/:edgeId', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    const edge = database.listEdges(application.id).find(item => item.id === req.params.edgeId);
    if (!edge) return res.status(404).json({ error: 'Dependency not found' });
    database.removeEdge(edge.id);
    reconcileRegistry(database.getApplication(application.id));
    log('Dependency removed', edge.id, application.profileId);
    res.status(204).end();
  });

  router.get('/applications/:applicationId/overview', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    const overview = database.getOverview(application.id, { from: req.query.from, to: req.query.to });
    res.json({
      ...overview,
      health: evaluateThresholds(overview.metrics, application.thresholds),
      latestRun: database.getLatestCollectionRun(application.id),
    });
  });

  router.get('/applications/:applicationId/series', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    if (!req.query.metric) return res.status(400).json({ error: 'metric query parameter is required' });
    const end = Number(req.query.to) || Date.now();
    const start = Number(req.query.from) || end - 24 * 60 * 60 * 1000;
    res.json(database.getMetricSeries({
      applicationId: application.id,
      resourceId: req.query.resourceId || undefined,
      metricName: req.query.metric,
      from: start,
      to: end,
    }));
  });

  router.get('/applications/:applicationId/forecast', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    const lambdaCount = database.listResources(application.id, { enabledOnly: true })
      .filter(resource => resource.type === 'lambda').length;
    res.json({
      lambdaCount,
      cadenceMinutes: 30,
      monthlyRequestsExpected: lambdaCount * 48 * 30,
      monthlyRequestsMaximum: lambdaCount * 48 * 30 * 2,
      localMonthlyLimit: 100000,
    });
  });

  router.post('/applications/:applicationId/collect-now', async (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const result = await scheduler.collectApplication(application.id, { trigger: 'manual' });
      if (result.skipped) return res.status(409).json(result);
      log('Manual collection', application.name, application.profileId, {
        status: result.run.status,
        requestCount: result.run.requestCount,
      });
      res.status(result.run.status === 'budget_exhausted' ? 429 : 200).json(result);
    } catch (error) { handleError(res, error); }
  });

  router.get('/usage', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    res.json(database.getApiUsage(profile));
  });

  return router;
}

module.exports = { createApmRouter };
