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
const { createDatastoreReader } = require('../lib/gcpDatastore');
const { createKmsReader } = require('../lib/gcpKms');
const { listWorkflows, mapWorkflow } = require('../lib/gcpWorkflows');
const { mapFunction, functionParamsError, functionLogFilter } = require('../lib/gcpFunctions');
const { mapLogEntry, logMessage, loggingRequest } = require('../lib/gcpLogging');
const { exec }       = require('child_process');
const { promisify }  = require('util');
const { getStore } = require('../lib/credentialStore');
const auditLog     = require('../lib/auditLog');
const { createGcloudCli } = require('../lib/gcloudCli');
const { getStateHistory } = require('../lib/stateHistory');
const { getCloudHistory } = require('../lib/cloudHistory');
const { mapVmDetail, mapCloudRunDetail, mapSqlDetail } = require('../lib/gcpDetails');
const {
  mapCloudRunService, mapVm, mapSqlInstance,
  estimate, estimateOverviewCosts, createPresets, assertDeleteConfirmed, validateCreate, waitForZoneOperation,
  validateLabels, hasLabelChanges,
} = require('../lib/gcpResources');
const { adviseGcp } = require('../lib/advisor/gcp');

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

// Cached + deduplicated gcloud CLI access (see lib/gcloudCli.js)
const gcloudCli = createGcloudCli({ exec: args => gcloudExec(args, 30000) });

/**
 * List local gcloud configurations for the UI selector.
 * Returns: [{ name, project, account, region, isActive }] — [] when gcloud is unavailable.
 */
async function readGcloudConfigs() {
  try {
    return await gcloudCli.listConfigs();
  } catch {
    return [];
  }
}

function handleErr(res, err) {
  console.error('[gcp]', err.message);
  // gRPC ALREADY_EXISTS (6) / REST "already exists" → 409 so the UI can say so clearly
  const alreadyExists = err.code === 6 || /already exists/i.test(err.message || '');
  const status = alreadyExists ? 409 : [400, 403, 404, 409, 503, 504].includes(err.code) ? err.code : 500;
  res.status(status).json({ error: err.message });
}

function cloudHistory() {
  try { return getCloudHistory(); } catch (err) { console.warn('[gcp-cloud-history]', err.message); return null; }
}

function cloudCacheTtlMs(req) {
  const minutes = Number(req.query.cacheMin || 5);
  return (minutes >= 1 && minutes <= 1440 ? minutes : 5) * 60 * 1000;
}

/** Wait for a Compute Engine zone operation (start/stop/insert/delete). */
function waitZoneOp(auth, project, zone, operation) {
  const { ZoneOperationsClient } = require('@google-cloud/compute');
  return waitForZoneOperation(new ZoneOperationsClient({ auth }), { project, zone, operation });
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
    // Throws a 503 "gcloud ... failed" when the CLI itself fails, so that is not
    // misreported as a missing configuration.
    let configs = await gcloudCli.listConfigs();
    let cfg     = configs.find(c => c.name === configName);
    if (!cfg) {
      // The config may have been created outside KUA since the list was cached
      configs = await gcloudCli.listConfigs({ force: true });
      cfg     = configs.find(c => c.name === configName);
    }
    if (!cfg) throw Object.assign(new Error(`gcloud config not found: ${configName}`), { code: 404 });

    // OAuth2 access token for the account active in that config (cached ~30 min)
    const accessToken = await gcloudCli.getAccessToken(configName);

    // google-gax (v4+) requires a GoogleAuth instance (needs getUniverseDomain +
    // getClient). We pre-populate cachedCredential so GoogleAuth.getClient()
    // returns our token-backed OAuth2Client without attempting ADC discovery.
    const { GoogleAuth, OAuth2Client } = require('google-auth-library');
    const tokenClient = new OAuth2Client();
    tokenClient.setCredentials({ access_token: accessToken });
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    auth.cachedCredential = tokenClient;
    return { auth, projectId: cfg.project || null, credentials: {}, account: cfg.account || null, accessToken };
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
  return { auth, projectId, credentials, account: credentials.client_email || null };
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
    // Always fresh (one CLI call): this backs the selector and its Refresh action
    res.json(await gcloudCli.listConfigs({ force: true }).catch(() => []));
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

    gcloudCli.invalidate();   // the account/token behind a config may change after login
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
    gcloudCli.invalidate();

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
    auditLog.log({
      category: 'gcp', action: 'GKE cluster connected',
      resource: `${location}/${cluster}`, details: { contextName },
      context: profileId,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /cloudrun ────────────────────────────────────────────────────────────

// ─── Listers shared by the UI routes and the background state poller ─────────

async function listCloudRunServices({ auth, projectId }) {
  const { ServicesClient } = require('@google-cloud/run').v2;
  const client = new ServicesClient({ auth });
  const [services] = await client.listServices({ parent: `projects/${projectId}/locations/-` });
  return (services || []).map(mapCloudRunService);
}

async function listVms({ auth, projectId }) {
  const { InstancesClient } = require('@google-cloud/compute');
  const client = new InstancesClient({ auth });
  const vms = [];
  // aggregatedList iterates all zones
  for await (const [, zoneData] of client.aggregatedListAsync({ project: projectId })) {
    for (const vm of (zoneData.instances || [])) vms.push(mapVm(vm));
  }
  return vms;
}

async function listSqlInstances(authCtx) {
  const data = await gcpFetch(`https://sqladmin.googleapis.com/v1/projects/${authCtx.projectId}/instances`, authCtx);
  return (data.items || []).map(mapSqlInstance);
}

// State history (lib/stateHistory.js): how each resource type is listed, keyed
// and what counts as its state.
const STATE_SOURCES = {
  'gcp-cloud-run': { list: listCloudRunServices, key: s => `${s.region}/${s.name}`, state: s => String(s.status || '').toUpperCase() },
  'gcp-vm':        { list: listVms,              key: v => `${v.zone}/${v.name}`,   state: v => v.status },
  'gcp-sql':       { list: listSqlInstances,     key: i => i.name,                  state: i => i.status || i.state },
};

/** Record observed states from a full list; never breaks the caller. */
function recordObservedStates(profileId, projectId, resourceType, rows, source = 'observed') {
  try {
    const { key, state } = STATE_SOURCES[resourceType];
    getStateHistory().recordStates({
      provider: 'gcp', profileId, project: projectId, resourceType, source, complete: true,
      items: rows.map(r => ({ key: key(r), name: r.name, state: state(r) })),
    });
  } catch (err) { console.warn('[gcp] state history:', err.message); }
}

/** Record a user action in the resource's history; never breaks the caller. */
function recordUserAction(profileId, projectId, resourceType, key, name, action, details = {}) {
  try {
    getStateHistory().recordAction({ provider: 'gcp', profileId, project: projectId, resourceType, key, name, action, details });
  } catch (err) { console.warn('[gcp] state history:', err.message); }
}

function overviewResourceState(serviceId, item) {
  const raw = String(item?.status || item?.state || item?.lifecycleState || item?.stateCode || '').toUpperCase();
  if (serviceId === 'cloudrun') return raw === 'READY' || raw === 'TRUE' || raw === '';
  if (serviceId === 'vms') return raw === 'RUNNING';
  if (serviceId === 'sql') return raw === 'RUNNING' || raw === 'RUNNABLE';
  if (serviceId === 'gke') return raw === 'RUNNING';
  if (serviceId === 'build') return raw === 'SUCCESS';
  return !['FAILED', 'ERROR', 'TERMINATED', 'STOPPED', 'DELETED', 'DISABLED'].includes(raw);
}

const OVERVIEW_GROUPS = {
  compute: new Set(['cloudrun', 'gke', 'vms', 'cloudrunJobs']),
  data: new Set(['sql', 'storage', 'bigquery', 'firestore', 'spanner', 'memorystore']),
  platform: new Set(['functions', 'artifact', 'build', 'workflows']),
  integration: new Set(['pubsub', 'pubsubSubs', 'tasks', 'scheduler']),
  security: new Set(['secrets', 'iam', 'kms']),
  network: new Set(['dns', 'vpc']),
};

function overviewGroup(serviceId) {
  for (const [group, ids] of Object.entries(OVERVIEW_GROUPS)) {
    if (ids.has(serviceId)) return group;
  }
  return 'other';
}

function overviewItemState(item) {
  return String(item?.status || item?.state || item?.lifecycleState || item?.stateCode || '').toUpperCase();
}

function overviewItemName(item) {
  const value = item?.name || item?.id || item?.displayName || item?.email;
  return value ? String(value).split('/').pop() : null;
}

function overviewSignal(serviceId, item) {
  const state = overviewItemState(item);
  if (serviceId === 'iam' && item?.disabled) return { level: 'critical', code: 'disabled' };
  if (serviceId === 'scheduler' && state === 'DISABLED') return { level: 'critical', code: 'disabled' };
  if (serviceId === 'scheduler' && state === 'PAUSED') return { level: 'warning', code: 'paused' };
  if (['FAILED', 'ERROR', 'INTERNAL_ERROR', 'DEGRADED', 'UNHEALTHY'].includes(state)) return { level: 'critical', code: state.toLowerCase() };
  if (serviceId === 'cloudrun' && state === 'FAILED') return { level: 'critical', code: 'failed' };
  if (['RECONCILING', 'PROVISIONING', 'STAGING', 'STARTING', 'STOPPING', 'UPDATING', 'WORKING', 'PENDING'].includes(state)) {
    return { level: 'warning', code: state.toLowerCase() };
  }
  return null;
}

function overviewHealth(status, signals) {
  if (status === 'unavailable') return 'unavailable';
  if (signals.some(signal => signal.level === 'critical')) return 'critical';
  if (signals.some(signal => signal.level === 'warning')) return 'warning';
  if (status === 'empty') return 'empty';
  return 'healthy';
}

function overviewError(err) {
  return { code: err?.code || err?.response?.status || null, message: String(err?.message || err).slice(0, 500) };
}

// The Advisor part of the overview: acceptances applied, fresh scans recorded
// (lib/advisor/posture.js), then the plan gate (lib/plans.js).
function withAdvisorGate(payload, { profileId, projectId, fresh = false } = {}) {
  if (!payload?.advisor) return payload;
  const { finalizeAdvisor, scopeKeys, getPostureStore } = require('../lib/advisor/posture');
  let store = null;
  try { store = getPostureStore(); } catch (err) { console.warn('[advisor] posture:', err.message); }
  const project = projectId || payload.advisor.scope?.projectId || '';
  const { teamScopeOf } = require('../lib/advisor/teamAcceptances');
  const scopes = scopeKeys('gcp', { profileId, projectId: project, teamScope: teamScopeOf('gcp', { projectId: project }) });
  return { ...payload, advisor: finalizeAdvisor(payload.advisor, { scopes, store, fresh }) };
}

async function gcpOverview(req, res) {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const region = String(req.query.region || '');
  const force = req.query.force === '1';
  let authCtx = null;
  try {
    authCtx = await resolveGcpAuth(profileId);
    const { auth, projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const snapshotKey = { provider: 'gcp', profileId, region, resourceKey: 'overview', kind: 'gcp-overview' };
    const history = cloudHistory();
    if (!force) {
      const cached = history?.readLatest(snapshotKey);
      if (cached) return res.json(withAdvisorGate(cached.payload, { profileId, projectId }));
    }

    const restList = (url, key) => gcpFetch(url, authCtx).then(data => data[key] || []);
    const collectors = [
      { id: 'cloudrun', label: 'Cloud Run', tab: 'cloudrun', load: () => listCloudRunServices({ auth, projectId }) },
      { id: 'gke', label: 'GKE', tab: 'gke', load: async () => {
        const { ClusterManagerClient } = require('@google-cloud/container');
        const [data] = await new ClusterManagerClient({ auth }).listClusters({ parent: `projects/${projectId}/locations/-` });
        return data.clusters || [];
      } },
      { id: 'vms', label: 'Compute VMs', tab: 'vms', load: () => listVms({ auth, projectId }) },
      { id: 'sql', label: 'Cloud SQL', tab: 'sql', load: () => listSqlInstances(authCtx) },
      { id: 'storage', label: 'Storage', tab: 'storage', load: () => restList(`https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}&maxResults=200`, 'items') },
      { id: 'functions', label: 'Functions', tab: 'functions', load: () => restList(`https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/-/functions`, 'functions') },
      { id: 'pubsub', label: 'Pub/Sub', tab: 'pubsub', load: () => restList(`https://pubsub.googleapis.com/v1/projects/${projectId}/topics`, 'topics') },
      { id: 'secrets', label: 'Secret Manager', tab: 'secrets', load: () => restList(`https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`, 'secrets') },
      { id: 'artifact', label: 'Artifact Registry', tab: 'artifact', load: () => restList(`https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/-/repositories`, 'repositories') },
      { id: 'bigquery', label: 'BigQuery', tab: 'bigquery', load: () => restList(`https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets`, 'datasets') },
      { id: 'workflows', label: 'Workflows', tab: 'workflows', load: () => listWorkflows(gcpFetch, authCtx) },
      { id: 'dns', label: 'Cloud DNS', tab: 'dns', load: () => restList(`https://dns.googleapis.com/dns/v1/projects/${projectId}/managedZones`, 'managedZones') },
      { id: 'firestore', label: 'Firestore', tab: 'firestore', load: () => restList(`https://firestore.googleapis.com/v1/projects/${projectId}/databases`, 'databases') },
      { id: 'spanner', label: 'Spanner', tab: 'spanner', load: () => restList(`https://spanner.googleapis.com/v1/projects/${projectId}/instances`, 'instances') },
      { id: 'memorystore', label: 'Memorystore', tab: 'memorystore', load: () => restList(`https://redis.googleapis.com/v1/projects/${projectId}/locations/-/instances`, 'instances') },
      { id: 'tasks', label: 'Cloud Tasks', tab: 'tasks', load: () => restList(`https://cloudtasks.googleapis.com/v2/projects/${projectId}/locations/-/queues`, 'queues') },
      { id: 'scheduler', label: 'Cloud Scheduler', tab: 'scheduler', load: () => restList(`https://cloudscheduler.googleapis.com/v1/projects/${projectId}/locations/-/jobs`, 'jobs') },
      { id: 'build', label: 'Cloud Build', tab: 'build', load: () => restList(`https://cloudbuild.googleapis.com/v1/projects/${projectId}/builds?pageSize=100`, 'builds') },
      { id: 'iam', label: 'IAM', tab: 'iam', load: () => restList(`https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts`, 'accounts') },
      { id: 'cloudrunJobs', label: 'Cloud Run Jobs', tab: 'cloudrunJobs', load: () => restList(`https://run.googleapis.com/v2/projects/${projectId}/locations/-/jobs`, 'jobs') },
      { id: 'pubsubSubs', label: 'Pub/Sub Subs', tab: 'pubsubSubs', load: () => restList(`https://pubsub.googleapis.com/v1/projects/${projectId}/subscriptions`, 'subscriptions') },
      { id: 'vpc', label: 'VPC Networks', tab: 'vpc', load: () => restList(`https://compute.googleapis.com/compute/v1/projects/${projectId}/global/networks`, 'items') },
      { id: 'kms', label: 'Cloud KMS', tab: 'kms', load: () => createKmsReader(gcpFetch, authCtx).keyRings() },
    ];
    const settled = await Promise.allSettled(collectors.map(collector => collector.load()));
    const collectedRows = new Map(collectors.map((collector, index) => {
      const result = settled[index];
      return [collector.id, result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []];
    }));
    const services = collectors.map((collector, index) => {
      const result = settled[index];
      if (result.status === 'rejected') {
        return {
          id: collector.id, label: collector.label, tab: collector.tab, group: overviewGroup(collector.id),
          status: 'unavailable', health: 'unavailable', count: 0, active: 0,
          inactive: 0, issueCount: 0, critical: 0, warning: 0, signals: [], error: overviewError(result.reason),
        };
      }
      const items = Array.isArray(result.value) ? result.value : [];
        const signals = items.map(item => {
          const signal = overviewSignal(collector.id, item);
          return signal ? { ...signal, name: overviewItemName(item) } : null;
        }).filter(Boolean);
        const critical = signals.filter(signal => signal.level === 'critical').length;
        const warning = signals.filter(signal => signal.level === 'warning').length;
        const status = items.length ? 'available' : 'empty';
      return {
          id: collector.id, label: collector.label, tab: collector.tab, group: overviewGroup(collector.id), status,
          health: overviewHealth(status, signals),
        count: items.length,
        active: items.filter(item => overviewResourceState(collector.id, item)).length,
          inactive: items.filter(item => !overviewResourceState(collector.id, item)).length,
          issueCount: signals.length, critical, warning, signals: signals.slice(0, 8),
        error: null,
      };
    });
    const available = services.filter(service => service.status !== 'unavailable');
    const unavailable = services.filter(service => service.status === 'unavailable');
      const critical = services.reduce((sum, service) => sum + service.critical, 0);
      const warning = services.reduce((sum, service) => sum + service.warning, 0);
      const inactive = services.reduce((sum, service) => sum + service.inactive, 0);
      const costs = estimateOverviewCosts({
        cloudrun: collectedRows.get('cloudrun'),
        vms: collectedRows.get('vms'),
        sql: collectedRows.get('sql'),
      });
      costs.unmodeledServices = services
        .filter(service => !['cloudrun', 'vms', 'sql'].includes(service.id) && service.status !== 'unavailable')
        .map(service => service.label);
      costs.unavailableServices = services
        .filter(service => service.status === 'unavailable')
        .map(service => service.label);
    const payload = {
      provider: 'gcp',
      generatedAt: new Date().toISOString(),
        identity: { projectId, region: region || null, account: authCtx.account || null },
      projectId,
      region: region || null,
      summary: {
        total: services.reduce((sum, service) => sum + service.count, 0),
        active: services.reduce((sum, service) => sum + service.active, 0),
          inactive,
        empty: available.filter(service => service.status === 'empty').length,
        unavailable: unavailable.length,
          critical,
          warning,
        attention: critical + warning + unavailable.length,
        health: critical ? 'critical' : (warning || unavailable.length) ? 'degraded' : 'healthy',
        services: services.length,
        availableServices: available.length,
      },
      costs,
      services,
      advisor: (() => {
        try {
          return adviseGcp({ rows: collectedRows, unavailable: unavailable.map(service => service.id), projectId });
        } catch (err) {
          return { error: err.message };
        }
      })(),
    };
    try { history?.putSnapshot({ ...snapshotKey, payload, ttlMs: cloudCacheTtlMs(req), metadata: { projectId } }); } catch (err) { console.warn('[gcp-cloud-history] write:', err.message); }
    res.json(withAdvisorGate(payload, { profileId, projectId, fresh: true }));
  } catch (err) {
    const history = cloudHistory();
    const cached = history?.readLatest({ provider: 'gcp', profileId, region, resourceKey: 'overview', kind: 'gcp-overview', allowExpired: true });
    if (cached) return res.json(withAdvisorGate(cached.payload, { profileId, projectId: authCtx?.projectId }));
    handleErr(res, err);
  }
}

router.get('/overview', gcpOverview);

router.get('/overview/history', (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const daysValue = Number(req.query.days || 7);
    const days = Number.isFinite(daysValue) ? Math.min(Math.max(daysValue, 1), 30) : 7;
    const region = String(req.query.region || '');
    const now = Date.now();
    const rows = cloudHistory()?.readRange({
      provider: 'gcp', profileId, region,
      resourceKey: 'overview', kind: 'gcp-overview',
      from: now - days * 24 * 60 * 60 * 1000, to: now + 1, limit: 500,
    }) || [];
    res.json({ provider: 'gcp', profileId, region: region || null, days, snapshots: rows });
  } catch (err) { handleErr(res, err); }
});

router.get('/cloudrun', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const services = await listCloudRunServices({ auth, projectId });
    recordObservedStates(profileId, projectId, 'gcp-cloud-run', services);
    res.json(services);
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
    recordUserAction(profileId, projectId, 'gcp-cloud-run', `${region}/${service}`, service, 'start', { minInstances: 1 });
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
    recordUserAction(profileId, projectId, 'gcp-cloud-run', `${region}/${service}`, service, 'stop', { minInstances: 0 });
    res.json({ success: true, service, region, action: 'stop', minInstances: 0 });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /cloudrun/:region/:service/logs ───────────────────────────────────────

router.get('/cloudrun/:region/:service/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { region, service } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(region) || !/^[a-zA-Z0-9\-_]+$/.test(service)) {
    return res.status(400).json({ error: 'Invalid region or service name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const hours = Math.min(parseInt(req.query.hours) || 3, 72);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const filter = [
      `resource.type="cloud_run_revision"`,
      `resource.labels.service_name="${service}"`,
      `resource.labels.location="${region}"`,
      `timestamp>="${since}"`,
    ].join(' AND ');
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
        message:   logMessage(e),
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /gke/:location/:cluster/logs ─────────────────────────────────────────

router.get('/gke/:location/:cluster/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, cluster } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(location) || !/^[a-zA-Z0-9\-_]+$/.test(cluster)) {
    return res.status(400).json({ error: 'Invalid location or cluster name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const hours = Math.min(parseInt(req.query.hours) || 3, 72);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const filter = [
      `resource.type="k8s_cluster"`,
      `resource.labels.cluster_name="${cluster}"`,
      `resource.labels.location="${location}"`,
      `timestamp>="${since}"`,
    ].join(' AND ');
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
        message:   logMessage(e),
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /compute/vms ─────────────────────────────────────────────────────────

router.get('/compute/vms', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });

    const vms = await listVms({ auth, projectId });
    recordObservedStates(profileId, projectId, 'gcp-vm', vms);
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
    await waitZoneOp(auth, projectId, zone, operation);
    recordUserAction(profileId, projectId, 'gcp-vm', `${zone}/${name}`, name, 'start');
    res.json({ success: true, instance: name, zone, action: 'start' });
    auditLog.log({
      category: 'gcp', action: 'Compute VM started',
      resource: `${zone}/${name}`, context: profileId,
    });
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
    await waitZoneOp(auth, projectId, zone, operation);
    recordUserAction(profileId, projectId, 'gcp-vm', `${zone}/${name}`, name, 'stop');
    res.json({ success: true, instance: name, zone, action: 'stop' });
    auditLog.log({
      category: 'gcp', action: 'Compute VM stopped',
      resource: `${zone}/${name}`, level: 'warning',
      context: profileId,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /compute/vms/:zone/:name/serial-log ──────────────────────────────────

router.get('/compute/vms/:zone/:name/serial-log', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { zone, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(zone) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid zone or instance name' });
  }
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const { InstancesClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const [result] = await client.getSerialPortOutput({ project: projectId, zone, instance: name, port: 1, start: -limit });
    const lines = (result.contents || '').split('\n').filter(Boolean);
    res.json({
      entries: lines.slice(-limit).map(line => ({
        timestamp: null,
        severity: 'DEFAULT',
        message: line,
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// ─── REST helper (Node 18+ native fetch) ─────────────────────────────────────

/**
 * Make an authenticated GCP REST call.
 * authCtx = { auth, accessToken? } as returned by resolveGcpAuth().
 */
async function gcpFetch(url, authCtx, method = 'GET', body = undefined, requestHeaders = {}) {
  let token = authCtx.accessToken;
  if (!token) {
    const client = await authCtx.auth.getClient();
    const t      = await client.getAccessToken();
    token = t.token;
  }
  const opts = {
    method,
    headers: { ...requestHeaders, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(text), {
    code: res.status,
    statusCode: res.status,
    retryAfter: Number(res.headers?.get?.('retry-after')) || null,
  });
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
    const instances = await listSqlInstances(authCtx);
    recordObservedStates(profileId, projectId, 'gcp-sql', instances);
    res.json(instances);
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
    recordUserAction(profileId, projectId, 'gcp-sql', req.params.instance, req.params.instance, 'start');
    res.json({ success: true, instance: req.params.instance, action: 'start' });
    auditLog.log({
      category: 'gcp', action: 'Cloud SQL instance started',
      resource: req.params.instance, context: profileId,
    });
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
    recordUserAction(profileId, projectId, 'gcp-sql', req.params.instance, req.params.instance, 'stop');
    res.json({ success: true, instance: req.params.instance, action: 'stop' });
    auditLog.log({
      category: 'gcp', action: 'Cloud SQL instance stopped',
      resource: req.params.instance, level: 'warning',
      context: profileId,
    });
  } catch (err) { handleErr(res, err); }
});

// ─── GET /sql/:instance/logs ───────────────────────────────────────────────────

router.get('/sql/:instance/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { instance } = req.params;
  if (!/^[a-zA-Z0-9\-_]+$/.test(instance)) {
    return res.status(400).json({ error: 'Invalid instance name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const hours = Math.min(parseInt(req.query.hours) || 3, 72);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const filter = [
      `resource.type="cloudsql_database"`,
      `resource.labels.database_id="${projectId}:${instance}"`,
      `timestamp>="${since}"`,
    ].join(' AND ');
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
        message:   logMessage(e),
      })),
    });
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
    res.json((data.functions || []).map(mapFunction));
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
  const paramsError = functionParamsError({ location, name });
  if (paramsError) return res.status(400).json({ error: paramsError, code: 'INVALID_ARGUMENT' });
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
  const paramsError = functionParamsError({ location, name });
  if (paramsError) return res.status(400).json({ error: paramsError, code: 'INVALID_ARGUMENT' });
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const hours = Math.min(parseInt(req.query.hours) || 3, 72);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    // Cloud Functions Gen 2 run as Cloud Run services
    const filter = functionLogFilter({ location, name, since });
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
        message:   logMessage(e),
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

// DELETE /storage/:bucket/object?key=... → delete a GCS object
router.delete('/storage/:bucket/object', async (req, res) => {
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
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(key)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok && resp.status !== 204) {
      const text = await resp.text();
      throw Object.assign(new Error(text || `HTTP ${resp.status}`), { code: resp.status });
    }
    res.json({ deleted: key });
  } catch (err) { handleErr(res, err); }
});

// POST /storage/:bucket/upload?key=<object-key>&contentType=<mime>
// Body: raw binary of the file (Content-Type: application/octet-stream or actual MIME)
router.post('/storage/:bucket/upload', require('express').raw({ type: '*/*', limit: '500mb' }), async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const objectKey = req.query.key;
  if (!objectKey) return res.status(400).json({ error: 'key query param is required' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const bucket  = req.params.bucket;
    const mimeType = req.query.contentType || req.headers['x-content-type'] || 'application/octet-stream';
    let token = authCtx.accessToken;
    if (!token) {
      const c = await authCtx.auth.getClient();
      token = (await c.getAccessToken()).token;
    }
    const body = req.body; // Buffer from express.raw()
    const up = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectKey)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType, 'Content-Length': body.length },
        body
      }
    );
    if (!up.ok) { const t = await up.text(); throw new Error(t || `HTTP ${up.status}`); }
    const meta = await up.json();
    res.json({ uploaded: objectKey, size: meta.size, contentType: meta.contentType });
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

// GET /artifact-registry/:location/:repo/packages/:pkg/tags → list image tags
router.get('/artifact-registry/:location/:repo/packages/:pkg/tags', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, repo, pkg } = req.params;
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/${location}/repositories/${repo}/packages/${encodeURIComponent(pkg)}/tags?pageSize=100`,
      authCtx
    );
    res.json((data.tags || []).map(t => ({
      name:    t.name?.split('/tags/').pop(),
      version: t.version?.split('/versions/').pop(),
      created: t.createTime,
      updated: t.updateTime,
    })));
  } catch (err) { handleErr(res, err); }
});

// GET /artifact-registry/:location/:repo/image-url → build the registry hostname for this repo
router.get('/artifact-registry/:location/:repo/info', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, repo } = req.params;
  try {
    const authCtx   = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://artifactregistry.googleapis.com/v1/projects/${projectId}/locations/${location}/repositories/${repo}`,
      authCtx
    );
    // Build image prefix: <location>-docker.pkg.dev/<project>/<repo>
    const host = `${location}-docker.pkg.dev`;
    res.json({
      name:        data.name?.split('/').pop(),
      format:      data.format,
      location,
      description: data.description || '',
      created:     data.createTime,
      updated:     data.updateTime,
      imagePrefix: `${host}/${projectId}/${repo}`,
    });
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
    res.json((await listWorkflows(gcpFetch, authCtx)).map(mapWorkflow));
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

// GET /workflows/:location/:name/logs → Cloud Logging entries for a workflow
router.get('/workflows/:location/:name/logs', async (req, res) => {
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
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const hours = Math.min(parseInt(req.query.hours) || 3, 72);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const filter = [
      `resource.type="workflows.googleapis.com/Workflow"`,
      `resource.labels.workflow_name="${name}"`,
      `resource.labels.location="${location}"`,
      `timestamp>="${since}"`,
    ].join(' AND ');
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
        message:   logMessage(e),
      })),
    });
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
    const database = await gcpFetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}`, authCtx);
    if (database.type === 'DATASTORE_MODE') {
      return res.json(await createDatastoreReader(gcpFetch, authCtx, dbId).collections());
    }
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
    const pageSize  = Math.max(1, Math.min(parseInt(req.query.pageSize) || 25, 100));
    const database = await gcpFetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${db}`, authCtx);
    if (database.type === 'DATASTORE_MODE') {
      return res.json(await createDatastoreReader(gcpFetch, authCtx, db).documents(collection, {
        pageSize, pageToken, namespace: typeof req.query.namespace === 'string' ? req.query.namespace : '',
      }));
    }
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

  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const query = loggingRequest(projectId, req.body || {});
    const data = await gcpFetch('https://logging.googleapis.com/v2/entries:list', authCtx, 'POST', query.body);
    res.json({ entries: (data.entries || []).map(mapLogEntry), nextPageToken: data.nextPageToken || null,
      since: query.since, until: query.until });
  } catch (err) { handleErr(res, err); }
});

// ── Cloud KMS ─────────────────────────────────────────────────────────────────

// GET /kms/keyrings → list all key rings (all locations)
// ─── CLOUD MONITORING — generic timeseries ────────────────────────────────────
// GET /monitoring/timeseries?metric=<type>&filter=<extra>&hours=1&aligner=ALIGN_MEAN&period=60&reducer=REDUCE_MEAN
router.get('/monitoring/timeseries', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { metric, filter = '', hours = '1', aligner = 'ALIGN_MEAN', period = '60', reducer = 'REDUCE_MEAN' } = req.query;
  if (!metric) return res.status(400).json({ error: 'metric param required' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    let token = authCtx.accessToken;
    if (!token) {
      const c = await authCtx.auth.getClient();
      token = (await c.getAccessToken()).token;
    }
    const now   = new Date();
    const start = new Date(now - Number(hours) * 3600 * 1000);
    const filterStr = filter ? `metric.type="${metric}" AND ${filter}` : `metric.type="${metric}"`;
    const params = new URLSearchParams({
      filter: filterStr,
      'interval.startTime': start.toISOString(),
      'interval.endTime':   now.toISOString(),
      'aggregation.alignmentPeriod':    `${period}s`,
      'aggregation.perSeriesAligner':   aligner,
      'aggregation.crossSeriesReducer': reducer,
    });
    const resp = await fetch(
      `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw Object.assign(new Error(text || `HTTP ${resp.status}`), { code: resp.status });
    }
    const data = await resp.json();
    // Normalize: collect all series points, sort ascending
    const allPoints = [];
    for (const ts of (data.timeSeries || [])) {
      for (const pt of (ts.points || [])) {
        const t = pt.interval.endTime;
        const val = pt.value;
        let y = val.doubleValue ?? val.int64Value ?? val.distributionValue?.mean ?? 0;
        if (typeof val.int64Value === 'string') y = Number(val.int64Value);
        allPoints.push({ x: t, y: Number(y) || 0 });
      }
    }
    allPoints.sort((a, b) => new Date(a.x) - new Date(b.x));
    res.json({ points: allPoints, seriesCount: (data.timeSeries || []).length });
  } catch (err) { handleErr(res, err); }
});

router.get('/kms/keyrings', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const rings = await createKmsReader(gcpFetch, authCtx).keyRings();
    const keyrings = rings.map(k => ({
      name:     k.name?.split('/').pop(),
      location: k.name?.split('/')[3],
      created:  k.createTime,
    }));
    res.json(keyrings);
  } catch (err) { handleErr(res, err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── LABELS (Compute VM, Cloud Run, Cloud SQL) ───────────────────────────────
// PUT with the full desired user labels; system labels are preserved
// (lib/gcpResources.validateLabels). Changes are audited and added to the
// resource's state history.

function recordLabelChange(profileId, projectId, resourceType, key, name, diff) {
  auditLog.log({ category: 'gcp', action: 'Labels updated', resource: key, context: profileId, details: diff });
  recordUserAction(profileId, projectId, resourceType, key, name, 'labels', diff);
}

/** Poll a Cloud SQL Admin operation until DONE (label patches take a few seconds). */
async function waitSqlOperation(authCtx, projectId, operation, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let op = operation;
  while (op?.name && op.status !== 'DONE') {
    if (Date.now() > deadline) return op;
    await new Promise(r => setTimeout(r, 1500));
    op = await gcpFetch(`https://sqladmin.googleapis.com/v1/projects/${projectId}/operations/${op.name}`, authCtx);
  }
  if (op?.error?.errors?.length) throw Object.assign(new Error(op.error.errors.map(e => e.message).join('; ')), { code: 400 });
  return op;
}

// PUT /compute/vms/:zone/:name/labels { labels }
router.put('/compute/vms/:zone/:name/labels', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { zone, name } = req.params;
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { InstancesClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const [vm] = await client.get({ project: projectId, zone, instance: name });
    const { labels, diff } = validateLabels(req.body?.labels, vm.labels || {});
    if (hasLabelChanges(diff)) {
      const [operation] = await client.setLabels({
        project: projectId, zone, instance: name,
        instancesSetLabelsRequestResource: { labels, labelFingerprint: vm.labelFingerprint },
      });
      await waitZoneOp(auth, projectId, zone, operation);
      recordLabelChange(profileId, projectId, 'gcp-vm', `${zone}/${name}`, name, diff);
    }
    res.json({ success: true, labels, diff });
  } catch (err) { handleErr(res, err); }
});

// PUT /cloudrun/:region/:service/labels { labels }
router.put('/cloudrun/:region/:service/labels', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { region, service } = req.params;
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { ServicesClient } = require('@google-cloud/run').v2;
    const client = new ServicesClient({ auth });
    const fullName = `projects/${projectId}/locations/${region}/services/${service}`;
    const [current] = await client.getService({ name: fullName });
    const { labels, diff } = validateLabels(req.body?.labels, current.labels || {});
    if (hasLabelChanges(diff)) {
      const [operation] = await client.updateService({
        service: { name: fullName, labels },
        updateMask: { paths: ['labels'] },
      });
      await operation.promise();
      recordLabelChange(profileId, projectId, 'gcp-cloud-run', `${region}/${service}`, service, diff);
    }
    res.json({ success: true, labels, diff });
  } catch (err) { handleErr(res, err); }
});

// PUT /sql/:instance/labels { labels }
router.put('/sql/:instance/labels', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { instance } = req.params;
    if (!/^[a-zA-Z0-9\-_]+$/.test(instance)) return res.status(400).json({ error: 'Invalid instance name' });
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const url = `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances/${instance}`;
    const current = await gcpFetch(url, authCtx);
    const { labels, diff } = validateLabels(req.body?.labels, current.settings?.userLabels || {});
    if (hasLabelChanges(diff)) {
      // PATCH merges maps: removed keys must be sent as null (like gcloud --remove-user-labels)
      const userLabels = { ...labels, ...Object.fromEntries(diff.removed.map(k => [k, null])) };
      const operation = await gcpFetch(url, authCtx, 'PATCH', { settings: { userLabels } });
      await waitSqlOperation(authCtx, projectId, operation);
      recordLabelChange(profileId, projectId, 'gcp-sql', instance, instance, diff);
    }
    res.json({ success: true, labels, diff });
  } catch (err) { handleErr(res, err); }
});

// ─── STATE HISTORY & POLLING ──────────────────────────────────────────────────

const { createGcpStatePoller, pollCallsPerDay } = require('../lib/gcpStatePoller');
let statePoller = null;
function getStatePoller() {
  statePoller ||= createGcpStatePoller({
    history: getStateHistory(),
    resolveAuth: resolveGcpAuth,
    sources: STATE_SOURCES,
    recordStates: recordObservedStates,
  });
  return statePoller;
}

function pollSettingsResponse(profileId) {
  const settings = getStateHistory().getPollSettings('gcp', profileId);
  return { ...settings, callsPerDay: pollCallsPerDay(settings) };
}

// GET /history?type=gcp-vm&key=us-central1-a/web[&limit=&before=] → state/action timeline
router.get('/history', (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { type, key, limit, before } = req.query;
    if (!type || !key) return res.status(400).json({ error: 'type and key are required' });
    res.json(getStateHistory().listEvents({ provider: 'gcp', profileId, resourceType: type, key, limit, before }));
  } catch (err) { handleErr(res, err); }
});

// GET /history/polling → this profile's background polling settings (+ API reads/day)
router.get('/history/polling', (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try { res.json(pollSettingsResponse(profileId)); } catch (err) { handleErr(res, err); }
});

// PUT /history/polling { enabled, intervalMinutes, resourceTypes, retentionDays }
router.put('/history/polling', (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const before = getStateHistory().getPollSettings('gcp', profileId);
    getStateHistory().updatePollSettings('gcp', profileId, req.body || {});
    const after = pollSettingsResponse(profileId);
    if (before.enabled !== after.enabled || before.intervalMinutes !== after.intervalMinutes) {
      auditLog.log({
        category: 'gcp', action: `State polling ${after.enabled ? 'enabled' : 'disabled'}`, resource: profileId,
        context: profileId, details: { intervalMinutes: after.intervalMinutes, resourceTypes: after.resourceTypes },
      });
    }
    res.json(after);
  } catch (err) { handleErr(res, err); }
});

// POST /history/polling/run → poll this profile now (works even when disabled)
router.post('/history/polling/run', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const result = await getStatePoller().runProfile(profileId);
    res.json({ ...result, settings: pollSettingsResponse(profileId) });
  } catch (err) { handleErr(res, err); }
});

// ─── CREATE / DELETE (Cloud Run, Compute VM, Cloud SQL) ───────────────────────
// Every create needs the typed name plus a cost acknowledgement (and a second one
// above the high-cost threshold); every delete needs the typed name. The UI asks
// for the same, but it is enforced here so a direct request cannot skip it.

const RESOURCE_LABELS = { 'created-by': 'kua' };

// GET /presets → curated locations, machine types, SQL tiers and images (with prices)
router.get('/presets', (_req, res) => {
  res.json(createPresets());
});

// POST /estimate/:kind → approximate monthly cost for a create form (no side effects)
router.post('/estimate/:kind', (req, res) => {
  try {
    res.json(estimate(req.params.kind, req.body || {}));
  } catch (err) { handleErr(res, err); }
});

// POST /cloudrun → create a Cloud Run service
router.post('/cloudrun', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { spec, estimate: cost } = validateCreate('cloudrun', req.body);
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { ServicesClient } = require('@google-cloud/run').v2;
    const client = new ServicesClient({ auth });
    const parent = `projects/${projectId}/locations/${spec.region}`;
    const [operation] = await client.createService({
      parent,
      serviceId: spec.name,
      service: {
        labels: RESOURCE_LABELS,
        template: {
          containers: [{ image: spec.image, resources: { limits: { cpu: spec.cpu, memory: spec.memory } } }],
          scaling: { minInstanceCount: spec.minInstances, maxInstanceCount: spec.maxInstances },
        },
      },
    });
    const [created] = await operation.promise();
    if (spec.allowUnauthenticated) {
      await client.setIamPolicy({
        resource: `${parent}/services/${spec.name}`,
        policy: { bindings: [{ role: 'roles/run.invoker', members: ['allUsers'] }] },
      });
    }
    auditLog.log({
      category: 'gcp', action: 'Cloud Run service created', resource: `${spec.region}/${spec.name}`,
      level: 'warning', context: profileId,
      details: { image: spec.image, minInstances: spec.minInstances, public: spec.allowUnauthenticated, estimatedMonthlyUsd: cost.monthlyUsd },
    });
    recordUserAction(profileId, projectId, 'gcp-cloud-run', `${spec.region}/${spec.name}`, spec.name, 'create', { image: spec.image, estimatedMonthlyUsd: cost.monthlyUsd });
    res.status(201).json({ success: true, service: mapCloudRunService(created), estimate: cost });
  } catch (err) { handleErr(res, err); }
});

// DELETE /cloudrun/:region/:service → delete a Cloud Run service (all revisions + URL)
router.delete('/cloudrun/:region/:service', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { region, service } = req.params;
    assertDeleteConfirmed(service, req.body);
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { ServicesClient } = require('@google-cloud/run').v2;
    const client = new ServicesClient({ auth });
    const [operation] = await client.deleteService({ name: `projects/${projectId}/locations/${region}/services/${service}` });
    await operation.promise();
    auditLog.log({ category: 'gcp', action: 'Cloud Run service deleted', resource: `${region}/${service}`, level: 'warning', context: profileId });
    recordUserAction(profileId, projectId, 'gcp-cloud-run', `${region}/${service}`, service, 'delete');
    res.json({ success: true, service, region, action: 'delete' });
  } catch (err) { handleErr(res, err); }
});

// POST /compute/vms → create a Compute Engine VM
router.post('/compute/vms', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { spec, estimate: cost } = validateCreate('vm', req.body);
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { InstancesClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const [operation] = await client.insert({
      project: projectId,
      zone: spec.zone,
      instanceResource: {
        name: spec.name,
        machineType: `zones/${spec.zone}/machineTypes/${spec.machineType}`,
        labels: RESOURCE_LABELS,
        deletionProtection: spec.deletionProtection,
        disks: [{
          boot: true,
          autoDelete: true,
          initializeParams: {
            sourceImage: `projects/${spec.imageProject}/global/images/family/${spec.imageFamily}`,
            diskSizeGb: String(spec.diskSizeGb),
            diskType: `zones/${spec.zone}/diskTypes/${spec.diskType}`,
          },
        }],
        networkInterfaces: [{
          network: 'global/networks/default',
          accessConfigs: spec.externalIp ? [{ name: 'External NAT', type: 'ONE_TO_ONE_NAT' }] : [],
        }],
        ...(spec.spot ? { scheduling: { provisioningModel: 'SPOT', instanceTerminationAction: 'STOP' } } : {}),
      },
    });
    await waitZoneOp(auth, projectId, spec.zone, operation);
    auditLog.log({
      category: 'gcp', action: 'Compute VM created', resource: `${spec.zone}/${spec.name}`,
      level: 'warning', context: profileId,
      details: { machineType: spec.machineType, diskSizeGb: spec.diskSizeGb, spot: spec.spot, estimatedMonthlyUsd: cost.monthlyUsd },
    });
    recordUserAction(profileId, projectId, 'gcp-vm', `${spec.zone}/${spec.name}`, spec.name, 'create', { machineType: spec.machineType, estimatedMonthlyUsd: cost.monthlyUsd });
    res.status(201).json({ success: true, instance: spec.name, zone: spec.zone, estimate: cost });
  } catch (err) { handleErr(res, err); }
});

// DELETE /compute/vms/:zone/:name → delete a VM (boot disk too when autoDelete)
router.delete('/compute/vms/:zone/:name', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { zone, name } = req.params;
    assertDeleteConfirmed(name, req.body);
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { InstancesClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const [vm] = await client.get({ project: projectId, zone, instance: name });
    if (vm.deletionProtection) {
      return res.status(409).json({ error: `VM ${name} has deletion protection enabled. Disable it in the Google Cloud console first.` });
    }
    const [operation] = await client.delete({ project: projectId, zone, instance: name });
    await waitZoneOp(auth, projectId, zone, operation);
    auditLog.log({ category: 'gcp', action: 'Compute VM deleted', resource: `${zone}/${name}`, level: 'warning', context: profileId });
    recordUserAction(profileId, projectId, 'gcp-vm', `${zone}/${name}`, name, 'delete');
    res.json({ success: true, instance: name, zone, action: 'delete' });
  } catch (err) { handleErr(res, err); }
});

// POST /sql → create a Cloud SQL instance (takes several minutes: returns 202)
router.post('/sql', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { spec, estimate: cost } = validateCreate('sql', req.body);
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const operation = await gcpFetch(
      `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances`,
      authCtx, 'POST', {
        name: spec.name,
        region: spec.region,
        databaseVersion: spec.databaseVersion,
        rootPassword: spec.rootPassword,
        settings: {
          tier: spec.tier,
          edition: 'ENTERPRISE',
          dataDiskSizeGb: String(spec.storageGb),
          dataDiskType: spec.storageType,
          availabilityType: spec.availabilityType,
          backupConfiguration: { enabled: spec.backupEnabled },
          deletionProtectionEnabled: spec.deletionProtection,
          userLabels: RESOURCE_LABELS,
        },
      }
    );
    auditLog.log({
      category: 'gcp', action: 'Cloud SQL instance created', resource: spec.name,
      level: 'warning', context: profileId,
      details: { tier: spec.tier, databaseVersion: spec.databaseVersion, availabilityType: spec.availabilityType, estimatedMonthlyUsd: cost.monthlyUsd },
    });
    recordUserAction(profileId, projectId, 'gcp-sql', spec.name, spec.name, 'create', { tier: spec.tier, estimatedMonthlyUsd: cost.monthlyUsd });
    res.status(202).json({ success: true, instance: spec.name, operation: operation.name || null, estimate: cost });
  } catch (err) { handleErr(res, err); }
});

// DELETE /sql/:instance → delete a Cloud SQL instance with its data and backups (202)
router.delete('/sql/:instance', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  try {
    const { instance } = req.params;
    if (!/^[a-zA-Z0-9\-_]+$/.test(instance)) return res.status(400).json({ error: 'Invalid instance name' });
    assertDeleteConfirmed(instance, req.body);
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const url = `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances/${instance}`;
    const current = await gcpFetch(url, authCtx);
    if (current.settings?.deletionProtectionEnabled) {
      return res.status(409).json({ error: `Cloud SQL instance ${instance} has deletion protection enabled. Disable it in the Google Cloud console first.` });
    }
    const operation = await gcpFetch(url, authCtx, 'DELETE');
    auditLog.log({ category: 'gcp', action: 'Cloud SQL instance deleted', resource: instance, level: 'warning', context: profileId });
    recordUserAction(profileId, projectId, 'gcp-sql', instance, instance, 'delete');
    res.status(202).json({ success: true, instance, action: 'delete', operation: operation.name || null });
  } catch (err) { handleErr(res, err); }
});

// ─── DETAIL ENDPOINTS (master-detail panels) ──────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// GET /cloudrun/:region/:service/detail → full service details + revisions + env vars
router.get('/cloudrun/:region/:service/detail', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { region, service } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(region) || !/^[a-zA-Z0-9\-_.]+$/.test(service)) {
    return res.status(400).json({ error: 'Invalid region or service name' });
  }
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { ServicesClient, RevisionsClient } = require('@google-cloud/run').v2;
    const svcClient = new ServicesClient({ auth });
    const revClient = new RevisionsClient({ auth });
    const name = `projects/${projectId}/locations/${region}/services/${service}`;
    const [[svc], [revs], policy] = await Promise.all([
      svcClient.getService({ name }),
      revClient.listRevisions({ parent: name }),
      // Public = allUsers can invoke; unreadable policy → unknown (null)
      svcClient.getIamPolicy({ resource: name }).then(([p]) => p, () => null),
    ]);
    const publicAccess = policy
      ? (policy.bindings || []).some(b => b.role === 'roles/run.invoker' && (b.members || []).includes('allUsers'))
      : null;
    res.json(mapCloudRunDetail(svc, revs || [], { region, publicAccess }));
  } catch (err) { handleErr(res, err); }
});

// GET /compute/vms/:zone/:name/detail → full VM details (disks, network, tags, metadata)
router.get('/compute/vms/:zone/:name/detail', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { zone, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(zone) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid zone or instance name' });
  }
  try {
    const { auth, projectId } = await resolveGcpAuth(profileId);
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const { InstancesClient, DisksClient } = require('@google-cloud/compute');
    const client = new InstancesClient({ auth });
    const [vm] = await client.get({ project: projectId, zone, instance: name });
    // Disk resources add type, source image and encryption (usually 1-2 disks)
    const diskClient = new DisksClient({ auth });
    const diskEntries = await Promise.all((vm.disks || []).map(async d => {
      const diskName = d.source?.split('/').pop();
      if (!diskName) return null;
      try { const [disk] = await diskClient.get({ project: projectId, zone, disk: diskName }); return [diskName, disk]; }
      catch { return null; }
    }));
    res.json(mapVmDetail(vm, Object.fromEntries(diskEntries.filter(Boolean))));
  } catch (err) { handleErr(res, err); }
});

// GET /compute/vms/:zone/:name/logs → Cloud Logging entries for VM
router.get('/compute/vms/:zone/:name/logs', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { zone, name } = req.params;
  if (!/^[a-zA-Z0-9\-]+$/.test(zone) || !/^[a-zA-Z0-9\-_]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid zone or instance name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const hours = Math.min(parseInt(req.query.hours) || 3, 72);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const filter = [
      `resource.type="gce_instance"`,
      `resource.labels.instance_id="${name}"`,
      `timestamp>="${since}"`,
    ].join(' AND ');
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
        message:   logMessage(e),
      })),
    });
  } catch (err) { handleErr(res, err); }
});

// GET /sql/:instance/detail → full Cloud SQL instance details
router.get('/sql/:instance/detail', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { instance } = req.params;
  if (!/^[a-zA-Z0-9\-_]+$/.test(instance)) {
    return res.status(400).json({ error: 'Invalid instance name' });
  }
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://sqladmin.googleapis.com/v1/projects/${projectId}/instances/${instance}`,
      authCtx
    );
    res.json(mapSqlDetail(data));
  } catch (err) { handleErr(res, err); }
});

// GET /functions/:location/:name/detail → full Cloud Function details
router.get('/functions/:location/:name/detail', async (req, res) => {
  const profileId = requireProfileId(req, res);
  if (!profileId) return;
  const { location, name } = req.params;
  const paramsError = functionParamsError({ location, name });
  if (paramsError) return res.status(400).json({ error: paramsError, code: 'INVALID_ARGUMENT' });
  try {
    const authCtx = await resolveGcpAuth(profileId);
    const { projectId } = authCtx;
    if (!projectId) return res.status(400).json({ error: 'GCP_PROJECT_ID is required' });
    const data = await gcpFetch(
      `https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/${location}/functions/${name}`,
      authCtx
    );
    const sc = data.serviceConfig || {};
    const bc = data.buildConfig || {};
    const et = data.eventTrigger || {};
    const envVars = Object.entries(sc.environmentVariables || {}).map(([k, v]) => ({ name: k, value: v }));
    res.json({
      name:            data.name?.split('/').pop(),
      location,
      fullName:        data.name || null,
      state:           data.state,
      runtime:         bc.runtime,
      trigger:         et.eventType ? 'EVENT' : 'HTTPS',
      triggerType:     et.eventType || 'HTTP',
      url:             sc.uri,
      memory:          sc.availableMemory,
      cpu:             sc.availableCpu,
      timeout:         sc.timeoutSeconds,
      minInstances:    sc.minInstanceCount ?? 0,
      maxInstances:    sc.maxInstanceCount ?? null,
      ingressSettings: sc.ingressSettings,
      serviceAccount:  sc.serviceAccountEmail,
      updated:         data.updateTime,
      created:         data.createTime,
      entryPoint:      bc.entryPoint,
      sourceRepo:      bc.source?.repoSource?.repoName || null,
      envVars,
    });
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
    const cryptoKeys = await createKmsReader(gcpFetch, authCtx).keys(location, keyring);
    const keys = cryptoKeys.map(k => ({
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
module.exports.resolveGcpAuth = resolveGcpAuth;
module.exports.gcpFetch = gcpFetch;
module.exports.STATE_SOURCES = STATE_SOURCES;
module.exports.recordObservedStates = recordObservedStates;
module.exports.recordUserAction = recordUserAction;
module.exports.startStatePoller = () => getStatePoller().start();
module.exports.stopStatePoller = () => statePoller?.stop();
