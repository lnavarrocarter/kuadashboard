'use strict';

const express = require('express');
const { ArchitectureAwsDiscoveryService } = require('../lib/architecture/awsDiscoveryService');
const { ArchitectureGraphService, discoveryIdentityKeys } = require('../lib/architecture/graphService');
const { KubernetesAdapter } = require('../lib/kua/kubernetesAdapter');
const { ApplicationRegistryService } = require('../lib/kua/applicationRegistryService');
const { ArchitectureCloudDiscoveryService } = require('../lib/architecture/cloudDiscoveryService');
const { createGcpDiscoveryReader } = require('../lib/architecture/gcpDiscoveryReader');
const { createVercelDiscoveryReader } = require('../lib/architecture/vercelDiscoveryReader');

function createArchitectureRouter({ database, apmDatabase, auditLog, graphService, discoveryService, kubernetesAdapter = new KubernetesAdapter(), deploymentReader, inventoryReader, relationshipReader, gcpDiscoveryService, vercelDiscoveryService }) {
  if (!database) throw new Error('database is required');
  const router = express.Router();
  const service = graphService || new ArchitectureGraphService({ database });
  const discovery = discoveryService || new ArchitectureAwsDiscoveryService({
    deploymentReader,
    inventoryReader,
    relationshipReader,
    graphService: service,
  });
  const gcpDiscovery = gcpDiscoveryService || new ArchitectureCloudDiscoveryService({
    provider: 'gcp', reader: createGcpDiscoveryReader(), graphService: service,
  });
  const vercelDiscovery = vercelDiscoveryService || new ArchitectureCloudDiscoveryService({
    provider: 'vercel', reader: createVercelDiscoveryReader(), graphService: service,
  });
  const registry = apmDatabase ? new ApplicationRegistryService({ database: apmDatabase, architectureDatabase: database }) : null;

  function profileId(req, res) {
    const value = req.get('X-Profile-Id');
    if (!value) res.status(400).json({ error: 'X-Profile-Id header is required' });
    return value;
  }

  function scopedProject(req, res) {
    const profile = profileId(req, res);
    if (!profile) return null;
    const project = database.getProject(req.params.projectId);
    if (!project || project.profileId !== profile) {
      res.status(404).json({ error: 'Architecture project not found' });
      return null;
    }
    return project;
  }

  function handleError(res, error) {
    const status = error.statusCode || error.$metadata?.httpStatusCode ||
      (/UNIQUE constraint failed/.test(error.message) ? 409 : 500);
    res.status(status).json({ error: error.message || 'Internal server error' });
  }

  function log(action, resource, context, details) {
    auditLog?.log({ category: 'architecture', action, resource, context, details });
  }

  function reconcileLinkedApplication(project) {
    const applications = apmDatabase?.listApplicationsByArchitectureProjectId
      ? apmDatabase.listApplicationsByArchitectureProjectId(project.id)
      : [apmDatabase?.getApplicationByArchitectureProjectId(project.id)].filter(Boolean);
    if (!registry) return null;
    applications.filter(application => application.profileId === project.profileId)
      .forEach(application => registry.reconcile(application));
    return applications.length ? database.getGraph(project.id) : null;
  }

  // Lets discovery panels show which preview resources are already part of the project's graph,
  // instead of silently letting the user re-select and re-import something that's already there.
  function markExistingNodes(nodes, projectId) {
    const graph = database.getGraph(projectId);
    const existingIdentity = new Map();
    for (const existingNode of graph?.document?.nodes || []) {
      for (const key of discoveryIdentityKeys(existingNode)) {
        if (!existingIdentity.has(key)) existingIdentity.set(key, existingNode);
      }
    }
    for (const node of nodes) {
      const existing = discoveryIdentityKeys(node).map(key => existingIdentity.get(key)).find(Boolean);
      node.alreadyInGraph = !!existing;
      node.existingNodeId = existing?.id || null;
    }
  }

  router.get('/projects', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    const applicationId = String(req.query.applicationId || '').trim();
    if (applicationId) {
      const application = apmDatabase?.getApplication(applicationId);
      if (!application || application.profileId !== profile) return res.status(404).json({ error: 'KUA Application not found' });
      const projectIds = apmDatabase?.listArchitectureProjectsByApplicationId
        ? apmDatabase.listArchitectureProjectsByApplicationId(application.id)
        : [application.architectureProjectId].filter(Boolean);
      return res.json(projectIds.map(projectId => database.getProject(projectId))
        .filter(project => project && project.profileId === profile));
    }
    res.json(database.listProjects({ profileId: profile }));
  });

  router.get('/applications', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    if (!apmDatabase) return res.json([]);
    res.json(apmDatabase.listApplications({ profileId: profile }));
  });

  // Used only by the first Architecture screen, before a KUA Application has
  // supplied the profile scope needed by the rest of the workspace.
  router.get('/applications/catalog', (req, res) => {
    if (!apmDatabase) return res.json([]);
    res.json(apmDatabase.listApplications());
  });

  router.post('/projects', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      const applicationId = String(req.body?.applicationId || '').trim();
      const application = applicationId ? apmDatabase?.getApplication(applicationId) : null;
      if (applicationId && (!application || application.profileId !== profile)) {
        return res.status(404).json({ error: 'KUA Application not found' });
      }
      const project = database.createProject({ ...req.body, profileId: profile });
      if (application && apmDatabase) {
        const updated = apmDatabase.updateArchitectureProjectLink(application.id, project.id);
        registry?.reconcile(updated);
      }
      log('Project created', project.name, profile, { projectId: project.id });
      res.status(201).json(project);
    } catch (error) { handleError(res, error); }
  });

  router.get('/projects/:projectId', (req, res) => {
    const project = scopedProject(req, res);
    if (project) res.json(project);
  });

  router.get('/projects/:projectId/application', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    const applications = apmDatabase?.listApplicationsByArchitectureProjectId
      ? apmDatabase.listApplicationsByArchitectureProjectId(project.id)
      : [apmDatabase?.getApplicationByArchitectureProjectId(project.id)].filter(Boolean);
    const scopedApplications = applications.filter(application => application.profileId === project.profileId);
    res.json({ application: scopedApplications[0] || null, applications: scopedApplications });
  });

  router.get('/projects/:projectId/applications', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    const applications = apmDatabase?.listApplicationsByArchitectureProjectId
      ? apmDatabase.listApplicationsByArchitectureProjectId(project.id)
      : [apmDatabase?.getApplicationByArchitectureProjectId(project.id)].filter(Boolean);
    res.json(applications.filter(application => application.profileId === project.profileId));
  });

  router.post('/projects/:projectId/applications', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      const applicationId = String(req.body?.applicationId || '').trim();
      const application = apmDatabase?.getApplication(applicationId);
      if (!application || application.profileId !== project.profileId) {
        return res.status(404).json({ error: 'KUA Application not found' });
      }
      const updated = apmDatabase.updateArchitectureProjectLink(application.id, project.id);
      registry?.reconcile(updated);
      res.status(201).json({ application: updated, applications: apmDatabase.listApplicationsByArchitectureProjectId(project.id) });
    } catch (error) { handleError(res, error); }
  });

  router.delete('/projects/:projectId/applications/:applicationId', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      const application = apmDatabase?.getApplication(req.params.applicationId);
      if (!application || application.profileId !== project.profileId) return res.status(404).json({ error: 'KUA Application not found' });
      const updated = apmDatabase.unlinkArchitectureProject(application.id, project.id);
      registry?.reconcile(updated);
      res.status(200).json({ application: updated });
    } catch (error) { handleError(res, error); }
  });

  router.delete('/projects/:projectId', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      const applications = apmDatabase?.listApplicationsByArchitectureProjectId
        ? apmDatabase.listApplicationsByArchitectureProjectId(project.id)
        : [apmDatabase?.getApplicationByArchitectureProjectId(project.id)].filter(Boolean);
      database.deleteProject(project.id);
      applications.forEach(application => {
        const updated = apmDatabase?.unlinkArchitectureProject
          ? apmDatabase.unlinkArchitectureProject(application.id, project.id)
          : apmDatabase?.updateArchitectureProjectLink(application.id, null);
        registry?.reconcile(updated);
      });
      log('Project deleted', project.name, project.profileId, { projectId: project.id });
      res.status(204).end();
    } catch (error) { handleError(res, error); }
  });

  router.get('/projects/:projectId/graph', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    res.json(database.getGraph(project.id));
  });

  router.put('/projects/:projectId/graph', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      let graph = database.saveGraph(project.id, req.body?.document, {
        expectedRevision: req.body?.expectedRevision,
      });
      graph = reconcileLinkedApplication(project) || graph;
      log('Graph updated', project.name, project.profileId, {
        projectId: project.id,
        revision: graph.revision,
      });
      res.json(graph);
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/operations', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      let graph = service.applyOperation(project.id, req.body?.operation, {
        expectedRevision: req.body?.expectedRevision,
        automaticEdgeThreshold: project.automaticEdgeThreshold,
        author: project.profileId,
        reason: req.body?.reason,
      });
      graph = reconcileLinkedApplication(project) || graph;
      log('Graph operation applied', project.name, project.profileId, {
        projectId: project.id,
        operation: req.body?.operation?.type,
        revision: graph.revision,
      });
      res.json(graph);
    } catch (error) { handleError(res, error); }
  });

  router.get('/projects/:projectId/changes', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      res.json(database.listChanges(project.id, { limit: req.query.limit }));
    } catch (error) { handleError(res, error); }
  });

  router.get('/projects/:projectId/discovery/aws/deployments', async (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      res.json(await discovery.listDeployments({
        profileId: project.profileId,
        region: req.query.region || 'us-east-1',
      }));
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/discovery/aws/preview', async (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      res.json(await discovery.preview({
        profileId: project.profileId,
        region: req.body?.region || 'us-east-1',
        accountId: req.body?.accountId,
        stackNames: req.body?.stackNames,
        lambdaCodeAnalysisNames: req.body?.lambdaCodeAnalysisNames,
        projectId: project.id,
      }));
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/discovery/aws/sync-preview', async (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      res.json(await discovery.previewSync(project.id, {
        profileId: project.profileId,
        region: req.body?.region || 'us-east-1',
        accountId: req.body?.accountId,
        stackNames: req.body?.stackNames,
        automaticEdgeThreshold: project.automaticEdgeThreshold,
      }));
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/discovery/aws/sync-apply', async (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      let graph = await discovery.applySync(project.id, {
        profileId: project.profileId,
        region: req.body?.region || 'us-east-1',
        accountId: req.body?.accountId,
        stackNames: req.body?.stackNames,
        automaticEdgeThreshold: project.automaticEdgeThreshold,
        expectedRevision: req.body?.expectedRevision,
        author: project.profileId,
        reason: req.body?.reason,
      });
      graph = reconcileLinkedApplication(project) || graph;
      log('AWS synchronization applied', project.name, project.profileId, {
        projectId: project.id,
        revision: graph.revision,
      });
      res.json(graph);
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/discovery/aws/import', async (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      let graph = await discovery.importSelection(project.id, {
        profileId: project.profileId,
        region: req.body?.region || 'us-east-1',
        accountId: req.body?.accountId,
        stackNames: req.body?.stackNames,
        selectedNodeIds: req.body?.selectedNodeIds,
        expectedRevision: req.body?.expectedRevision,
        author: project.profileId,
        reason: req.body?.reason,
      });
      graph = reconcileLinkedApplication(project) || graph;
      log('AWS resources imported', project.name, project.profileId, {
        projectId: project.id,
        resourceCount: req.body?.selectedNodeIds?.length || 0,
        revision: graph.revision,
      });
      res.json(graph);
    } catch (error) { handleError(res, error); }
  });

  router.get('/projects/:projectId/discovery/kubernetes/contexts', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      res.json({ contexts: kubernetesAdapter.listContexts({ provider: 'generic' }) });
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/discovery/kubernetes/preview', async (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      const preview = await kubernetesAdapter.preview({
        provider: 'generic', contexts: req.body?.contexts, namespaces: req.body?.namespaces,
      });
      markExistingNodes(preview.nodes, project.id);
      res.json({
        ...preview,
        projectId: project.id,
        profileId: project.profileId,
        sources: preview.sources.map(source => ({ ...source, profileId: project.profileId })),
      });
    } catch (error) { handleError(res, error); }
  });

  for (const [provider, cloudDiscovery] of [['gcp', gcpDiscovery], ['vercel', vercelDiscovery]]) {
    router.post(`/projects/:projectId/discovery/${provider}/preview`, async (req, res) => {
      const project = scopedProject(req, res);
      if (!project) return;
      try {
        res.json(await cloudDiscovery.preview({ profileId: project.profileId, projectId: project.id }));
      } catch (error) { handleError(res, error); }
    });

    router.post(`/projects/:projectId/discovery/${provider}/import`, async (req, res) => {
      const project = scopedProject(req, res);
      if (!project) return;
      try {
        let graph = await cloudDiscovery.importSelection(project.id, {
          profileId: project.profileId,
          selectedNodeIds: req.body?.selectedNodeIds,
          expectedRevision: req.body?.expectedRevision,
          author: project.profileId,
          reason: req.body?.reason,
        });
        graph = reconcileLinkedApplication(project) || graph;
        log(`${provider.toUpperCase()} resources imported`, project.name, project.profileId, {
          projectId: project.id,
          resourceCount: req.body?.selectedNodeIds?.length || 0,
          revision: graph.revision,
        });
        res.json(graph);
      } catch (error) { handleError(res, error); }
    });
  }

  router.get('/projects/:projectId/snapshots', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    res.json(database.listSnapshots(project.id));
  });

  router.post('/projects/:projectId/snapshots', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      const snapshot = database.createSnapshot(project.id, req.body);
      log('Snapshot created', project.name, project.profileId, {
        projectId: project.id,
        snapshotId: snapshot.id,
        version: snapshot.version,
      });
      res.status(201).json(snapshot);
    } catch (error) { handleError(res, error); }
  });

  router.get('/projects/:projectId/snapshots/:snapshotId', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    const snapshot = database.getSnapshot(project.id, req.params.snapshotId);
    if (!snapshot) return res.status(404).json({ error: 'Architecture snapshot not found' });
    res.json(snapshot);
  });

  router.get('/projects/:projectId/snapshots/:snapshotId/diff', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      res.json(service.diffSnapshot(project.id, req.params.snapshotId));
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/snapshots/:snapshotId/revert', (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      const result = service.revertSnapshot(project.id, req.params.snapshotId, {
        expectedRevision: req.body?.expectedRevision,
        name: req.body?.name,
        description: req.body?.description,
        reason: req.body?.reason,
        author: project.profileId,
      });
      result.graph = reconcileLinkedApplication(project) || result.graph;
      log('Snapshot reverted', project.name, project.profileId, {
        projectId: project.id,
        sourceSnapshotId: req.params.snapshotId,
        snapshotId: result.snapshot.id,
        revision: result.graph.revision,
      });
      res.status(201).json(result);
    } catch (error) { handleError(res, error); }
  });

  return router;
}

module.exports = { createArchitectureRouter };
