'use strict';

const express = require('express');
const { ArchitectureAwsDiscoveryService } = require('../lib/architecture/awsDiscoveryService');
const { ArchitectureGraphService } = require('../lib/architecture/graphService');

function createArchitectureRouter({ database, auditLog, graphService, discoveryService, deploymentReader, relationshipReader }) {
  if (!database) throw new Error('database is required');
  const router = express.Router();
  const service = graphService || new ArchitectureGraphService({ database });
  const discovery = discoveryService || new ArchitectureAwsDiscoveryService({
    deploymentReader,
    relationshipReader,
    graphService: service,
  });

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

  router.get('/projects', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    res.json(database.listProjects({ profileId: profile }));
  });

  router.post('/projects', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      const project = database.createProject({ ...req.body, profileId: profile });
      log('Project created', project.name, profile, { projectId: project.id });
      res.status(201).json(project);
    } catch (error) { handleError(res, error); }
  });

  router.get('/projects/:projectId', (req, res) => {
    const project = scopedProject(req, res);
    if (project) res.json(project);
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
      const graph = database.saveGraph(project.id, req.body?.document, {
        expectedRevision: req.body?.expectedRevision,
      });
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
      const graph = service.applyOperation(project.id, req.body?.operation, {
        expectedRevision: req.body?.expectedRevision,
        author: project.profileId,
        reason: req.body?.reason,
      });
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
      }));
    } catch (error) { handleError(res, error); }
  });

  router.post('/projects/:projectId/discovery/aws/import', async (req, res) => {
    const project = scopedProject(req, res);
    if (!project) return;
    try {
      const graph = await discovery.importSelection(project.id, {
        profileId: project.profileId,
        region: req.body?.region || 'us-east-1',
        accountId: req.body?.accountId,
        stackNames: req.body?.stackNames,
        selectedNodeIds: req.body?.selectedNodeIds,
        expectedRevision: req.body?.expectedRevision,
        author: project.profileId,
        reason: req.body?.reason,
      });
      log('AWS resources imported', project.name, project.profileId, {
        projectId: project.id,
        resourceCount: req.body?.selectedNodeIds?.length || 0,
        revision: graph.revision,
      });
      res.json(graph);
    } catch (error) { handleError(res, error); }
  });

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