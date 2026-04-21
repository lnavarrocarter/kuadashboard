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

// ─── GET /gcloud-accounts ─────────────────────────────────────────────────────
// Lists already-authenticated Google accounts via `gcloud auth list`.

router.get('/gcloud-accounts', async (_req, res) => {
  try {
    const raw  = await gcloudExec('auth list --format=json');
    const list = JSON.parse(raw || '[]');
    res.json(list.map(a => ({
      account: a.account,
      status:  a.status,   // 'ACTIVE' | 'CREDENTIALED'
    })));
  } catch (err) {
    res.json([]); // not a fatal error — user may just have no accounts yet
  }
});

// ─── POST /gcloud-login ───────────────────────────────────────────────────────
// Launches `gcloud auth login` in a detached shell so the browser opens on the
// host machine. The process is fire-and-forget — the frontend polls /gcloud-configs
// to detect when a new account/config appears.
// Body: { configName? } — if provided, creates (or reuses) that named config first.

router.post('/gcloud-login', async (req, res) => {
  const { configName } = req.body || {};

  // Validate config name if provided
  if (configName && !/^[a-zA-Z0-9_\-]+$/.test(configName)) {
    return res.status(400).json({ error: 'Invalid config name (alphanumeric, - and _ only)' });
  }

  try {
    const { spawn } = require('child_process');

    // Build the gcloud command sequence:
    // 1. Create the config if it doesn't exist yet
    // 2. Activate it
    // 3. Run auth login inside it
    let cmd, args;

    if (isWin) {
      // On Windows open a new terminal window so the user can complete the browser flow
      const loginCmd = configName
        ? `gcloud config configurations create ${configName} --no-activate 2>nul; gcloud config configurations activate ${configName}; gcloud auth login --configuration=${configName}`
        : 'gcloud auth login';
      cmd  = 'cmd.exe';
      args = ['/c', 'start', 'cmd.exe', '/k', loginCmd];
    } else {
      // On macOS/Linux use the default terminal emulator or run in background
      const loginCmd = configName
        ? `gcloud config configurations create ${configName} 2>/dev/null; gcloud config configurations activate ${configName}; gcloud auth login --configuration=${configName}`
        : 'gcloud auth login';
      cmd  = 'sh';
      args = ['-c', loginCmd];
    }

    const child = spawn(cmd, args, {
      detached:  true,
      stdio:     'ignore',
      windowsHide: false,  // show the terminal so user can complete OAuth
    });
    child.unref();

    res.json({ success: true, message: 'gcloud auth login launched — complete the browser flow, then click Refresh.' });
  } catch (err) {
    handleErr(res, err);
  }
});

// ─── POST /gcloud-configs ─────────────────────────────────────────────────────
// Creates a new named gcloud configuration and optionally sets project / account.
// Body: { name, project?, account?, region? }

router.post('/gcloud-configs', async (req, res) => {
  const { name, project, account, region } = req.body || {};

  if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
    return res.status(400).json({ error: 'name is required (alphanumeric, - and _ only)' });
  }

  try {
    // Create config (ignore error if already exists)
    await gcloudExec(`config configurations create ${name}`).catch(() => {});
    // Activate it to set properties on it
    if (project) await gcloudExec(`config set project ${project} --configuration=${name}`);
    if (account) await gcloudExec(`config set account ${account} --configuration=${name}`);
    if (region)  await gcloudExec(`config set compute/region ${region} --configuration=${name}`);

    const configs = await readGcloudConfigs();
    const created = configs.find(c => c.name === name) || null;
    res.json({ success: true, config: created });
  } catch (err) {
    handleErr(res, err);
  }
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
      name:          c.name,
      location:      c.location,
      status:        c.status,
      nodeCount:     c.currentNodeCount,
      version:       c.currentMasterVersion,
      endpoint:      c.endpoint,
      autopilot:     !!c.autopilot?.enabled,
      nodePoolCount: c.nodePools?.length ?? 0,
      releaseChannel: c.releaseChannel?.channel || null,
    })));
  } catch (err) { handleErr(res, err); }
});

// ─── POST /gke/:location/:cluster/connect ─────────────────────────────────────
// Generates a kubeconfig for the GKE cluster and returns it for KUA to import.
// Works with both local gcloud configs and service account profiles.
// The context name follows the gcloud convention: gke_<project>_<location>_<cluster>

router.post('/gke/:location/:cluster/connect', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;

  const { location, cluster } = req.params;
  // Input validation to prevent injection
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(cluster)) {
    return res.status(400).json({ error: 'Invalid location or cluster name' });
  }

  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { auth, projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    // Fetch full cluster details to get endpoint and CA cert
    const { ClusterManagerClient } = require('@google-cloud/container');
    const client = new ClusterManagerClient({ auth });
    const [clusterData] = await client.getCluster({
      name: `projects/${projectId}/locations/${location}/clusters/${cluster}`,
    });

    const endpoint = clusterData.endpoint;
    const caCert   = clusterData.masterAuth?.clusterCaCertificate;
    if (!endpoint) {
      return res.status(400).json({ error: 'Cluster endpoint not available — cluster may still be provisioning' });
    }

    // Context name follows gcloud convention: gke_<project>_<location>_<cluster>
    const contextName = `gke_${projectId}_${location}_${cluster}`;

    // Obtain a short-lived access token for initial auth
    let token = authCtx.accessToken;
    if (!token) {
      const authClient = await auth.getClient();
      const tokenData  = await authClient.getAccessToken();
      token = tokenData.token;
    }

    // Build a kubeconfig with token-based auth
    const jsYaml = require('js-yaml');
    const kubeconfigObj = {
      apiVersion: 'v1',
      kind: 'Config',
      clusters: [{
        name: contextName,
        cluster: {
          server: `https://${endpoint}`,
          ...(caCert ? { 'certificate-authority-data': caCert } : { 'insecure-skip-tls-verify': true }),
        },
      }],
      users: [{
        name: contextName,
        user: { token },
      }],
      contexts: [{
        name: contextName,
        context: { cluster: contextName, user: contextName, namespace: 'default' },
      }],
      'current-context': contextName,
    };

    res.json({ success: true, contextName, kubeconfig: jsYaml.dump(kubeconfigObj) });
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── SECRET MANAGER ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /secrets → list all secrets (no values)
router.get('/secrets', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`,
      authCtx
    );
    res.json((data.secrets || []).map(s => ({
      name:        s.name?.split('/').pop(),
      replication: s.replication?.automatic ? 'automatic' : 'user-managed',
      created:     s.createTime,
      labels:      s.labels || {},
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /secrets/:name/preview-keys → access latest version, return key names + masked values
router.get('/secrets/:name/preview-keys', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  if (!/^[a-zA-Z0-9\-_]+$/.test(req.params.name)) {
    return res.status(400).json({ error: 'Invalid secret name' });
  }
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${req.params.name}/versions/latest:access`,
      authCtx
    );
    let secretValue = '';
    if (data.payload?.data) {
      secretValue = Buffer.from(data.payload.data, 'base64').toString('utf8');
    }
    let keys = [];
    try {
      const parsed = JSON.parse(secretValue);
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed)) {
          const sanitized = k.replace(/[^A-Z0-9_]/gi, '_').toUpperCase();
          if (sanitized) keys.push({ original: k, sanitized, preview: typeof v === 'string' ? v.slice(0, 4) + '***' : '[non-string]' });
        }
      } else {
        keys.push({ original: 'SECRET_VALUE', sanitized: 'SECRET_VALUE', preview: secretValue.slice(0, 4) + '***' });
      }
    } catch {
      keys.push({ original: 'SECRET_VALUE', sanitized: 'SECRET_VALUE', preview: secretValue.slice(0, 4) + '***' });
    }
    res.json({ keys, secretName: req.params.name });
  } catch (err) { handleErr(res, err); }
});

// POST /secrets/:name/import-selected → import chosen keys into Env Manager profile
router.post('/secrets/:name/import-selected', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  if (!/^[a-zA-Z0-9\-_]+$/.test(req.params.name)) {
    return res.status(400).json({ error: 'Invalid secret name' });
  }
  const { selectedKeys, targetProfileId, targetProfileName } = req.body || {};
  if (!selectedKeys?.length) return res.status(400).json({ error: 'No keys selected' });
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${req.params.name}/versions/latest:access`,
      authCtx
    );
    let secretValue = '';
    if (data.payload?.data) secretValue = Buffer.from(data.payload.data, 'base64').toString('utf8');
    let allParsed = {};
    try { allParsed = JSON.parse(secretValue); } catch { allParsed = { SECRET_VALUE: secretValue }; }
    const keys = {};
    for (const sel of selectedKeys) {
      const raw = allParsed[sel.original];
      if (raw !== undefined && typeof raw === 'string') keys[sel.sanitized] = raw;
    }
    if (!Object.keys(keys).length) return res.status(400).json({ error: 'No importable string values in selection' });
    const store = getStore();
    if (targetProfileId) {
      const existing = await store.getProfile(targetProfileId);
      if (!existing) return res.status(404).json({ error: 'Target profile not found' });
      await store.updateProfile(targetProfileId, { keys });
      res.json({ merged: true, profileId: targetProfileId, keysImported: Object.keys(keys).length });
    } else {
      const name = targetProfileName || `Secret: ${req.params.name}`;
      const profile = await store.createProfile({ name, provider: 'generic', category: 'Secret Manager', keys });
      res.json({ created: true, profileId: profile.id, keysImported: Object.keys(keys).length });
    }
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOUD FUNCTIONS — INVOKE & LOGS ─────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// POST /functions/:location/:name/invoke → call the function's HTTPS endpoint
router.post('/functions/:location/:name/invoke', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid location or function name' });
  }
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    // Fetch function details to find its HTTPS invoke URL
    const fnData = await gcpFetch(
      `https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/${location}/functions/${name}`,
      authCtx
    );
    const invokeUrl = fnData.serviceConfig?.uri;
    if (!invokeUrl) return res.status(400).json({ error: 'Function has no HTTPS endpoint (EVENT triggers cannot be invoked via HTTP)' });

    // Obtain a fresh access token (for calling the URL, not the API)
    let token = authCtx.accessToken;
    if (!token) {
      const client = await authCtx.auth.getClient();
      const t = await client.getAccessToken();
      token = t.token;
    }
    const payload = req.body || {};
    const invokeRes = await fetch(invokeUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await invokeRes.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    res.json({ statusCode: invokeRes.status, body });
  } catch (err) { handleErr(res, err); }
});

// GET /functions/:location/:name/logs → Cloud Logging entries for a function
router.get('/functions/:location/:name/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid location or function name' });
  }
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const hours = Math.min(parseInt(req.query.hours) || 3, 72);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    // Cloud Functions Gen 2 run as Cloud Run services
    const filter = [
      `(resource.type="cloud_run_revision" AND labels."goog-managed-by"="cloudfunctions" AND resource.labels.service_name="${name}")`,
      `OR (resource.type="cloud_function" AND resource.labels.function_name="${name}")`,
      `timestamp>="${since}"`,
    ].join(' ');
    const data = await gcpFetch('https://logging.googleapis.com/v2/entries:list', authCtx, 'POST', {
      resourceNames: [`projects/${projectId}`],
      filter,
      orderBy:  'timestamp desc',
      pageSize: limit,
    });
    res.json({
      entries: (data.entries || []).map(e => ({
        timestamp: e.timestamp,
        severity:  e.severity || 'DEFAULT',
        message:   e.textPayload || (e.jsonPayload ? JSON.stringify(e.jsonPayload) : ''),
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOUD STORAGE — BROWSER ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /storage/:bucket/browse → list objects with virtual-folder support
router.get('/storage/:bucket/browse', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const bucket  = req.params.bucket;
    const prefix    = req.query.prefix    || '';
    const pageToken = req.query.pageToken || '';
    const params = new URLSearchParams({ prefix, delimiter: '/', maxResults: '300' });
    if (pageToken) params.append('pageToken', pageToken);
    const data = await gcpFetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${params}`,
      authCtx
    );
    const folders = (data.prefixes || []).map(p => ({
      key:  p,
      name: p.slice(prefix.length).replace(/\/$/, ''),
    }));
    const files = (data.items || [])
      .filter(o => o.name !== prefix)
      .map(o => ({
        key:          o.name,
        name:         o.name.split('/').filter(Boolean).pop(),
        size:         parseInt(o.size) || 0,
        lastModified: o.updated,
        contentType:  o.contentType || '',
        storageClass: o.storageClass || '',
      }));
    res.json({ prefix, folders, files, nextPageToken: data.nextPageToken || null });
  } catch (err) { handleErr(res, err); }
});

// GET /storage/:bucket/object → metadata + inline preview (text/image/pdf)
router.get('/storage/:bucket/object', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'key is required' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const bucket  = req.params.bucket;
    // Metadata only first
    const meta = await gcpFetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`,
      authCtx
    );
    const contentType = meta.contentType || '';
    const size = parseInt(meta.size) || 0;
    const baseMeta = {
      key, contentType, size,
      lastModified: meta.updated,
      etag:         meta.etag,
      storageClass: meta.storageClass,
      generation:   meta.generation,
      md5Hash:      meta.md5Hash,
      metadata:     meta.metadata || {},
    };

    // Helper to fetch the object body
    async function fetchBody() {
      let token = authCtx.accessToken;
      if (!token) {
        const c = await authCtx.auth.getClient();
        token = (await c.getAccessToken()).token;
      }
      return fetch(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }

    // Image preview (≤10 MB)
    if (contentType.startsWith('image/') && size <= 10 * 1024 * 1024) {
      const r = await fetchBody();
      const base64 = Buffer.from(await r.arrayBuffer()).toString('base64');
      return res.json({ binary: false, image: true, base64, ...baseMeta });
    }
    // PDF preview (≤10 MB)
    if (contentType === 'application/pdf' && size <= 10 * 1024 * 1024) {
      const r = await fetchBody();
      const base64 = Buffer.from(await r.arrayBuffer()).toString('base64');
      return res.json({ binary: false, pdf: true, base64, ...baseMeta });
    }
    // Text / JSON preview (≤2 MB)
    const textTypes = ['text/', 'application/json', 'application/xml', 'application/yaml', 'application/x-yaml', 'application/javascript'];
    if (textTypes.some(t => contentType.includes(t)) && size <= 2 * 1024 * 1024) {
      const r    = await fetchBody();
      const body = await r.text();
      return res.json({ binary: false, body, ...baseMeta });
    }
    res.json({ binary: true, ...baseMeta });
  } catch (err) { handleErr(res, err); }
});

// GET /storage/:bucket/download → stream object to client
router.get('/storage/:bucket/download', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const key = req.query.key;
  if (!key) return res.status(400).json({ error: 'key is required' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const bucket  = req.params.bucket;
    let token = authCtx.accessToken;
    if (!token) {
      const c = await authCtx.auth.getClient();
      token = (await c.getAccessToken()).token;
    }
    const resp = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw Object.assign(new Error(text), { code: resp.status });
    }
    const filename = key.split('/').filter(Boolean).pop() || 'download';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const ct = resp.headers.get('content-type');
    const cl = resp.headers.get('content-length');
    if (ct) res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    const { Readable } = require('stream');
    Readable.from(resp.body).pipe(res);
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ARTIFACT REGISTRY ───────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /artifact-registry → list all repositories
router.get('/artifact-registry', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/-/repositories`,
      authCtx
    );
    res.json((data.repositories || []).map(r => ({
      name:        r.name?.split('/').pop(),
      location:    r.name?.split('/')[3],
      format:      r.format,
      description: r.description || '',
      created:     r.createTime,
      updated:     r.updateTime,
      sizeBytes:   r.sizeBytes ? parseInt(r.sizeBytes) : null,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /artifact-registry/:location/:repo/packages → list packages in a repo
router.get('/artifact-registry/:location/:repo/packages', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, repo } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_.]+$/.test(repo)) {
    return res.status(400).json({ error: 'Invalid location or repository name' });
  }
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/${location}/repositories/${repo}/packages`,
      authCtx
    );
    res.json((data.packages || []).map(p => ({
      name:        p.name?.split('/').pop(),
      displayName: p.displayName || p.name?.split('/').pop(),
      created:     p.createTime,
      updated:     p.updateTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── BIGQUERY ─────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /bigquery/datasets → list all datasets in project
router.get('/bigquery/datasets', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets?all=false`,
      authCtx
    );
    res.json((data.datasets || []).map(d => ({
      id:          d.datasetReference?.datasetId,
      location:    d.location,
      friendlyName: d.friendlyName || d.datasetReference?.datasetId,
      labels:      d.labels || {},
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /bigquery/datasets/:dataset/tables → list tables in a dataset
router.get('/bigquery/datasets/:dataset/tables', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  if (!/^[a-zA-Z0-9_\-]+$/.test(req.params.dataset)) {
    return res.status(400).json({ error: 'Invalid dataset id' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets/${req.params.dataset}/tables?maxResults=200`,
      authCtx
    );
    res.json((data.tables || []).map(t => ({
      id:           t.tableReference?.tableId,
      type:         t.type || 'TABLE',  // TABLE | VIEW | EXTERNAL | MATERIALIZED_VIEW
      created:      t.creationTime ? new Date(parseInt(t.creationTime)).toISOString() : null,
      rowCount:     t.numRows ? parseInt(t.numRows) : null,
      sizeBytes:    t.numBytes ? parseInt(t.numBytes) : null,
    })));
  } catch (err) { handleErr(res, err); }
});

// POST /bigquery/query → run a synchronous query (max 10 s timeout)
router.post('/bigquery/query', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { query, useLegacySql = false } = req.body || {};
  if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query is required' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`,
      authCtx, 'POST',
      { query, useLegacySql, timeoutMs: 10000, maxResults: 500 }
    );
    if (!data.jobComplete) {
      return res.json({ jobId: data.jobReference?.jobId, pending: true });
    }
    const schema = (data.schema?.fields || []).map(f => ({ name: f.name, type: f.type, mode: f.mode }));
    const rows   = (data.rows || []).map(r =>
      Object.fromEntries(schema.map((f, i) => [f.name, r.f[i]?.v ?? null]))
    );
    res.json({ jobComplete: true, schema, rows, totalRows: parseInt(data.totalRows) || rows.length });
  } catch (err) { handleErr(res, err); }
});

// GET /bigquery/query/:jobId → poll job results (for pending queries)
router.get('/bigquery/query/:jobId', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  if (!/^[a-zA-Z0-9_\-:]+$/.test(req.params.jobId)) {
    return res.status(400).json({ error: 'Invalid jobId' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries/${req.params.jobId}?timeoutMs=8000&maxResults=500`,
      authCtx
    );
    if (!data.jobComplete) return res.json({ jobId: req.params.jobId, pending: true });
    const schema = (data.schema?.fields || []).map(f => ({ name: f.name, type: f.type, mode: f.mode }));
    const rows   = (data.rows || []).map(r =>
      Object.fromEntries(schema.map((f, i) => [f.name, r.f[i]?.v ?? null]))
    );
    res.json({ jobComplete: true, schema, rows, totalRows: parseInt(data.totalRows) || rows.length });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOUD WORKFLOWS ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /workflows → list all workflows across all regions
router.get('/workflows', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://workflows.googleapis.com/v1/projects/${projectId}/locations/-/workflows`,
      authCtx
    );
    res.json((data.workflows || []).map(w => ({
      name:        w.name?.split('/').pop(),
      location:    w.name?.split('/')[5],
      state:       w.state,
      description: w.description || '',
      updated:     w.updateTime,
      created:     w.createTime,
      serviceAccount: w.serviceAccount?.split('/').pop() || w.serviceAccount || '',
      labels:      w.labels || {},
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /workflows/:location/:name/executions → list recent executions (last 20)
router.get('/workflows/:location/:name/executions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid location or workflow name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://workflowexecutions.googleapis.com/v1/projects/${projectId}/locations/${location}/workflows/${name}/executions?pageSize=20&view=FULL`,
      authCtx
    );
    res.json((data.executions || []).map(e => ({
      name:      e.name?.split('/').pop(),
      state:     e.state,
      startTime: e.startTime,
      endTime:   e.endTime,
      argument:  e.argument,
      result:    e.result,
      error:     e.error?.payload || null,
      duration:  e.duration,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /workflows/:location/:name/definition → get source YAML/JSON
router.get('/workflows/:location/:name/definition', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid location or workflow name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://workflows.googleapis.com/v1/projects/${projectId}/locations/${location}/workflows/${name}`,
      authCtx
    );
    res.json({ sourceContents: data.sourceContents || '', name: data.name });
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CLOUD DNS ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /dns/zones → list managed zones
router.get('/dns/zones', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones`,
      authCtx
    );
    res.json((data.managedZones || []).map(z => ({
      id:          z.id,
      name:        z.name,
      dnsName:     z.dnsName,
      description: z.description || '',
      visibility:  z.visibility || 'public',
      created:     z.creationTime,
      nameServers: z.nameServers || [],
      recordCount: null, // loaded on demand
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /dns/zones/:zone/records → list DNS records in a zone
router.get('/dns/zones/:zone/records', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  if (!/^[a-zA-Z0-9\-_]+$/.test(req.params.zone)) {
    return res.status(400).json({ error: 'Invalid zone name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones/${req.params.zone}/rrsets?maxResults=300`,
      authCtx
    );
    res.json((data.rrsets || []).map(r => ({
      name: r.name,
      type: r.type,
      ttl:  r.ttl,
      data: (r.rrdatas || []).join(', '),
    })));
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── FIRESTORE ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /firestore/databases → list Firestore databases
router.get('/firestore/databases', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases`,
      authCtx
    );
    res.json((data.databases || []).map(db => ({
      name:        db.name?.split('/').pop(),
      location:    db.locationId,
      type:        db.type || 'FIRESTORE_NATIVE',
      state:       db.state || 'READY',
      created:     db.createTime,
      concurrencyMode: db.concurrencyMode || '',
      pointInTimeRecoveryEnablement: db.pointInTimeRecoveryEnablement || '',
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /firestore/databases/:db/collections → list top-level collections in a DB
router.get('/firestore/databases/:db/collections', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const dbId = req.params.db;
  if (!/^[a-zA-Z0-9\-_()]+$/.test(dbId)) {
    return res.status(400).json({ error: 'Invalid database id' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:listCollectionIds`,
      authCtx, 'POST', { pageSize: 100 }
    );
    const ids = data.collectionIds || [];
    // Try to get estimated doc count for each collection via runAggregationQuery
    const collections = await Promise.all(ids.map(async (colId) => {
      let docCount = null;
      try {
        const aggResp = await gcpFetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents:runAggregationQuery`,
          authCtx, 'POST', {
            structuredAggregationQuery: {
              structuredQuery: {
                from: [{ collectionId: colId }],
              },
              aggregations: [{ alias: 'count', count: {} }],
            },
          }
        );
        const result = Array.isArray(aggResp) ? aggResp[0] : null;
        docCount = result?.result?.aggregateFields?.count?.integerValue
          ? parseInt(result.result.aggregateFields.count.integerValue)
          : null;
      } catch { /* count not available */ }
      return { id: colId, docCount };
    }));
    res.json(collections);
  } catch (err) { handleErr(res, err); }
});

// GET /firestore/databases/:db/collections/:collection/documents → list first N docs
router.get('/firestore/databases/:db/collections/:collection/documents', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { db, collection } = req.params;
  if (!/^[a-zA-Z0-9\-_()]+$/.test(db) || !/^[a-zA-Z0-9\-_]+$/.test(collection)) {
    return res.status(400).json({ error: 'Invalid database or collection id' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const pageToken = req.query.pageToken || '';
    const pageSize  = Math.min(parseInt(req.query.pageSize) || 25, 100);
    const params    = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) params.append('pageToken', pageToken);
    const data = await gcpFetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${db}/documents/${collection}?${params}`,
      authCtx
    );
    const docs = (data.documents || []).map(d => {
      const id     = d.name?.split('/').pop();
      const fields = {};
      for (const [k, v] of Object.entries(d.fields || {})) {
        // Flatten Firestore typed value to a simple JS value
        fields[k] = v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? v.bytesValue ?? (v.nullValue !== undefined ? null : '[complex]');
      }
      return { id, fields, created: d.createTime, updated: d.updateTime };
    });
    res.json({ docs, nextPageToken: data.nextPageToken || null });
  } catch (err) { handleErr(res, err); }
});

// ════════════════════════════════════════════════════════════════════════════
// FASE 3 – Cloud Spanner, Memorystore, Cloud Tasks, Cloud Scheduler,
//           Cloud Build, IAM Service Accounts
// ════════════════════════════════════════════════════════════════════════════

// ── Cloud Spanner ────────────────────────────────────────────────────────────

// GET /spanner/instances → list all Spanner instances
router.get('/spanner/instances', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(`https://spanner.googleapis.com/v1/projects/${projectId}/instances?pageSize=50`, authCtx);
    const instances = (data.instances || []).map(i => ({
      name:        i.name?.split('/').pop(),
      displayName: i.displayName,
      config:      i.config?.split('/').pop(),
      state:       i.state,
      nodes:       i.nodeCount,
      processingUnits: i.processingUnits,
      labels:      i.labels || {},
    }));
    res.json(instances);
  } catch (err) { handleErr(res, err); }
});

// GET /spanner/instances/:instance/databases → list databases
router.get('/spanner/instances/:instance/databases', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { instance } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(instance)) return res.status(400).json({ error: 'Invalid instance id' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://spanner.googleapis.com/v1/projects/${projectId}/instances/${instance}/databases?pageSize=50`,
      authCtx
    );
    const databases = (data.databases || []).map(d => ({
      name:          d.name?.split('/').pop(),
      state:         d.state,
      versionRetention: d.versionRetentionPeriod,
      earliestVersionTime: d.earliestVersionTime,
      created:       d.createTime,
      dialect:       d.databaseDialect || 'GOOGLE_STANDARD_SQL',
    }));
    res.json(databases);
  } catch (err) { handleErr(res, err); }
});

// POST /spanner/instances/:instance/databases/:database/query → execute SQL
router.post('/spanner/instances/:instance/databases/:database/query', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { instance, database } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(instance) || !/^[a-zA-Z0-9\-_]+$/.test(database)) {
    return res.status(400).json({ error: 'Invalid instance or database id' });
  }
  const { sql } = req.body || {};
  if (!sql || typeof sql !== 'string') return res.status(400).json({ error: 'sql is required' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://spanner.googleapis.com/v1/projects/${projectId}/instances/${instance}/databases/${database}/sessions`,
      authCtx, 'POST', {}
    );
    const sessionName = data.name;
    try {
      const result = await gcpFetch(
        `https://spanner.googleapis.com/v1/${sessionName}:executeSql`,
        authCtx, 'POST', { sql }
      );
      const fields = (result.metadata?.rowType?.fields || []).map(f => ({ name: f.name, type: f.type?.code }));
      const rows = (result.rows || []).map(row => {
        const obj = {};
        fields.forEach((f, i) => { obj[f.name] = row[i] ?? null; });
        return obj;
      });
      res.json({ fields, rows });
    } finally {
      // delete session (best-effort)
      gcpFetch(`https://spanner.googleapis.com/v1/${sessionName}`, authCtx, 'DELETE').catch(() => {});
    }
  } catch (err) { handleErr(res, err); }
});

// ── Memorystore (Redis) ──────────────────────────────────────────────────────

// GET /memorystore/instances → list all Redis instances
router.get('/memorystore/instances', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://redis.googleapis.com/v1/projects/${projectId}/locations/-/instances?pageSize=50`,
      authCtx
    );
    const instances = (data.instances || []).map(i => ({
      name:          i.name?.split('/').pop(),
      location:      i.locationId,
      displayName:   i.displayName,
      tier:          i.tier,
      memorySizeGb:  i.memorySizeGb,
      redisVersion:  i.redisVersion,
      state:         i.state,
      host:          i.host,
      port:          i.port,
      connectMode:   i.connectMode,
      authEnabled:   i.authEnabled,
      transitEncryption: i.transitEncryptionMode,
      created:       i.createTime,
      labels:        i.labels || {},
    }));
    res.json(instances);
  } catch (err) { handleErr(res, err); }
});

// ── Cloud Tasks ──────────────────────────────────────────────────────────────

// GET /tasks/queues → list all queues (all locations)
router.get('/tasks/queues', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://cloudtasks.googleapis.com/v2/projects/${projectId}/locations/-/queues?pageSize=100`,
      authCtx
    );
    const queues = (data.queues || []).map(q => {
      const parts = q.name?.split('/');
      return {
        name:     parts[parts.length - 1],
        location: parts[3],
        state:    q.state,
        rateLimits: {
          maxDispatchesPerSecond: q.rateLimits?.maxDispatchesPerSecond,
          maxConcurrentDispatches: q.rateLimits?.maxConcurrentDispatches,
          maxBurstSize: q.rateLimits?.maxBurstSize,
        },
        retryConfig: {
          maxAttempts: q.retryConfig?.maxAttempts,
          maxRetryDuration: q.retryConfig?.maxRetryDuration,
        },
      };
    });
    res.json(queues);
  } catch (err) { handleErr(res, err); }
});

// GET /tasks/queues/:location/:queue/tasks → list tasks
router.get('/tasks/queues/:location/:queue/tasks', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, queue } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(queue)) {
    return res.status(400).json({ error: 'Invalid location or queue name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const pageToken = req.query.pageToken || '';
    const params = new URLSearchParams({ pageSize: '50', responseView: 'BASIC' });
    if (pageToken) params.append('pageToken', pageToken);
    const data = await gcpFetch(
      `https://cloudtasks.googleapis.com/v2/projects/${projectId}/locations/${location}/queues/${queue}/tasks?${params}`,
      authCtx
    );
    const tasks = (data.tasks || []).map(t => ({
      name:        t.name?.split('/').pop(),
      scheduleTime: t.scheduleTime,
      createTime:   t.createTime,
      dispatchCount: t.dispatchCount,
      responseCount: t.responseCount,
      lastAttempt:  t.lastAttempt,
      firstAttempt: t.firstAttempt,
    }));
    res.json({ items: tasks, nextPageToken: data.nextPageToken || null });
  } catch (err) { handleErr(res, err); }
});

// ── Cloud Scheduler ──────────────────────────────────────────────────────────

// GET /scheduler/jobs → list all scheduler jobs (all locations)
router.get('/scheduler/jobs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://cloudscheduler.googleapis.com/v1/projects/${projectId}/locations/-/jobs?pageSize=100`,
      authCtx
    );
    const jobs = (data.jobs || []).map(j => {
      const parts = j.name?.split('/');
      return {
        name:        parts[parts.length - 1],
        location:    parts[3],
        description: j.description,
        schedule:    j.schedule,
        timeZone:    j.timeZone,
        state:       j.state,
        lastAttemptTime: j.lastAttemptTime,
        scheduleTime: j.scheduleTime,
        lastStatus:  j.status?.code !== undefined ? (j.status.code === 0 ? 'OK' : j.status.message) : null,
        targetType:  j.httpTarget ? 'HTTP' : j.pubsubTarget ? 'Pub/Sub' : j.appEngineHttpTarget ? 'App Engine' : 'Unknown',
      };
    });
    res.json(jobs);
  } catch (err) { handleErr(res, err); }
});

// POST /scheduler/jobs/:location/:name/run → trigger job now
router.post('/scheduler/jobs/:location/:name/run', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid location or job name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    await gcpFetch(
      `https://cloudscheduler.googleapis.com/v1/projects/${projectId}/locations/${location}/jobs/${name}:run`,
      authCtx, 'POST', {}
    );
    res.json({ ok: true });
  } catch (err) { handleErr(res, err); }
});

// POST /scheduler/jobs/:location/:name/pause → pause job
router.post('/scheduler/jobs/:location/:name/pause', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid location or job name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    await gcpFetch(
      `https://cloudscheduler.googleapis.com/v1/projects/${projectId}/locations/${location}/jobs/${name}:pause`,
      authCtx, 'POST', {}
    );
    res.json({ ok: true });
  } catch (err) { handleErr(res, err); }
});

// POST /scheduler/jobs/:location/:name/resume → resume job
router.post('/scheduler/jobs/:location/:name/resume', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid location or job name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    await gcpFetch(
      `https://cloudscheduler.googleapis.com/v1/projects/${projectId}/locations/${location}/jobs/${name}:resume`,
      authCtx, 'POST', {}
    );
    res.json({ ok: true });
  } catch (err) { handleErr(res, err); }
});

// ── Cloud Build ──────────────────────────────────────────────────────────────

// GET /build/builds → list recent builds
router.get('/build/builds', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const pageToken = req.query.pageToken || '';
    const params = new URLSearchParams({ pageSize: '50' });
    if (pageToken) params.append('pageToken', pageToken);
    const data = await gcpFetch(
      `https://cloudbuild.googleapis.com/v1/projects/${projectId}/builds?${params}`,
      authCtx
    );
    const builds = (data.builds || []).map(b => {
      const durationMs = b.startTime && b.finishTime
        ? new Date(b.finishTime) - new Date(b.startTime) : null;
      return {
        id:          b.id,
        status:      b.status,
        triggerName: b.substitutions?.TRIGGER_NAME || b.buildTriggerId || null,
        branch:      b.substitutions?.BRANCH_NAME || b.substitutions?.SHORT_SHA || null,
        commit:      b.substitutions?.SHORT_SHA || null,
        repoSource:  b.source?.repoSource?.repoName || b.source?.storageSource?.bucket || null,
        createTime:  b.createTime,
        startTime:   b.startTime,
        finishTime:  b.finishTime,
        durationMs,
        logUrl:      b.logUrl,
        tags:        b.tags || [],
      };
    });
    res.json({ items: builds, nextPageToken: data.nextPageToken || null });
  } catch (err) { handleErr(res, err); }
});

// GET /build/builds/:id/logs → fetch build log text (first 200 lines)
router.get('/build/builds/:id/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { id } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(id)) return res.status(400).json({ error: 'Invalid build id' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const build = await gcpFetch(`https://cloudbuild.googleapis.com/v1/projects/${projectId}/builds/${id}`, authCtx);
    // Try to get logs from logsBucket or logUrl
    const logsBucket = build.logsBucket?.replace('gs://', '');
    if (logsBucket) {
      const bucketName = logsBucket.split('/')[0];
      const prefix     = logsBucket.split('/').slice(1).join('/');
      const logFile    = `${prefix ? prefix + '/' : ''}log-${id}.txt`.replace(/^\//, '');
      try {
        const logsData = await gcpFetch(
          `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(logFile)}?alt=media`,
          authCtx
        );
        const text = typeof logsData === 'string' ? logsData : JSON.stringify(logsData);
        return res.json({ lines: text.split('\n').slice(0, 500) });
      } catch { /* fall through */ }
    }
    // Inline steps logs
    const steps = build.steps || [];
    const lines = [];
    steps.forEach((step, idx) => {
      lines.push(`=== Step ${idx}: ${step.name} ===`);
      if (step.status) lines.push(`Status: ${step.status}`);
      if (step.logs)   lines.push(...step.logs.split('\n'));
    });
    res.json({ lines: lines.slice(0, 500) });
  } catch (err) { handleErr(res, err); }
});

// ── IAM Service Accounts ─────────────────────────────────────────────────────

// GET /iam/service-accounts → list service accounts
router.get('/iam/service-accounts', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const pageToken = req.query.pageToken || '';
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.append('pageToken', pageToken);
    const data = await gcpFetch(
      `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts?${params}`,
      authCtx
    );
    const accounts = (data.accounts || []).map(a => ({
      email:       a.email,
      name:        a.name?.split('/').pop(),
      displayName: a.displayName,
      description: a.description,
      disabled:    a.disabled || false,
      oauth2ClientId: a.oauth2ClientId,
    }));
    res.json({ items: accounts, nextPageToken: data.nextPageToken || null });
  } catch (err) { handleErr(res, err); }
});

// GET /iam/service-accounts/:email/keys → list keys
router.get('/iam/service-accounts/:email/keys', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { email } = req.params;
  // Validate email format (service account emails)
  if (!/^[a-zA-Z0-9\-_\.]+@[a-zA-Z0-9\-_\.]+\.iam\.gserviceaccount\.com$/.test(email)) {
    return res.status(400).json({ error: 'Invalid service account email' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${encodeURIComponent(email)}/keys`,
      authCtx
    );
    const keys = (data.keys || []).map(k => ({
      name:      k.name?.split('/').pop(),
      keyType:   k.keyType,
      keyOrigin: k.keyOrigin,
      keyAlgorithm: k.keyAlgorithm,
      validAfter:  k.validAfterTime,
      validBefore: k.validBeforeTime,
    }));
    res.json(keys);
  } catch (err) { handleErr(res, err); }
});

// ════════════════════════════════════════════════════════════════════════════
// FASE 4 – Cloud Run Jobs, Pub/Sub Subscriptions, VPC Networks,
//           Cloud Monitoring, Cloud Logging, Cloud KMS
// ════════════════════════════════════════════════════════════════════════════

// ── Cloud Run Jobs ───────────────────────────────────────────────────────────

// GET /cloudrun-jobs → list all Cloud Run Jobs across all regions
router.get('/cloudrun-jobs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://run.googleapis.com/v2/projects/${projectId}/locations/-/jobs`,
      authCtx
    );
    const jobs = (data.jobs || []).map(j => {
      const parts = j.name?.split('/');
      return {
        name:        parts[parts.length - 1],
        location:    parts[3],
        state:       j.terminalCondition?.state || j.latestCreatedExecution?.completionStatus || 'UNKNOWN',
        created:     j.createTime,
        updated:     j.updateTime,
        lastRun:     j.latestCreatedExecution?.createTime || null,
        lastStatus:  j.latestCreatedExecution?.completionStatus || null,
        parallelism: j.template?.parallelism ?? 1,
        taskCount:   j.template?.taskCount ?? 1,
        labels:      j.labels || {},
        image:       j.template?.template?.containers?.[0]?.image || null,
      };
    });
    res.json(jobs);
  } catch (err) { handleErr(res, err); }
});

// POST /cloudrun-jobs/:location/:job/run → trigger a job execution
router.post('/cloudrun-jobs/:location/:job/run', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, job } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(job)) {
    return res.status(400).json({ error: 'Invalid location or job name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://run.googleapis.com/v2/projects/${projectId}/locations/${location}/jobs/${job}:run`,
      authCtx, 'POST', {}
    );
    res.json({ ok: true, execution: data.metadata?.name?.split('/').pop() || null });
  } catch (err) { handleErr(res, err); }
});

// GET /cloudrun-jobs/:location/:job/executions → list job executions
router.get('/cloudrun-jobs/:location/:job/executions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, job } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(job)) {
    return res.status(400).json({ error: 'Invalid location or job name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://run.googleapis.com/v2/projects/${projectId}/locations/${location}/jobs/${job}/executions?pageSize=20`,
      authCtx
    );
    const executions = (data.executions || []).map(e => ({
      name:        e.name?.split('/').pop(),
      state:       e.completionStatus || e.conditions?.[0]?.state || 'RUNNING',
      created:     e.createTime,
      started:     e.startTime,
      completed:   e.completionTime,
      succeeded:   e.succeededCount ?? null,
      failed:      e.failedCount ?? null,
      running:     e.runningCount ?? null,
    }));
    res.json(executions);
  } catch (err) { handleErr(res, err); }
});

// ── Pub/Sub Subscriptions ─────────────────────────────────────────────────────

// GET /pubsub/subscriptions → list all subscriptions
router.get('/pubsub/subscriptions', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://pubsub.googleapis.com/v1/projects/${projectId}/subscriptions?pageSize=200`,
      authCtx
    );
    res.json((data.subscriptions || []).map(s => ({
      name:               s.name?.split('/').pop(),
      topic:              s.topic?.split('/').pop(),
      ackDeadlineSecs:    s.ackDeadlineSeconds,
      retainAcked:        s.retainAckedMessages || false,
      retentionDuration:  s.messageRetentionDuration || null,
      pushEndpoint:       s.pushConfig?.pushEndpoint || null,
      type:               s.pushConfig?.pushEndpoint ? 'push' : 'pull',
      filter:             s.filter || null,
      labels:             s.labels || {},
    })));
  } catch (err) { handleErr(res, err); }
});

// ── VPC Networks ──────────────────────────────────────────────────────────────

// GET /vpc/networks → list VPC networks
router.get('/vpc/networks', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://compute.googleapis.com/compute/v1/projects/${projectId}/global/networks`,
      authCtx
    );
    const networks = (data.items || []).map(n => ({
      name:         n.name,
      description:  n.description || '',
      autoSubnet:   n.autoCreateSubnetworks || false,
      routingMode:  n.routingConfig?.routingMode || 'REGIONAL',
      mtu:          n.mtu || null,
      subnetCount:  n.subnetworks?.length ?? 0,
      created:      n.creationTimestamp,
      selfLink:     n.selfLink,
    }));
    res.json(networks);
  } catch (err) { handleErr(res, err); }
});

// GET /vpc/networks/:network/subnets → list subnets for a network
router.get('/vpc/networks/:network/subnets', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { network } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(network)) {
    return res.status(400).json({ error: 'Invalid network name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://compute.googleapis.com/compute/v1/projects/${projectId}/aggregated/subnetworks?filter=network="${encodeURIComponent(`https://www.googleapis.com/compute/v1/projects/${projectId}/global/networks/${network}`)}"`,
      authCtx
    );
    const subnets = [];
    for (const [, regionData] of Object.entries(data.items || {})) {
      for (const s of (regionData.subnetworks || [])) {
        subnets.push({
          name:         s.name,
          region:       s.region?.split('/').pop(),
          ipRange:      s.ipCidrRange,
          gateway:      s.gatewayAddress,
          privateAccess: s.privateIpGoogleAccess || false,
          flowLogs:     s.enableFlowLogs || false,
          created:      s.creationTimestamp,
          purpose:      s.purpose || 'PRIVATE',
        });
      }
    }
    res.json(subnets);
  } catch (err) { handleErr(res, err); }
});

// ── Cloud Monitoring ──────────────────────────────────────────────────────────

// GET /monitoring/alerts → list alert policies (active incidents)
router.get('/monitoring/alerts', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://monitoring.googleapis.com/v3/projects/${projectId}/alertPolicies`,
      authCtx
    );
    const policies = (data.alertPolicies || []).map(p => ({
      name:        p.name?.split('/').pop(),
      displayName: p.displayName,
      enabled:     p.enabled !== false,
      state:       p.enabled !== false ? 'ENABLED' : 'DISABLED',
      conditions:  (p.conditions || []).map(c => c.displayName || c.name?.split('/').pop()).join(', '),
      notificationChannels: p.notificationChannels?.length ?? 0,
      created:     p.creationRecord?.mutateTime,
      updated:     p.mutationRecord?.mutateTime,
    }));
    res.json(policies);
  } catch (err) { handleErr(res, err); }
});

// GET /monitoring/uptime-checks → list uptime check configs
router.get('/monitoring/uptime-checks', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://monitoring.googleapis.com/v3/projects/${projectId}/uptimeCheckConfigs`,
      authCtx
    );
    const checks = (data.uptimeCheckConfigs || []).map(c => ({
      name:        c.name?.split('/').pop(),
      displayName: c.displayName,
      period:      c.period,
      timeout:     c.timeout,
      type:        c.httpCheck ? 'HTTP' : c.tcpCheck ? 'TCP' : 'OTHER',
      host:        c.httpCheck?.host || c.tcpCheck?.port ? `${c.monitoredResource?.labels?.host || ''}:${c.tcpCheck?.port || ''}` : c.monitoredResource?.labels?.host || '',
      regions:     c.selectedRegions || [],
    }));
    res.json(checks);
  } catch (err) { handleErr(res, err); }
});

// ── Cloud Logging ─────────────────────────────────────────────────────────────

// POST /logging/query → query Cloud Logging entries
router.post('/logging/query', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { filter = '', limit = 100, hours = 3 } = req.body || {};
  if (typeof filter !== 'string') return res.status(400).json({ error: 'filter must be a string' });
  const safeLimit = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
  const safeHours = Math.min(Math.max(parseInt(hours) || 3, 1), 168);
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const since = new Date(Date.now() - safeHours * 3600 * 1000).toISOString();
    const combinedFilter = [
      filter ? `(${filter})` : '',
      `timestamp>="${since}"`,
    ].filter(Boolean).join(' ');
    const data = await gcpFetch(
      'https://logging.googleapis.com/v2/entries:list',
      authCtx, 'POST', {
        resourceNames: [`projects/${projectId}`],
        filter: combinedFilter,
        orderBy: 'timestamp desc',
        pageSize: safeLimit,
      }
    );
    res.json({
      entries: (data.entries || []).map(e => ({
        timestamp:  e.timestamp,
        severity:   e.severity || 'DEFAULT',
        resource:   e.resource?.type || '',
        logName:    e.logName?.split('/').pop() || '',
        message:    e.textPayload || (e.jsonPayload ? JSON.stringify(e.jsonPayload) : '') || (e.protoPayload ? '[proto]' : ''),
        labels:     e.labels || {},
      })),
      nextPageToken: data.nextPageToken || null,
    });
  } catch (err) { handleErr(res, err); }
});

// ── Cloud KMS ─────────────────────────────────────────────────────────────────

// GET /kms/keyrings → list all key rings (all locations)
router.get('/kms/keyrings', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://cloudkms.googleapis.com/v1/projects/${projectId}/locations/-/keyRings`,
      authCtx
    );
    const keyrings = (data.keyRings || []).map(k => ({
      name:     k.name?.split('/').pop(),
      location: k.name?.split('/')[5],
      created:  k.createTime,
    }));
    res.json(keyrings);
  } catch (err) { handleErr(res, err); }
});

// GET /kms/keyrings/:location/:keyring/keys → list crypto keys in a key ring
router.get('/kms/keyrings/:location/:keyring/keys', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, keyring } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(keyring)) {
    return res.status(400).json({ error: 'Invalid location or key ring name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://cloudkms.googleapis.com/v1/projects/${projectId}/locations/${location}/keyRings/${keyring}/cryptoKeys?pageSize=100`,
      authCtx
    );
    const keys = (data.cryptoKeys || []).map(k => ({
      name:        k.name?.split('/').pop(),
      purpose:     k.purpose,
      algorithm:   k.primary?.algorithm || null,
      state:       k.primary?.state || 'UNKNOWN',
      rotationPeriod: k.rotationPeriod || null,
      nextRotation: k.nextRotationTime || null,
      created:     k.createTime,
      labels:      k.labels || {},
    }));
    res.json(keys);
  } catch (err) { handleErr(res, err); }
});

module.exports = router;
