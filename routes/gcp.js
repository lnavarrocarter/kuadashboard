'use strict';
/**
 * routes/gcp.js
 * Google Cloud Platform integration endpoints.
 *
 * Base path: /api/cloud/gcp
 *
 * Authentication model:
 *   All GCP requests require a `X-Profile-Id` header that references a credential
 *   profile stored in the credentialStore. The profile must have a `GCP_SERVICE_ACCOUNT_JSON`
 *   key containing the full Service Account JSON string.
 *   Alternatively, `GCP_PROJECT_ID` can be stored in the profile or passed via header.
 *
 * Endpoints:
 *   GET  /projects                          → list accessible projects
 *   GET  /gke                               → list GKE clusters (requires GCP_PROJECT_ID)
 *   GET  /cloudrun                          → list Cloud Run services
 *   POST /cloudrun/:region/:service/start   → set Cloud Run min-instances to 1
 *   POST /cloudrun/:region/:service/stop    → set Cloud Run min-instances to 0
 *   GET  /compute/vms                       → list Compute Engine instances
 *   POST /compute/vms/:zone/:name/start     → start VM instance
 *   POST /compute/vms/:zone/:name/stop      → stop VM instance
 *
 * NOTE: The Google Cloud SDK packages are lazy-required. Install them with:
 *   npm install @google-cloud/resource-manager @google-cloud/container @google-cloud/run @google-cloud/compute
 */

const express  = require('express');
const { getStore } = require('../lib/credentialStore');

const router = express.Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleErr(res, err) {
  console.error('[gcp]', err.message);
  const status = err.code === 403 ? 403 : err.code === 404 ? 404 : 500;
  res.status(status).json({ error: err.message });
}

/**
 * Build a Google Auth client from a stored profile.
 * Returns { auth, projectId } or throws.
 */
async function resolveGcpAuth(profileId) {
  const store = getStore();
  const keys  = await store.getRawKeys(profileId);
  if (!keys) throw Object.assign(new Error('Credential profile not found'), { code: 404 });

  const saJson = keys['GCP_SERVICE_ACCOUNT_JSON'];
  if (!saJson)  throw Object.assign(new Error('Profile is missing GCP_SERVICE_ACCOUNT_JSON'), { code: 400 });

  let credentials;
  try { credentials = JSON.parse(saJson); } catch {
    throw Object.assign(new Error('GCP_SERVICE_ACCOUNT_JSON is not valid JSON'), { code: 400 });
  }

  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const projectId = keys['GCP_PROJECT_ID'] || credentials.project_id || null;
  return { auth, projectId, credentials };
}

/** Read X-Profile-Id header or return 400 */
function requireProfileId(req, res) {
  const id = req.headers['x-profile-id'];
  if (!id) { res.status(400).json({ error: 'X-Profile-Id header is required' }); return null; }
  return id;
}

// ─── GET /projects ────────────────────────────────────────────────────────────

router.get('/projects', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth } = await resolveGcpAuth(profileId);
    const { ProjectsClient } = require('@google-cloud/resource-manager').v3;
    const client   = new ProjectsClient({ auth });
    const [projects] = await client.searchProjects();
    res.json(projects.map(p => ({
      id:          p.projectId,
      name:        p.displayName,
      state:       p.state,
      createTime:  p.createTime?.seconds,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /gke ─────────────────────────────────────────────────────────────────

router.get('/gke', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required for GKE listing' });

    const { ClusterManagerClient } = require('@google-cloud/container');
    const client   = new ClusterManagerClient({ auth });
    const [resp]   = await client.listClusters({ parent: `projects/${projectId}/locations/-` });
    res.json((resp.clusters || []).map(c => ({
      name:        c.name,
      location:    c.location,
      status:      c.status,
      nodeCount:   c.currentNodeCount,
      version:     c.currentMasterVersion,
      endpoint:    c.endpoint,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /cloudrun ────────────────────────────────────────────────────────────

router.get('/cloudrun', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const { ServicesClient } = require('@google-cloud/run').v2;
    const client = new ServicesClient({ auth });
    const [services] = await client.listServices({ parent: `projects/${projectId}/locations/-` });
    res.json((services || []).map(s => ({
      name:     s.name?.split('/').pop(),
      region:   s.name?.split('/')[3],
      uri:      s.uri,
      status:   s.reconciling ? 'reconciling' : 'ready',
      minInstances: s.template?.scaling?.minInstanceCount ?? 0,
      maxInstances: s.template?.scaling?.maxInstanceCount ?? null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── POST /cloudrun/:region/:service/start ────────────────────────────────────

router.post('/cloudrun/:region/:service/start', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const { region, service } = req.params;
    const { ServicesClient }  = require('@google-cloud/run').v2;
    const client = new ServicesClient({ auth });
    const name   = `projects/${projectId}/locations/${region}/services/${service}`;

    // Patch: set minInstanceCount to 1 to "warm up" the service
    const [operation] = await client.updateService({
      service: { name, template: { scaling: { minInstanceCount: 1 } } },
      updateMask: { paths: ['template.scaling.min_instance_count'] },
    });
    await operation.promise();
    res.json({ success: true, service, region, action: 'start', minInstances: 1 });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /cloudrun/:region/:service/stop ─────────────────────────────────────

router.post('/cloudrun/:region/:service/stop', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const { region, service } = req.params;
    const { ServicesClient }  = require('@google-cloud/run').v2;
    const client = new ServicesClient({ auth });
    const name   = `projects/${projectId}/locations/${region}/services/${service}`;

    const [operation] = await client.updateService({
      service: { name, template: { scaling: { minInstanceCount: 0 } } },
      updateMask: { paths: ['template.scaling.min_instance_count'] },
    });
    await operation.promise();
    res.json({ success: true, service, region, action: 'stop', minInstances: 0 });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /compute/vms ─────────────────────────────────────────────────────────

router.get('/compute/vms', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const { InstancesClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const vms    = [];

    // aggregatedList iterates all zones
    const aggList = client.aggregatedListAsync({ project: projectId });
    for await (const [_zone, zoneData] of aggList) {
      for (const vm of (zoneData.instances || [])) {
        vms.push({
          name:       vm.name,
          zone:       vm.zone?.split('/').pop(),
          status:     vm.status,
          machineType: vm.machineType?.split('/').pop(),
          externalIp:  vm.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null,
          internalIp:  vm.networkInterfaces?.[0]?.networkIP || null,
          createdAt:   vm.creationTimestamp,
        });
      }
    }
    res.json(vms);
  } catch (err) { handleErr(res, err); }
});

// ─── POST /compute/vms/:zone/:name/start ──────────────────────────────────────

router.post('/compute/vms/:zone/:name/start', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const { zone, name }     = req.params;
    const { InstancesClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const [operation] = await client.start({ project: projectId, zone, instance: name });
    await operation.promise();
    res.json({ success: true, instance: name, zone, action: 'start' });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /compute/vms/:zone/:name/stop ───────────────────────────────────────

router.post('/compute/vms/:zone/:name/stop', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const { zone, name }     = req.params;
    const { InstancesClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const [operation] = await client.stop({ project: projectId, zone, instance: name });
    await operation.promise();
    res.json({ success: true, instance: name, zone, action: 'stop' });
  } catch (err) { handleErr(res, err); }
});

module.exports = router;
