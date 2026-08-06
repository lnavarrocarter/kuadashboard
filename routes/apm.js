'use strict';

const express = require('express');
const { discoverResourceCandidates } = require('../lib/apm/correlation');
const { createAwsDeploymentReader } = require('../lib/apm/awsDeploymentReader');
const { evaluateThresholds } = require('../lib/apm/thresholds');

function createApmRouter({ database, scheduler, auditLog, deploymentReader = createAwsDeploymentReader() }) {
  if (!database || !scheduler) throw new Error('database and scheduler are required');
  const router = express.Router();

  function profileId(req, res) {
    const value = req.get('X-Profile-Id');
    if (!value) res.status(400).json({ error: 'X-Profile-Id header is required' });
    return value;
  }

  function scopedApplication(req, res) {
    const profile = profileId(req, res);
    if (!profile) return null;
    const application = database.getApplication(req.params.applicationId);
    if (!application || application.profileId !== profile) {
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

  router.get('/applications', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    res.json(database.listApplications({ profileId: profile, region: req.query.region || undefined }));
  });

  router.post('/applications', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    try {
      const application = database.createApplication({ ...req.body, profileId: profile });
      log('Application created', application.name, profile, { region: application.region });
      res.status(201).json(application);
    } catch (error) { handleError(res, error); }
  });

  router.post('/candidates', (req, res) => {
    const profile = profileId(req, res);
    if (!profile) return;
    const resources = req.body?.resources;
    if (!Array.isArray(resources) || resources.length > 500 ||
        resources.some(resource => !resource || typeof resource !== 'object' || Array.isArray(resource))) {
      return res.status(400).json({ error: 'resources must be an array with at most 500 objects' });
    }
    const applications = database.listApplications({ profileId: profile });
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
    log('Resource removed', `${resource.type}/${resource.name}`, application.profileId);
    res.status(204).end();
  });

  router.get('/applications/:applicationId/topology', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    res.json({
      application,
      resources: database.listResources(application.id),
      edges: database.listEdges(application.id),
    });
  });

  router.post('/applications/:applicationId/edges', (req, res) => {
    const application = scopedApplication(req, res);
    if (!application) return;
    try {
      const edge = database.addEdge(application.id, req.body);
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