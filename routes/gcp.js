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
 *   Local gcloud configs: prefix "local:" + config name (e.g. "local:default").
 *   Uses Application Default Credentials (ADC) — requires `gcloud auth application-default login`.
 *
 * Endpoints:
 *   GET  /gcloud-configs                    → list local gcloud configurations
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
const { exec }       = require('child_process');
const { promisify }  = require('util');
const { getStore } = require('../lib/credentialStore');

const router    = express.Router();
const execAsync = promisify(exec);
const isWin     = process.platform === 'win32';

// ─── gcloud CLI helpers ───────────────────────────────────────────────────────

/**
 * Run a gcloud command via the system shell so it inherits the user's PATH.
 * Returns stdout as a string, or throws on non-zero exit.
 */
async function gcloudExec(args, timeout = 10000) {
  const cmd  = `gcloud ${args}`;
  const opts = { timeout, windowsHide: true };
  const { stdout } = await execAsync(
    isWin ? `powershell -NoProfile -NonInteractive -Command "${cmd}"` : `sh -c "${cmd}"`,
    opts
  );
  return stdout.trim();
}

/**
 * List local gcloud configurations using the CLI.
 * Returns: [{ name, project, account, isActive }]
 */
async function readGcloudConfigs() {
  try {
    const raw  = await gcloudExec('config configurations list --format=json');
    const list = JSON.parse(raw);
    return list.map(c => ({
      name:     c.name,
      project:  c.properties?.core?.project  || null,
      account:  c.properties?.core?.account  || null,
      region:   c.properties?.compute?.region || null,
      isActive: c.is_active === true,
    }));
  } catch {
    return [];
  }
}

/**
 * Get an OAuth2 access token for the given gcloud configuration name.
 * Uses: gcloud auth print-access-token --configuration=<name>
 */
async function getGcloudAccessToken(configName) {
  const token = await gcloudExec(`auth print-access-token --configuration=${configName}`);
  if (!token) throw new Error(`No access token returned for gcloud config: ${configName}`);
  return token;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function handleErr(res, err) {
  console.error('[gcp]', err.message);
  const status = err.code === 403 ? 403 : err.code === 404 ? 404 : 500;
  res.status(status).json({ error: err.message });
}

/**
 * Build a Google Auth client from a stored profile or local gcloud config.
 * Returns { auth, projectId } or throws.
 *
 * - profileId starting with "local:" → use `gcloud auth print-access-token` for the named config
 * - otherwise → load from credentialStore using GCP_SERVICE_ACCOUNT_JSON
 */
async function resolveGcpAuth(profileId) {
  // ── Local gcloud config ───────────────────────────────────────────────────
  if (profileId.startsWith('local:')) {
    const configName = profileId.slice(6);
    const configs    = await readGcloudConfigs();
    const cfg        = configs.find(c => c.name === configName);
    if (!cfg) throw Object.assign(new Error(`gcloud config not found: ${configName}`), { code: 404 });

    // Obtain a fresh OAuth2 access token via the gcloud CLI.
    // This honours whichever account is active in that config.
    const accessToken = await getGcloudAccessToken(configName);

    // google-gax (v4+) requires a GoogleAuth instance (needs getUniverseDomain +
    // getClient). We pre-populate cachedCredential so GoogleAuth.getClient()
    // returns our token-backed OAuth2Client without attempting ADC discovery.
    const { GoogleAuth, OAuth2Client } = require('google-auth-library');
    const tokenClient = new OAuth2Client();
    tokenClient.setCredentials({ access_token: accessToken });
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    auth.cachedCredential = tokenClient;
    return { auth, projectId: cfg.project || null, credentials: {}, accessToken };
  }

  // ── Stored profile ────────────────────────────────────────────────────────
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

// ─── GET /gcloud-configs ──────────────────────────────────────────────────────

router.get('/gcloud-configs', async (_req, res) => {
  try {
    res.json(await readGcloudConfigs());
  } catch (err) { handleErr(res, err); }
});

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

// ─── REST helper (Node 18+ native fetch) ─────────────────────────────────────

/**
 * Make an authenticated GCP REST call.
 * authCtx = { auth, accessToken? } as returned by resolveGcpAuth().
 */
async function gcpFetch(url, authCtx, method = 'GET', body = undefined) {
  let token = authCtx.accessToken;
  if (!token) {
    const client = await authCtx.auth.getClient();
    const t      = await client.getAccessToken();
    token = t.token;
  }
  const opts = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(text), { code: res.status });
  return text ? JSON.parse(text) : {};
}

// ─── GET /sql ────────────────────────────────────────────────────────────────

router.get('/sql', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances`,
      authCtx
    );
    res.json((data.items || []).map(i => ({
      name:        i.name,
      database:    i.databaseVersion,
      region:      i.region,
      state:       i.state,
      tier:        i.settings?.tier,
      ipAddress:   i.ipAddresses?.[0]?.ipAddress || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── POST /sql/:instance/start ────────────────────────────────────────────────

router.post('/sql/:instance/start', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    await gcpFetch(
      `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances/${req.params.instance}`,
      authCtx, 'PATCH', { settings: { activationPolicy: 'ALWAYS' } }
    );
    res.json({ success: true, instance: req.params.instance, action: 'start' });
  } catch (err) { handleErr(res, err); }
});

// ─── POST /sql/:instance/stop ─────────────────────────────────────────────────

router.post('/sql/:instance/stop', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    await gcpFetch(
      `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances/${req.params.instance}`,
      authCtx, 'PATCH', { settings: { activationPolicy: 'NEVER' } }
    );
    res.json({ success: true, instance: req.params.instance, action: 'stop' });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /storage/buckets ─────────────────────────────────────────────────────

router.get('/storage/buckets', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://storage.googleapis.com/storage/v1/b?project=${projectId}&maxResults=200`,
      authCtx
    );
    res.json((data.items || []).map(b => ({
      name:         b.name,
      location:     b.location,
      storageClass: b.storageClass,
      created:      b.timeCreated,
      publicAccess: b.iamConfiguration?.publicAccessPrevention !== 'enforced',
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /functions ───────────────────────────────────────────────────────────

router.get('/functions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/-/functions`,
      authCtx
    );
    res.json((data.functions || []).map(f => ({
      name:     f.name?.split('/').pop(),
      location: f.name?.split('/')[5],
      runtime:  f.buildConfig?.runtime,
      state:    f.state,
      trigger:  f.eventTrigger?.eventType ? 'EVENT' : 'HTTPS',
      url:      f.serviceConfig?.uri,
      updated:  f.updateTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── GET /pubsub/topics ───────────────────────────────────────────────────────

router.get('/pubsub/topics', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://pubsub.googleapis.com/v1/projects/${projectId}/topics`,
      authCtx
    );
    res.json((data.topics || []).map(t => ({
      name:   t.name?.split('/').pop(),
      labels: Object.entries(t.labels || {}).map(([k, v]) => `${k}=${v}`).join(', '),
    })));
  } catch (err) { handleErr(res, err); }
});

module.exports = router;
