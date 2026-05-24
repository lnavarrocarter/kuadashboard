'use strict';

const express    = require('express');
const http       = require('http');
const net        = require('net');
const fs         = require('fs');
const os         = require('os');
const path       = require('path');
const stream     = require('stream');
const request    = require('request');
const WebSocket  = require('ws');
const k8s        = require('@kubernetes/client-node');
const yaml       = require('js-yaml');

const app    = express();
const server = http.createServer(app);

// ─── Cloud integration routes ─────────────────────────────────────────────────
const envManagerRoutes  = require('./routes/envManager');
const gcpRoutes         = require('./routes/gcp');
const awsRoutes         = require('./routes/aws');
const vercelRoutes      = require('./routes/vercel');
const aiRoutes          = require('./routes/ai');
const helmRoutes        = require('./routes/helm');
const systemToolsRoutes = require('./routes/systemTools');
const localShellRoutes  = require('./routes/localShell');
const auditLogRoutes    = require('./routes/auditLog');
const auditLog          = require('./lib/auditLog');
// Use noServer + manual upgrade routing to avoid the ws multi-server path conflict
// where the first WebSocket.Server's upgrade listener destroys sockets meant for the second.
const wss        = new WebSocket.Server({ noServer: true });
const wssExec    = new WebSocket.Server({ noServer: true });
const wssShell   = new WebSocket.Server({ noServer: true });
const wssEc2Shell = new WebSocket.Server({ noServer: true });
const wssEc2Rdp   = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  if (pathname === '/ws/logs') {
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  } else if (pathname === '/ws/exec') {
    wssExec.handleUpgrade(request, socket, head, ws => wssExec.emit('connection', ws, request));
  } else if (pathname === '/ws/shell') {
    wssShell.handleUpgrade(request, socket, head, ws => wssShell.emit('connection', ws, request));
  } else if (pathname === '/ws/ec2-shell') {
    wssEc2Shell.handleUpgrade(request, socket, head, ws => wssEc2Shell.emit('connection', ws, request));
  } else if (pathname === '/ws/ec2-rdp') {
    wssEc2Rdp.handleUpgrade(request, socket, head, ws => wssEc2Rdp.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

app.use(express.json({ limit: '10mb' }));

// ─── Mount cloud routes ───────────────────────────────────────────────────────
app.use('/api/cloud/envs',    envManagerRoutes);
app.use('/api/cloud/gcp',     gcpRoutes);
app.use('/api/cloud/aws',     awsRoutes);
app.use('/api/cloud/vercel',  vercelRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/helm',          helmRoutes);
app.use('/api/system',        systemToolsRoutes);
app.use('/api/local',         localShellRoutes);
app.use('/api/audit',         auditLogRoutes);

app.use(express.static(path.join(__dirname, 'public'), {
  etag:         false,
  lastModified: false,
  setHeaders:   (res, filePath) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    // Force UTF-8 charset so emojis/icons in JS/CSS render correctly
    if (filePath.endsWith('.js'))  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
    if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
  },
}));

// ─── KubeConfig state ─────────────────────────────────────────────────────────

let currentKc      = null;
let currentContext = "default"; // Placeholder until we load real contexts

// Path where we persist imported contexts (merged kubeconfig)
const MERGED_KUBECONFIG  = path.join(os.homedir(), '.kube', 'kuadashboard_merged.yaml');
const DEFAULT_KUBECONFIG = path.join(os.homedir(), '.kube', 'config');
const KUBECONFIG_PATHS   = path.join(os.homedir(), '.kube', 'kuadashboard_paths.json');

/**
 * Merge clusters/users/contexts from `src` KubeConfig into `dst` KubeConfig
 * without overwriting existing entries (non-destructive).
 */
function mergeKc(dst, src) {
  src.clusters.forEach(c   => { if (!dst.clusters.find(x => x.name === c.name))   dst.clusters.push(c); });
  src.users.forEach(u      => { if (!dst.users.find(x => x.name === u.name))       dst.users.push(u); });
  src.contexts.forEach(ctx => { if (!dst.contexts.find(x => x.name === ctx.name)) dst.contexts.push(ctx); });
}

/**
 * Collect all kubeconfig file paths to load, respecting the KUBECONFIG env var
 * exactly like kubectl does (paths separated by ; on Windows, : elsewhere).
 */
function resolveKubeConfigFiles() {
  const envVar = process.env.KUBECONFIG || '';
  const sep    = process.platform === 'win32' ? ';' : ':';
  const fromEnv = envVar
    ? envVar.split(sep).map(p => p.trim()).filter(p => p && fs.existsSync(p))
    : [];

  // Always include the default ~/.kube/config if present
  const files = [...fromEnv];
  if (!files.includes(DEFAULT_KUBECONFIG) && fs.existsSync(DEFAULT_KUBECONFIG)) {
    files.push(DEFAULT_KUBECONFIG);
  }
  readRegisteredKubeconfigPaths().forEach(file => {
    if (!files.includes(file) && fs.existsSync(file)) files.push(file);
  });
  return files;
}

function expandUserPath(filePath = '') {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  return raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : path.resolve(raw);
}

function readRegisteredKubeconfigPaths() {
  try {
    const parsed = JSON.parse(fs.readFileSync(KUBECONFIG_PATHS, 'utf8'));
    return Array.isArray(parsed.paths) ? parsed.paths.filter(p => typeof p === 'string') : [];
  } catch (_) {
    return [];
  }
}

function writeRegisteredKubeconfigPaths(paths) {
  const kubeDir = path.join(os.homedir(), '.kube');
  if (!fs.existsSync(kubeDir)) fs.mkdirSync(kubeDir, { mode: 0o700, recursive: true });
  fs.writeFileSync(KUBECONFIG_PATHS, JSON.stringify({ paths }, null, 2), { mode: 0o600 });
}

function parseAndValidateKubeconfig(content) {
  let parsed;
  try { parsed = yaml.load(content); }
  catch (e) { throw new Error(`YAML parse error: ${e.message}`); }
  const validErr = validateKubeconfig(parsed);
  if (validErr) throw new Error(validErr);
  return parsed;
}

function loadKubeConfig(contextName) {
  const kc    = new k8s.KubeConfig();
  const files = resolveKubeConfigFiles();
  const loaded = [];

  if (files.length === 0) {
    // Last resort: in-cluster / default discovery
    kc.loadFromDefault();
    loaded.push('(default discovery)');
  } else {
    // Load first file as base, then merge the rest
    kc.loadFromFile(files[0]);
    loaded.push(files[0]);
    for (let i = 1; i < files.length; i++) {
      try {
        const extra = new k8s.KubeConfig();
        extra.loadFromFile(files[i]);
        mergeKc(kc, extra);
        loaded.push(files[i]);
      } catch (e) { console.warn(`[warn] Could not load ${files[i]}:`, e.message); }
    }
  }

  // Merge manually imported contexts (via Import UI)
  if (fs.existsSync(MERGED_KUBECONFIG)) {
    try {
      const extra = new k8s.KubeConfig();
      extra.loadFromFile(MERGED_KUBECONFIG);
      mergeKc(kc, extra);
      loaded.push(MERGED_KUBECONFIG);
    } catch (e) { console.warn('[warn] Could not load merged kubeconfig:', e.message); }
  }

  if (contextName) kc.setCurrentContext(contextName);

  // If no current context is set, fall back to the first available
  let resolved = kc.getCurrentContext();
  if (!resolved && kc.getContexts().length) {
    resolved = kc.getContexts()[0].name;
    kc.setCurrentContext(resolved);
  }
  currentContext = resolved;
  currentKc      = kc;
  console.log(`[kubeconfig] Loaded ${loaded.length} file(s): ${loaded.join(', ')}`);
  console.log(`[kubeconfig] Active context: ${currentContext} (${kc.getContexts().length} contexts total)`);
  return kc;
}

loadKubeConfig(null);

// ─── Kubeconfig import ────────────────────────────────────────────────────────

/**
 * Validates a parsed kubeconfig object and returns an error message or null.
 */
function validateKubeconfig(obj) {
  if (!obj || typeof obj !== 'object')               return 'YAML did not parse to an object.';
  if (obj.kind && obj.kind !== 'Config')             return `Expected kind: Config, got: ${obj.kind}`;
  if (!Array.isArray(obj.clusters) || !obj.clusters.length)
                                                      return 'Missing or empty "clusters" array.';
  if (!Array.isArray(obj.users) || !obj.users.length)
                                                      return 'Missing or empty "users" array.';
  if (!Array.isArray(obj.contexts) || !obj.contexts.length)
                                                      return 'Missing or empty "contexts" array.';
  for (const c of obj.clusters) {
    if (!c.name)          return 'A cluster entry is missing "name".';
    if (!c.cluster)       return `Cluster "${c.name}" is missing the "cluster" field.`;
    if (!c.cluster.server)return `Cluster "${c.name}" is missing "cluster.server".`;
  }
  for (const u of obj.users) {
    if (!u.name) return 'A user entry is missing "name".';
  }
  for (const ctx of obj.contexts) {
    if (!ctx.name)             return 'A context entry is missing "name".';
    if (!ctx.context)          return `Context "${ctx.name}" is missing the "context" field.`;
    if (!ctx.context.cluster)  return `Context "${ctx.name}" is missing "context.cluster".`;
    if (!ctx.context.user)     return `Context "${ctx.name}" is missing "context.user".`;
  }
  return null;
}

app.post('/api/kubeconfig/import', (req, res) => {
  try {
    const { yamlContent } = req.body;
    if (!yamlContent) return res.status(400).json({ error: 'yamlContent required' });

    const parsed = parseAndValidateKubeconfig(yamlContent);

    // Load existing merged config (if any) to merge into it
    let merged = { apiVersion: 'v1', kind: 'Config', clusters: [], users: [], contexts: [], preferences: {} };
    if (fs.existsSync(MERGED_KUBECONFIG)) {
      try { merged = yaml.load(fs.readFileSync(MERGED_KUBECONFIG, 'utf8')) || merged; }
      catch (_) { /* start fresh if corrupt */ }
    }

    const addedContexts = [];
    parsed.clusters.forEach(c  => { if (!merged.clusters.find(x => x.name === c.name))     merged.clusters.push(c);  });
    parsed.users.forEach(u     => { if (!merged.users.find(x => x.name === u.name))         merged.users.push(u);     });
    parsed.contexts.forEach(ctx => {
      if (!merged.contexts.find(x => x.name === ctx.name)) {
        merged.contexts.push(ctx);
        addedContexts.push(ctx.name);
      }
    });

    // Write merged file (under ~/.kube/)
    const kubeDir = path.join(os.homedir(), '.kube');
    if (!fs.existsSync(kubeDir)) fs.mkdirSync(kubeDir, { mode: 0o700, recursive: true });
    fs.writeFileSync(MERGED_KUBECONFIG, yaml.dump(merged), { mode: 0o600 });

    // Reload global kubeconfig so new contexts are available immediately
    loadKubeConfig(null);

    auditLog.log({
      category: 'kubernetes', action: 'KubeConfig imported',
      resource: addedContexts.join(', ') || '(none)',
      details:  { added: addedContexts.length, contexts: addedContexts },
      level:    'info',
    });
    res.json({ success: true, added: addedContexts.length, contexts: addedContexts });
  } catch (err) { handleError(res, err); }
});

app.post('/api/kubeconfig/path', (req, res) => {
  try {
    const filePath = expandUserPath(req.body?.path || req.body?.filePath);
    if (!filePath) return res.status(400).json({ error: 'path required' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Kubeconfig file not found: ${filePath}` });
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return res.status(400).json({ error: 'path must point to a file' });
    const parsed = parseAndValidateKubeconfig(fs.readFileSync(filePath, 'utf8'));

    const paths = readRegisteredKubeconfigPaths();
    if (!paths.includes(filePath)) {
      paths.push(filePath);
      writeRegisteredKubeconfigPaths(paths);
    }

    loadKubeConfig(null);
    const contexts = (parsed.contexts || []).map(ctx => ctx.name);
    auditLog.log({
      category: 'kubernetes', action: 'KubeConfig path registered',
      resource: filePath, details: { contexts }, level: 'info',
    });
    res.json({ success: true, path: filePath, contexts });
  } catch (err) { handleError(res, err); }
});

function clients() {
  return {
    core:       currentKc.makeApiClient(k8s.CoreV1Api),
    apps:       currentKc.makeApiClient(k8s.AppsV1Api),
    networking: currentKc.makeApiClient(k8s.NetworkingV1Api),
    batch:      currentKc.makeApiClient(k8s.BatchV1Api),
    autoscaling: currentKc.makeApiClient(k8s.AutoscalingV2Api),
    policy:     currentKc.makeApiClient(k8s.PolicyV1Api),
    storage:    currentKc.makeApiClient(k8s.StorageV1Api),
    coordination: currentKc.makeApiClient(k8s.CoordinationV1Api),
    discovery:  currentKc.makeApiClient(k8s.DiscoveryV1Api),
    admission:  currentKc.makeApiClient(k8s.AdmissionregistrationV1Api),
    scheduling: currentKc.makeApiClient(k8s.SchedulingV1Api),
    node:       currentKc.makeApiClient(k8s.NodeV1Api),
    custom:     currentKc.makeApiClient(k8s.CustomObjectsApi),
    log:        new k8s.Log(currentKc),
  };
}

function summarizeObject(obj = {}) {
  if (!obj || typeof obj !== 'object') return '-';
  return Object.entries(obj).map(([k, v]) => `${k}:${v}`).join(', ') || '-';
}

function selectorText(selector = {}) {
  const labels = Object.entries(selector.matchLabels || selector || {}).map(([k, v]) => `${k}=${v}`);
  const expressions = (selector.matchExpressions || []).map(expr => `${expr.key} ${expr.operator}${expr.values?.length ? ` (${expr.values.join(',')})` : ''}`);
  return [...labels, ...expressions].join(', ') || '-';
}

function listItems(result) { return result.body?.items || result.items || []; }

function yamlResponse(res, obj) { res.type('text/plain').send(yaml.dump(obj.body || obj)); }

// ─── Error helper ─────────────────────────────────────────────────────────────

function handleError(res, err) {
  const status  = err.statusCode || err.response?.statusCode || 500;
  const message = err.body?.message || err.message || 'Internal server error';
  console.error('[ERROR]', status, message);
  res.status(status).json({ error: message });
}

const PATCH_HEADERS = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } };
const JSON_PATCH_HEADERS = { headers: { 'Content-Type': 'application/json-patch+json' } };

function selectorToString(selector = {}) {
  const parts = [];
  Object.entries(selector.matchLabels || {}).forEach(([key, value]) => parts.push(`${key}=${value}`));
  (selector.matchExpressions || []).forEach(expr => {
    const values = (expr.values || []).join(',');
    if (expr.operator === 'In') parts.push(`${expr.key} in (${values})`);
    else if (expr.operator === 'NotIn') parts.push(`${expr.key} notin (${values})`);
    else if (expr.operator === 'Exists') parts.push(expr.key);
    else if (expr.operator === 'DoesNotExist') parts.push(`!${expr.key}`);
  });
  return parts.join(',');
}

function eventTime(evt = {}) {
  return evt.lastTimestamp || evt.eventTime || evt.metadata?.creationTimestamp || evt.firstTimestamp || null;
}

function normalizeEvent(evt = {}) {
  const involved = evt.involvedObject || evt.regarding || {};
  return {
    name: evt.metadata?.name,
    namespace: evt.metadata?.namespace || involved.namespace || '',
    type: evt.type || 'Normal',
    reason: evt.reason || '-',
    object: `${involved.kind || 'Object'}/${involved.name || '-'}`,
    objectKind: involved.kind || '',
    objectName: involved.name || '',
    objectNamespace: involved.namespace || evt.metadata?.namespace || '',
    message: evt.message || evt.note || '',
    source: evt.source?.component || evt.reportingController || evt.reportingInstance || '',
    count: evt.count || evt.series?.count || 1,
    firstTimestamp: evt.firstTimestamp || evt.eventTime || evt.metadata?.creationTimestamp,
    lastTimestamp: eventTime(evt),
    age: eventTime(evt),
  };
}

function metricTotalsFromContainers(containers = []) {
  const cpuNano = containers.reduce((sum, c) => sum + parseCpu(c.usage?.cpu), 0);
  const memoryBytes = containers.reduce((sum, c) => sum + parseMemory(c.usage?.memory), 0);
  return { cpuNano, memoryBytes };
}

function metricPayload({ cpuNano = 0, memoryBytes = 0, cpuCapacityNano = 1e9, memoryCapacityBytes = 512 * 1024 * 1024, items = [], containers = [], timestamp, window, source = 'metrics.k8s.io' } = {}) {
  return {
    timestamp,
    window,
    source,
    items,
    containers,
    cpu: {
      nano: cpuNano,
      cores: cpuNano / 1e9,
      display: formatCpu(cpuNano),
      percent: Math.min(100, Math.max(2, (cpuNano / Math.max(cpuCapacityNano, 1)) * 100)),
    },
    memory: {
      bytes: memoryBytes,
      display: formatBytes(memoryBytes),
      percent: Math.min(100, Math.max(2, (memoryBytes / Math.max(memoryCapacityBytes, 1)) * 100)),
    },
  };
}

function isMetricsApiUnavailable(err) {
  const message = err.body?.message || err.message || '';
  return err.statusCode === 404 || /metrics\.k8s\.io|not found|the server could not find|not have a resource type/i.test(message);
}

function metricsUnavailable(res, err) {
  if (isMetricsApiUnavailable(err)) {
    res.status(503).json({ error: 'Kubernetes Metrics API is not available. Install Metrics Server or Prometheus for resource usage.' });
    return true;
  }
  return false;
}

function prometheusServiceScore(svc = {}) {
  const labels = svc.metadata?.labels || {};
  const name = (svc.metadata?.name || '').toLowerCase();
  const text = [name, svc.metadata?.namespace, ...Object.keys(labels), ...Object.values(labels)].join(' ').toLowerCase();
  if (/alertmanager|grafana|operator|node-exporter|kube-state-metrics/.test(text)) return 0;
  let score = 0;
  if (labels['app.kubernetes.io/name'] === 'prometheus' || labels.app === 'prometheus') score += 8;
  if (name.includes('prometheus')) score += 5;
  if ((svc.spec?.ports || []).some(port => Number(port.port) === 9090 || Number(port.targetPort) === 9090)) score += 4;
  if ((svc.spec?.ports || []).some(port => /web|http|prometheus/.test(String(port.name || '').toLowerCase()))) score += 2;
  return score;
}

async function discoverPrometheusServices() {
  const { core } = clients();
  const services = await core.listServiceForAllNamespaces();
  return listItems(services)
    .map(svc => ({ svc, score: prometheusServiceScore(svc) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ svc }) => ({
      name: svc.metadata.name,
      namespace: svc.metadata.namespace,
      type: svc.spec?.type,
      ports: (svc.spec?.ports || []).map(p => ({ name: p.name, port: p.port, targetPort: p.targetPort })),
    }));
}

function serviceProxyCandidates(svc = {}) {
  const ports = svc.ports || [];
  const preferred = ports
    .filter(port => Number(port.port) === 9090 || /web|http|prometheus/.test(String(port.name || '').toLowerCase()));
  const ordered = preferred.length ? preferred : ports;
  const names = [svc.name];
  ordered.forEach(port => {
    if (port.name) names.push(`${svc.name}:${port.name}`, `http:${svc.name}:${port.name}`);
    if (port.port) names.push(`${svc.name}:${port.port}`, `http:${svc.name}:${port.port}`);
  });
  return [...new Set(names)];
}

async function kubeApiGet(pathname) {
  const cluster = currentKc.getCurrentCluster();
  if (!cluster?.server) throw new Error('No active Kubernetes cluster server');
  const opts = {
    method: 'GET',
    uri: `${cluster.server.replace(/\/$/, '')}${pathname}`,
    json: false,
    timeout: 10000,
  };
  await currentKc.applyToRequest(opts);
  return new Promise((resolve, reject) => {
    request(opts, (error, response, body) => {
      if (error) return reject(error);
      if (response.statusCode >= 200 && response.statusCode <= 299) return resolve(body);
      const err = new Error(`HTTP ${response.statusCode}: ${String(body || '').slice(0, 220)}`);
      err.statusCode = response.statusCode;
      reject(err);
    });
  });
}

async function prometheusQuery(query) {
  const services = await discoverPrometheusServices();
  let lastErr = null;
  for (const svc of services) {
    for (const proxyName of serviceProxyCandidates(svc)) {
      try {
        const raw = await kubeApiGet(`/api/v1/namespaces/${encodeURIComponent(svc.namespace)}/services/${proxyName}/proxy/api/v1/query?query=${encodeURIComponent(query)}`);
        const body = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (body?.status === 'success') return { body, service: svc };
        lastErr = new Error(body?.error || 'Prometheus query failed');
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error('No Prometheus service found');
}

function prometheusScalar(body) {
  const value = body?.data?.result?.[0]?.value?.[1];
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function regexEscape(value = '') { return String(value).replace(/[|\\{}()[\]^$+*?.]/g, '\\$&'); }

async function prometheusMetricsForPods(namespace, pods = []) {
  const names = pods.map(pod => pod.metadata?.name || pod.name).filter(Boolean);
  if (!names.length) throw new Error('No pods found for Prometheus metrics');
  const podMatcher = names.length === 1 ? `pod="${names[0]}"` : `pod=~"${names.map(regexEscape).join('|')}"`;
  const scope = `namespace="${namespace}",${podMatcher},container!="",container!="POD"`;
  const [cpuResult, memoryResult] = await Promise.all([
    prometheusQuery(`sum(rate(container_cpu_usage_seconds_total{${scope}}[5m]))`),
    prometheusQuery(`sum(container_memory_working_set_bytes{${scope}})`),
  ]);
  const cpuNano = prometheusScalar(cpuResult.body) * 1e9;
  const memoryBytes = prometheusScalar(memoryResult.body);
  return metricPayload({
    source: `Prometheus (${cpuResult.service.namespace}/${cpuResult.service.name})`,
    items: names.map(name => ({ name, cpu: '-', memory: '-' })),
    cpuNano,
    memoryBytes,
    cpuCapacityNano: Math.max(1e9, names.length * 1e9),
    memoryCapacityBytes: Math.max(512 * 1024 * 1024, names.length * 512 * 1024 * 1024),
  });
}

async function prometheusMetricsForNode(name) {
  const instanceMatcher = `instance=~"${regexEscape(name)}(:[0-9]+)?"`;
  const [cpuResult, memoryResult] = await Promise.all([
    prometheusQuery(`sum(rate(node_cpu_seconds_total{${instanceMatcher},mode!="idle"}[5m]))`),
    prometheusQuery(`sum(node_memory_MemTotal_bytes{${instanceMatcher}} - node_memory_MemAvailable_bytes{${instanceMatcher}})`),
  ]);
  return metricPayload({
    source: `Prometheus (${cpuResult.service.namespace}/${cpuResult.service.name})`,
    items: [{ name, cpu: '-', memory: '-' }],
    cpuNano: prometheusScalar(cpuResult.body) * 1e9,
    memoryBytes: prometheusScalar(memoryResult.body),
  });
}

async function resolveMetricPods(resourceType, namespace, name) {
  const { apps, core } = clients();
  if (resourceType === 'pods') {
    const pod = (await core.readNamespacedPod(name, namespace)).body;
    return [pod];
  }
  let selector = '';
  if (resourceType === 'deployments') selector = selectorToString((await apps.readNamespacedDeployment(name, namespace)).body.spec?.selector);
  else if (resourceType === 'statefulsets') selector = selectorToString((await apps.readNamespacedStatefulSet(name, namespace)).body.spec?.selector);
  else if (resourceType === 'daemonsets') selector = selectorToString((await apps.readNamespacedDaemonSet(name, namespace)).body.spec?.selector);
  else if (resourceType === 'services') {
    const service = (await core.readNamespacedService(name, namespace)).body;
    selector = Object.entries(service.spec?.selector || {}).map(([key, value]) => `${key}=${value}`).join(',');
  } else throw new Error(`Metrics are not supported for ${resourceType}`);
  if (!selector) throw new Error(`No pod selector found for ${resourceType}/${name}`);
  const pods = await core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, selector);
  return pods.body.items.filter(pod => !['Succeeded', 'Failed'].includes(pod.status?.phase));
}

async function resolveLogPods(resourceType, namespace, name) {
  const { apps, core } = clients();
  let workload;
  if (!resourceType || resourceType === 'pods') {
    const podRes = await core.readNamespacedPod(name, namespace);
    return [{ name, containers: podRes.body.spec?.containers?.map(c => c.name) || [] }];
  }
  if (resourceType === 'deployments') {
    workload = (await apps.readNamespacedDeployment(name, namespace)).body;
  } else if (resourceType === 'statefulsets') {
    workload = (await apps.readNamespacedStatefulSet(name, namespace)).body;
  } else if (resourceType === 'daemonsets') {
    workload = (await apps.readNamespacedDaemonSet(name, namespace)).body;
  } else {
    throw new Error(`Unsupported log resource type: ${resourceType}`);
  }

  const labelSelector = selectorToString(workload.spec?.selector);
  if (!labelSelector) throw new Error(`No pod selector found for ${resourceType}/${name}`);
  const pods = await core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSelector);
  return pods.body.items
    .filter(pod => pod.status?.phase !== 'Succeeded' && pod.status?.phase !== 'Failed')
    .map(pod => ({
      name: pod.metadata.name,
      containers: pod.spec?.containers?.map(c => c.name) || [],
    }));
}

// ─── Contexts & Namespaces ────────────────────────────────────────────────────

app.get('/api/contexts', (_req, res) => {
  try {
    // Use the already-loaded global kc (includes default + merged extra)
    const contexts = currentKc.getContexts().map(c => ({
      name:      c.name,
      cluster:   c.cluster,
      user:      c.user,
      namespace: c.namespace || 'default',
      isCurrent: c.name === currentContext,
    }));
    res.json({ contexts, current: currentContext });
  } catch (err) { handleError(res, err); }
});

app.post('/api/contexts/switch', (req, res) => {
  try {
    const { context } = req.body;
    if (!context) return res.status(400).json({ error: 'context required' });
    loadKubeConfig(context);
    auditLog.log({
      category: 'kubernetes', action: 'Context switched',
      resource: context, context,
    });
    res.json({ success: true, current: currentContext });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/contexts/:name', (req, res) => {
  try {
    const { name } = req.params;
    // Only allow deleting from the merged (imported) kubeconfig, not system ones
    if (!fs.existsSync(MERGED_KUBECONFIG))
      return res.status(404).json({ error: 'No imported contexts found' });
    let merged;
    try { merged = yaml.load(fs.readFileSync(MERGED_KUBECONFIG, 'utf8')); }
    catch (e) { return res.status(500).json({ error: 'Could not read merged kubeconfig' }); }
    const ctxIdx = merged.contexts?.findIndex(c => c.name === name);
    if (ctxIdx === -1 || ctxIdx === undefined)
      return res.status(404).json({ error: `Context "${name}" not found in imported configs` });
    const ctx         = merged.contexts[ctxIdx];
    const clusterName = ctx.context?.cluster;
    const userName    = ctx.context?.user;
    // Remove context, and its cluster/user if not referenced by other contexts
    merged.contexts.splice(ctxIdx, 1);
    const stillUsesCluster = merged.contexts.some(c => c.context?.cluster === clusterName);
    const stillUsesUser    = merged.contexts.some(c => c.context?.user    === userName);
    if (!stillUsesCluster) merged.clusters = merged.clusters.filter(c => c.name !== clusterName);
    if (!stillUsesUser)    merged.users    = merged.users.filter(u => u.name !== userName);
    fs.writeFileSync(MERGED_KUBECONFIG, yaml.dump(merged), { mode: 0o600 });
    // Reload — if deleted context was active, fallback to first available
    const next = name === currentContext ? null : currentContext;
    loadKubeConfig(next);
    auditLog.log({
      category: 'kubernetes', action: 'Context deleted',
      resource: name, level: 'warning',
    });
    res.json({ success: true, removed: name, current: currentContext });
  } catch (err) { handleError(res, err); }
});

app.get('/api/namespaces', async (_req, res) => {
  try {
    const { core } = clients();
    const result   = await core.listNamespace();
    res.json(result.body.items.map(ns => ({
      name:   ns.metadata.name,
      status: ns.status.phase,
      age:    ns.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/namespaces/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const result = await core.readNamespace(req.params.name);
    yamlResponse(res, result);
  } catch (err) { handleError(res, err); }
});

// ─── Pods ─────────────────────────────────────────────────────────────────────

app.get('/api/:namespace/pods', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listPodForAllNamespaces()
      : await core.listNamespacedPod(namespace);

    res.json(result.body.items.map(pod => {
      const rawPorts = containerPorts(pod.spec.containers);
      return {
      name:       pod.metadata.name,
      namespace:  pod.metadata.namespace,
      status:     pod.status.phase || 'Unknown',
      ready:      `${pod.status.containerStatuses?.filter(c => c.ready).length ?? 0}/${pod.status.containerStatuses?.length ?? 0}`,
      restarts:   pod.status.containerStatuses?.reduce((s, c) => s + c.restartCount, 0) ?? 0,
      age:        pod.metadata.creationTimestamp,
      nodeName:   pod.spec.nodeName || '-',
      containers: pod.spec.containers.map(c => c.name),
      envCount:   containerEnvCount(pod.spec.containers),
      rawPorts,
      ports:      portsDisplay(rawPorts),
    };
    }));
  } catch (err) { handleError(res, err); }
});

function containerEnvCount(containers = []) {
  return (containers || []).reduce((sum, container) => sum + (container.env?.length || 0), 0);
}

function containerPorts(containers = []) {
  return (containers || []).flatMap(container => (container.ports || []).map(port => ({
    name: port.name || '',
    port: port.containerPort,
    targetPort: port.containerPort,
    protocol: port.protocol || 'TCP',
    container: container.name,
  })));
}

function portsDisplay(ports = []) {
  return ports.length ? ports.map(port => `${port.name ? `${port.name}:` : ''}${port.port}/${port.protocol || 'TCP'}`).join(', ') : '-';
}

app.get('/api/:namespace/pods/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedPod(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/pods/:name/metrics', async (req, res) => {
  const { namespace, name } = req.params;
  try {
    const { custom } = clients();
    const result = await custom.getNamespacedCustomObject('metrics.k8s.io', 'v1beta1', namespace, 'pods', name);
    const body = result.body || result || {};
    const containers = body.containers || [];
    const { cpuNano, memoryBytes } = metricTotalsFromContainers(containers);
    res.json(metricPayload({
      timestamp: body.timestamp,
      window: body.window,
      containers: containers.map(c => ({ name: c.name, cpu: c.usage?.cpu, memory: c.usage?.memory })),
      cpuNano,
      memoryBytes,
    }));
  } catch (err) {
    if (isMetricsApiUnavailable(err)) {
      try {
        const { core } = clients();
        const pod = (await core.readNamespacedPod(name, namespace)).body;
        return res.json(await prometheusMetricsForPods(namespace, [pod]));
      } catch (promErr) {
        return res.status(503).json({ error: `Metrics API unavailable and Prometheus query failed: ${promErr.message}` });
      }
    }
    if (metricsUnavailable(res, err)) return;
    handleError(res, err);
  }
});

app.get('/api/:namespace/:resourceType/:name/metrics', async (req, res) => {
  const { namespace, resourceType, name } = req.params;
  let pods = [];
  try {
    const { custom } = clients();
    pods = await resolveMetricPods(resourceType, namespace, name);
    const podNames = new Set(pods.map(pod => pod.metadata.name));
    const metricsResult = await custom.listNamespacedCustomObject('metrics.k8s.io', 'v1beta1', namespace, 'pods');
    const metricItems = (metricsResult.body?.items || metricsResult.items || []).filter(item => podNames.has(item.metadata?.name));
    const containers = metricItems.flatMap(item => (item.containers || []).map(c => ({ pod: item.metadata?.name, name: c.name, cpu: c.usage?.cpu, memory: c.usage?.memory })));
    const { cpuNano, memoryBytes } = metricTotalsFromContainers(containers.map(c => ({ usage: { cpu: c.cpu, memory: c.memory } })));
    res.json(metricPayload({
      timestamp: metricItems[0]?.timestamp,
      window: metricItems[0]?.window,
      containers,
      items: metricItems.map(item => {
        const totals = metricTotalsFromContainers(item.containers || []);
        return { name: item.metadata?.name, cpu: formatCpu(totals.cpuNano), memory: formatBytes(totals.memoryBytes) };
      }),
      cpuNano,
      memoryBytes,
      cpuCapacityNano: Math.max(1e9, pods.length * 1e9),
      memoryCapacityBytes: Math.max(512 * 1024 * 1024, pods.length * 512 * 1024 * 1024),
    }));
  } catch (err) {
    if (isMetricsApiUnavailable(err)) {
      try {
        if (!pods.length) pods = await resolveMetricPods(resourceType, namespace, name);
        return res.json(await prometheusMetricsForPods(namespace, pods));
      } catch (promErr) {
        return res.status(503).json({ error: `Metrics API unavailable and Prometheus query failed: ${promErr.message}` });
      }
    }
    if (metricsUnavailable(res, err)) return;
    handleError(res, err);
  }
});

app.get('/api/monitoring/prometheus/status', async (_req, res) => {
  try {
    const matches = await discoverPrometheusServices();
    res.json({ available: matches.length > 0, services: matches });
  } catch (err) { handleError(res, err); }
});

function parseCpu(value = '0') {
  const raw = String(value);
  const num = parseFloat(raw);
  if (Number.isNaN(num)) return 0;
  if (raw.endsWith('n')) return num;
  if (raw.endsWith('u')) return num * 1000;
  if (raw.endsWith('m')) return num * 1e6;
  return num * 1e9;
}

function parseMemory(value = '0') {
  const raw = String(value);
  const num = parseFloat(raw);
  if (Number.isNaN(num)) return 0;
  const units = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1000, M: 1000 ** 2, G: 1000 ** 3, T: 1000 ** 4 };
  const unit = raw.replace(String(num), '');
  return num * (units[unit] || 1);
}

function formatCpu(nano) {
  if (nano < 1e6) return `${Math.round(nano / 1000)}u`;
  if (nano < 1e9) return `${Math.round(nano / 1e6)}m`;
  return `${(nano / 1e9).toFixed(2)} cores`;
}

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

app.delete('/api/:namespace/pods/:name', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    await core.deleteNamespacedPod(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'Pod deleted',
      resource: `${namespace}/${name}`, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── Deployments ──────────────────────────────────────────────────────────────

app.get('/api/:namespace/deployments', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await apps.listDeploymentForAllNamespaces()
      : await apps.listNamespacedDeployment(namespace);

    res.json(result.body.items.map(d => {
      const containers = d.spec.template.spec.containers || [];
      const rawPorts = containerPorts(containers);
      return {
      name:      d.metadata.name,
      namespace: d.metadata.namespace,
      ready:     `${d.status.readyReplicas ?? 0}/${d.spec.replicas ?? 0}`,
      replicas:  d.spec.replicas ?? 0,
      age:       d.metadata.creationTimestamp,
      images:    containers.map(c => c.image),
      containers: containers.map(c => c.name),
      envCount:  containerEnvCount(containers),
      rawPorts,
      ports:     portsDisplay(rawPorts),
    };
    }));
  } catch (err) { handleError(res, err); }
});

app.post('/api/:namespace/deployments/:name/restart', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const patch = { spec: { template: { metadata: {
      annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() }
    }}}};
    await apps.patchNamespacedDeployment(name, namespace, patch,
      undefined, undefined, undefined, undefined, PATCH_HEADERS);
    auditLog.log({
      category: 'kubernetes', action: 'Deployment restarted',
      resource: `${namespace}/${name}`, context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.post('/api/:namespace/deployments/:name/scale', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const replicas = parseInt(req.body.replicas, 10);
    if (isNaN(replicas) || replicas < 0) return res.status(400).json({ error: 'Invalid replicas' });
    await apps.patchNamespacedDeployment(name, namespace, { spec: { replicas } },
      undefined, undefined, undefined, undefined, PATCH_HEADERS);
    auditLog.log({
      category: 'kubernetes', action: 'Deployment scaled',
      resource: `${namespace}/${name}`, details: { replicas },
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.put('/api/:namespace/deployments/:name/env', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const containers = Array.isArray(req.body?.containers) ? req.body.containers : [];
    if (!containers.length) return res.status(400).json({ error: 'containers required' });

    const current = (await apps.readNamespacedDeployment(name, namespace)).body;
    const templateContainers = current.spec?.template?.spec?.containers || [];
    const operations = [];

    containers.forEach(containerPatch => {
      const containerName = String(containerPatch.name || '').trim();
      if (!containerName) throw new Error('container name required');
      const index = templateContainers.findIndex(container => container.name === containerName);
      if (index === -1) throw new Error(`Container not found: ${containerName}`);

      const env = Array.isArray(containerPatch.env) ? containerPatch.env.map(item => {
        const envName = String(item.name || '').trim();
        if (!envName) throw new Error(`Invalid env name in ${containerName}`);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) throw new Error(`Invalid env name: ${envName}`);
        if (item.valueFrom && typeof item.valueFrom === 'object') return { name: envName, valueFrom: item.valueFrom };
        return { name: envName, value: String(item.value ?? '') };
      }) : [];

      operations.push({
        op: templateContainers[index].env ? 'replace' : 'add',
        path: `/spec/template/spec/containers/${index}/env`,
        value: env,
      });
    });

    await apps.patchNamespacedDeployment(name, namespace, operations,
      undefined, undefined, undefined, undefined, JSON_PATCH_HEADERS);
    auditLog.log({
      category: 'kubernetes', action: 'Deployment environment updated',
      resource: `${namespace}/${name}`, details: { containers: containers.map(container => container.name) },
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/deployments/:name', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    await apps.deleteNamespacedDeployment(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'Deployment deleted',
      resource: `${namespace}/${name}`, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/deployments/:name/yaml', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const result = await apps.readNamespacedDeployment(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

// ─── StatefulSets ─────────────────────────────────────────────────────────────

app.get('/api/:namespace/statefulsets', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await apps.listStatefulSetForAllNamespaces()
      : await apps.listNamespacedStatefulSet(namespace);

    res.json(result.body.items.map(ss => {
      const containers = ss.spec.template.spec.containers || [];
      const rawPorts = containerPorts(containers);
      return {
      name:      ss.metadata.name,
      namespace: ss.metadata.namespace,
      ready:     `${ss.status.readyReplicas ?? 0}/${ss.spec.replicas ?? 0}`,
      replicas:  ss.spec.replicas ?? 0,
      age:       ss.metadata.creationTimestamp,
      containers: containers.map(c => c.name),
      envCount:  containerEnvCount(containers),
      rawPorts,
      ports:     portsDisplay(rawPorts),
    };
    }));
  } catch (err) { handleError(res, err); }
});

app.post('/api/:namespace/statefulsets/:name/restart', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const patch = { spec: { template: { metadata: {
      annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() }
    }}}};
    await apps.patchNamespacedStatefulSet(name, namespace, patch,
      undefined, undefined, undefined, undefined, PATCH_HEADERS);
    auditLog.log({
      category: 'kubernetes', action: 'StatefulSet restarted',
      resource: `${namespace}/${name}`, context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.post('/api/:namespace/statefulsets/:name/scale', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const replicas = parseInt(req.body.replicas, 10);
    if (isNaN(replicas) || replicas < 0) return res.status(400).json({ error: 'Invalid replicas' });
    await apps.patchNamespacedStatefulSet(name, namespace, { spec: { replicas } },
      undefined, undefined, undefined, undefined, PATCH_HEADERS);
    auditLog.log({
      category: 'kubernetes', action: 'StatefulSet scaled',
      resource: `${namespace}/${name}`, details: { replicas },
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/statefulsets/:name', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    await apps.deleteNamespacedStatefulSet(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'StatefulSet deleted',
      resource: `${namespace}/${name}`, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/statefulsets/:name/yaml', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const result = await apps.readNamespacedStatefulSet(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

// ─── DaemonSets ───────────────────────────────────────────────────────────────

app.get('/api/:namespace/daemonsets', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await apps.listDaemonSetForAllNamespaces()
      : await apps.listNamespacedDaemonSet(namespace);

    res.json(result.body.items.map(ds => {
      const containers = ds.spec.template.spec.containers || [];
      const rawPorts = containerPorts(containers);
      return {
      name:      ds.metadata.name,
      namespace: ds.metadata.namespace,
      desired:   ds.status.desiredNumberScheduled ?? 0,
      current:   ds.status.currentNumberScheduled ?? 0,
      ready:     ds.status.numberReady ?? 0,
      age:       ds.metadata.creationTimestamp,
      containers: containers.map(c => c.name),
      envCount:  containerEnvCount(containers),
      rawPorts,
      ports:     portsDisplay(rawPorts),
    };
    }));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/daemonsets/:name', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    await apps.deleteNamespacedDaemonSet(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'DaemonSet deleted',
      resource: `${namespace}/${name}`, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/daemonsets/:name/yaml', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    const result = await apps.readNamespacedDaemonSet(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/replicasets', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await apps.listReplicaSetForAllNamespaces() : await apps.listNamespacedReplicaSet(namespace);
    res.json(listItems(result).map(rs => ({
      name: rs.metadata.name,
      namespace: rs.metadata.namespace,
      desired: rs.spec?.replicas ?? 0,
      current: rs.status?.replicas ?? 0,
      ready: rs.status?.readyReplicas ?? 0,
      owner: (rs.metadata.ownerReferences || []).map(o => `${o.kind}/${o.name}`).join(', ') || '-',
      age: rs.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/replicasets/:name/yaml', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await apps.readNamespacedReplicaSet(name, namespace));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/jobs', async (req, res) => {
  try {
    const { batch } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await batch.listJobForAllNamespaces() : await batch.listNamespacedJob(namespace);
    res.json(listItems(result).map(job => ({
      name: job.metadata.name,
      namespace: job.metadata.namespace,
      completions: `${job.status?.succeeded ?? 0}/${job.spec?.completions ?? 1}`,
      active: job.status?.active ?? 0,
      failed: job.status?.failed ?? 0,
      age: job.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/jobs/:name/yaml', async (req, res) => {
  try {
    const { batch } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await batch.readNamespacedJob(name, namespace));
  } catch (err) { handleError(res, err); }
});


app.get('/api/pvs', async (_req, res) => {
  try {
    const { core } = clients();
    const result = await core.listPersistentVolume();
    res.json(listItems(result).map(pv => ({
      name: pv.metadata.name,
      status: pv.status?.phase || '-',
      capacity: pv.spec?.capacity?.storage || '-',
      storageClass: pv.spec?.storageClassName || '-',
      reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || '-',
      claim: pv.spec?.claimRef ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}` : '-',
      age: pv.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/pvs/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    yamlResponse(res, await core.readPersistentVolume(req.params.name));
  } catch (err) { handleError(res, err); }
});

app.get('/api/storageclasses', async (_req, res) => {
  try {
    const { storage } = clients();
    const result = await storage.listStorageClass();
    res.json(listItems(result).map(sc => ({ name: sc.metadata.name, provisioner: sc.provisioner || '-', reclaimPolicy: sc.reclaimPolicy || '-', volumeBindingMode: sc.volumeBindingMode || '-', age: sc.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/storageclasses/:name/yaml', async (req, res) => {
  try {
    const { storage } = clients();
    yamlResponse(res, await storage.readStorageClass(req.params.name));
  } catch (err) { handleError(res, err); }
});
app.get('/api/:namespace/cronjobs', async (req, res) => {
  try {
    const { batch } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await batch.listCronJobForAllNamespaces() : await batch.listNamespacedCronJob(namespace);
    res.json(listItems(result).map(cj => ({
      name: cj.metadata.name,
      namespace: cj.metadata.namespace,
      schedule: cj.spec?.schedule || '-',
      suspend: cj.spec?.suspend ? 'Yes' : 'No',
      active: cj.status?.active?.length || 0,
      lastSchedule: cj.status?.lastScheduleTime || '-',
      age: cj.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/cronjobs/:name/yaml', async (req, res) => {
  try {
    const { batch } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await batch.readNamespacedCronJob(name, namespace));
  } catch (err) { handleError(res, err); }
});

// ─── Services ─────────────────────────────────────────────────────────────────

app.get('/api/:namespace/services', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listServiceForAllNamespaces()
      : await core.listNamespacedService(namespace);

    res.json(result.body.items.map(svc => {
      const rawPorts = (svc.spec.ports || []).map(port => ({
        name: port.name || '',
        port: port.port,
        targetPort: port.targetPort ?? port.port,
        protocol: port.protocol || 'TCP',
        nodePort: port.nodePort,
      }));
      return {
      name:       svc.metadata.name,
      namespace:  svc.metadata.namespace,
      type:       svc.spec.type,
      clusterIP:  svc.spec.clusterIP,
      externalIP: svc.spec.externalIPs?.join(',')
                  || svc.status.loadBalancer?.ingress?.[0]?.ip
                  || svc.status.loadBalancer?.ingress?.[0]?.hostname
                  || '-',
      ports: rawPorts.map(p => `${p.port}:${p.targetPort}/${p.protocol}`).join(', ') || '-',
      rawPorts,
      age:   svc.metadata.creationTimestamp,
    };
    }));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/services/:name', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    await core.deleteNamespacedService(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'Service deleted',
      resource: `${namespace}/${name}`, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// Port-forward state: map localPort -> { server, id }
const portForwards = new Map();

async function resolveServiceForwardTarget(namespace, name, requestedPort) {
  const { core } = clients();
  const svcRes = await core.readNamespacedService(name, namespace);
  const service = svcRes.body;
  const selector = service.spec?.selector || {};
  const labelSel = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(',');
  if (!labelSel) throw new Error(`Service ${namespace}/${name} has no selector; port-forward needs a backing pod.`);

  const servicePort = (service.spec?.ports || []).find(port => Number(port.port) === requestedPort || Number(port.targetPort) === requestedPort) || service.spec?.ports?.[0];
  if (!servicePort) throw new Error(`Service ${namespace}/${name} has no ports.`);

  const podsRes = await core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSel);
  const pod = podsRes.body.items.find(item => item.status.phase === 'Running' && item.status.containerStatuses?.some(c => c.ready))
    || podsRes.body.items.find(item => item.status.phase === 'Running')
    || podsRes.body.items[0];
  if (!pod) throw new Error(`No pods found for service ${namespace}/${name}.`);

  let targetPort = servicePort.targetPort ?? servicePort.port;
  if (typeof targetPort === 'string') {
    const named = (pod.spec?.containers || []).flatMap(container => container.ports || []).find(port => port.name === targetPort);
    if (!named?.containerPort) throw new Error(`Target port "${targetPort}" was not found in pod ${pod.metadata.name}.`);
    targetPort = named.containerPort;
  }

  return { podName: pod.metadata.name, targetPort: Number(targetPort), resourceType: 'services' };
}

async function resolvePodForwardTarget(namespace, name, requestedPort) {
  const { core } = clients();
  await core.readNamespacedPod(name, namespace);
  return { podName: name, targetPort: requestedPort, resourceType: 'pods' };
}

async function startPortForward(req, res, resourceType) {
  try {
    const { namespace, name } = req.params;
    const { localPort, remotePort } = req.body;
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);
    if (!lp || !rp || lp < 1024 || lp > 65535 || rp < 1 || rp > 65535)
      return res.status(400).json({ error: 'Invalid ports (localPort 1024-65535, remotePort 1-65535)' });
    if (portForwards.has(lp))
      return res.status(409).json({ error: `Port ${lp} is already forwarded` });

    const target = resourceType === 'pods'
      ? await resolvePodForwardTarget(namespace, name, rp)
      : await resolveServiceForwardTarget(namespace, name, rp);
    const forward = new k8s.PortForward(currentKc);
    const tcpServer = net.createServer(async socket => {
      try {
        await forward.portForward(namespace, target.podName, [target.targetPort], socket, null, socket);
      } catch (e) { socket.destroy(); }
    });

    tcpServer.listen(lp, '127.0.0.1', () => {
      const id = `${resourceType}/${namespace}/${name}:${lp}->${rp}`;
      portForwards.set(lp, { server: tcpServer, id, namespace, name, localPort: lp, remotePort: rp, targetPort: target.targetPort, podName: target.podName, resourceType });
      auditLog.log({
        category: 'kubernetes', action: 'Port forward started',
        resource: `${namespace}/${name}`, details: { localPort: lp, remotePort: rp, targetPort: target.targetPort, podName: target.podName, resourceType },
        context: currentContext,
      });
      res.json({ success: true, id, localPort: lp, remotePort: rp, targetPort: target.targetPort, podName: target.podName, resourceType });
    });
    tcpServer.on('error', err => {
      portForwards.delete(lp);
      if (!res.headersSent) handleError(res, err);
    });
  } catch (err) { handleError(res, err); }
}

app.post('/api/:namespace/services/:name/portforward', async (req, res) => {
  startPortForward(req, res, 'services');
});

app.post('/api/:namespace/pods/:name/portforward', async (req, res) => {
  startPortForward(req, res, 'pods');
});

app.delete('/api/portforward/:localPort', (req, res) => {
  const lp = parseInt(req.params.localPort, 10);
  const pf = portForwards.get(lp);
  if (!pf) return res.status(404).json({ error: 'Port forward not found' });
  auditLog.log({
    category: 'kubernetes', action: 'Port forward stopped',
    resource: pf.id, details: { localPort: lp },
    context: currentContext,
  });
  pf.server.close();
  portForwards.delete(lp);
  res.json({ success: true });
});

app.get('/api/portforwards', (_req, res) => {
  const list = [];
  portForwards.forEach(v => list.push({ id: v.id, localPort: v.localPort, remotePort: v.remotePort, targetPort: v.targetPort, podName: v.podName, namespace: v.namespace, name: v.name, resourceType: v.resourceType }));
  res.json(list);
});

app.get('/api/:namespace/services/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedService(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

// ─── Ingresses ────────────────────────────────────────────────────────────────

app.get('/api/:namespace/ingresses', async (req, res) => {
  try {
    const { networking } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await networking.listIngressForAllNamespaces()
      : await networking.listNamespacedIngress(namespace);

    res.json(result.body.items.map(ing => {
      const annotations = ing.metadata.annotations || {};
      const hosts = (ing.spec.rules || []).map(rule => rule.host || '*').filter(Boolean);
      const paths = (ing.spec.rules || []).flatMap(rule =>
        (rule.http?.paths || []).map(path => `${rule.host || '*'}${path.path || '/'} -> ${path.backend?.service?.name || path.backend?.resource?.name || '-'}`)
      );
      const address = (ing.status.loadBalancer?.ingress || [])
        .map(item => item.hostname || item.ip)
        .filter(Boolean)
        .join(', ');
      const firstPath = (ing.spec.rules || []).flatMap(rule => rule.http?.paths || [])[0]?.path || '/';
      const primaryHost = hosts.find(host => host && host !== '*') || address.split(', ')[0] || '';
      const tlsHosts = new Set((ing.spec.tls || []).flatMap(tls => tls.hosts || []));
      const scheme = ing.spec.tls?.length && (!primaryHost || tlsHosts.has(primaryHost) || !tlsHosts.size) ? 'https' : 'http';
      const normalizedPath = firstPath.startsWith('/') ? firstPath : `/${firstPath}`;
      const url = primaryHost ? `${scheme}://${primaryHost}${normalizedPath === '/' ? '' : normalizedPath}` : '';
      return {
        name:      ing.metadata.name,
        namespace: ing.metadata.namespace,
        class:     ing.spec.ingressClassName || annotations['kubernetes.io/ingress.class'] || '-',
        hosts:     hosts.join(', ') || '-',
        paths:     paths.join(', ') || '-',
        address:   address || '-',
        url:       url || '-',
        tls:       ing.spec.tls ? 'Yes' : 'No',
        age:       ing.metadata.creationTimestamp,
      };
    }));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/ingresses/:name', async (req, res) => {
  try {
    const { networking } = clients();
    const { namespace, name } = req.params;
    await networking.deleteNamespacedIngress(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'Ingress deleted',
      resource: `${namespace}/${name}`, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/ingresses/:name/yaml', async (req, res) => {
  try {
    const { networking } = clients();
    const { namespace, name } = req.params;
    const result = await networking.readNamespacedIngress(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/endpoints', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await core.listEndpointsForAllNamespaces() : await core.listNamespacedEndpoints(namespace);
    res.json(listItems(result).map(ep => ({
      name: ep.metadata.name,
      namespace: ep.metadata.namespace,
      endpoints: (ep.subsets || []).reduce((sum, subset) => sum + (subset.addresses?.length || 0), 0),
      ports: (ep.subsets || []).flatMap(subset => subset.ports || []).map(port => `${port.port}/${port.protocol || 'TCP'}`).join(', ') || '-',
      age: ep.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/endpoints/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await core.readNamespacedEndpoints(name, namespace));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/endpointslices', async (req, res) => {
  try {
    const { discovery } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await discovery.listEndpointSliceForAllNamespaces() : await discovery.listNamespacedEndpointSlice(namespace);
    res.json(listItems(result).map(slice => ({
      name: slice.metadata.name,
      namespace: slice.metadata.namespace,
      addressType: slice.addressType || '-',
      endpoints: slice.endpoints?.length || 0,
      ports: (slice.ports || []).map(port => `${port.name || port.port || '-'}:${port.port || '-'}${port.protocol ? `/${port.protocol}` : ''}`).join(', ') || '-',
      age: slice.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/endpointslices/:name/yaml', async (req, res) => {
  try {
    const { discovery } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await discovery.readNamespacedEndpointSlice(name, namespace));
  } catch (err) { handleError(res, err); }
});

app.get('/api/ingressclasses', async (_req, res) => {
  try {
    const { networking } = clients();
    const result = await networking.listIngressClass();
    res.json(listItems(result).map(item => ({ name: item.metadata.name, controller: item.spec?.controller || '-', parameters: item.spec?.parameters?.name || '-', age: item.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/ingressclasses/:name/yaml', async (req, res) => {
  try {
    const { networking } = clients();
    yamlResponse(res, await networking.readIngressClass(req.params.name));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/networkpolicies', async (req, res) => {
  try {
    const { networking } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await networking.listNetworkPolicyForAllNamespaces() : await networking.listNamespacedNetworkPolicy(namespace);
    res.json(listItems(result).map(np => ({
      name: np.metadata.name,
      namespace: np.metadata.namespace,
      podSelector: selectorText(np.spec?.podSelector),
      types: (np.spec?.policyTypes || []).join(', ') || '-',
      ingress: np.spec?.ingress?.length || 0,
      egress: np.spec?.egress?.length || 0,
      age: np.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/networkpolicies/:name/yaml', async (req, res) => {
  try {
    const { networking } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await networking.readNamespacedNetworkPolicy(name, namespace));
  } catch (err) { handleError(res, err); }
});

// ─── ConfigMaps ───────────────────────────────────────────────────────────────

app.get('/api/:namespace/configmaps', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listConfigMapForAllNamespaces()
      : await core.listNamespacedConfigMap(namespace);

    res.json(result.body.items.map(cm => ({
      name:      cm.metadata.name,
      namespace: cm.metadata.namespace,
      keys:      Object.keys(cm.data || {}).length,
      age:       cm.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/configmaps/:name', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    await core.deleteNamespacedConfigMap(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'ConfigMap deleted',
      resource: `${namespace}/${name}`, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/configmaps/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedConfigMap(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/configmaps/:name/data', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedConfigMap(name, namespace);
    res.json({ data: result.body.data || {}, binaryKeys: Object.keys(result.body.binaryData || {}) });
  } catch (err) { handleError(res, err); }
});

app.put('/api/:namespace/configmaps/:name/data', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const data = normalizeTextData(req.body?.data);
    const current = (await core.readNamespacedConfigMap(name, namespace)).body;
    current.data = data;
    await core.replaceNamespacedConfigMap(name, namespace, current);
    auditLog.log({
      category: 'kubernetes', action: 'ConfigMap data updated',
      resource: `${namespace}/${name}`, details: { keys: Object.keys(data) },
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── Secrets ──────────────────────────────────────────────────────────────────

app.get('/api/:namespace/secrets', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listSecretForAllNamespaces()
      : await core.listNamespacedSecret(namespace);

    res.json(result.body.items.map(s => ({
      name:      s.metadata.name,
      namespace: s.metadata.namespace,
      type:      s.type,
      keys:      Object.keys(s.data || {}).length,
      age:       s.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/secrets/:name', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    await core.deleteNamespacedSecret(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'Secret deleted',
      resource: `${namespace}/${name}`, level: 'critical',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/secrets/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedSecret(name, namespace);
    if (result.body.data) {
      Object.keys(result.body.data).forEach(k => { result.body.data[k] = '[REDACTED]'; });
    }
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/secrets/:name/data', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedSecret(name, namespace);
    const data = {};
    Object.entries(result.body.data || {}).forEach(([key, value]) => {
      data[key] = Buffer.from(String(value || ''), 'base64').toString('utf8');
    });
    res.json({ type: result.body.type, immutable: !!result.body.immutable, data });
  } catch (err) { handleError(res, err); }
});

app.put('/api/:namespace/secrets/:name/data', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const plainData = normalizeTextData(req.body?.data);
    const data = Object.fromEntries(Object.entries(plainData).map(([key, value]) => [key, Buffer.from(value, 'utf8').toString('base64')]));
    const current = (await core.readNamespacedSecret(name, namespace)).body;
    current.data = data;
    await core.replaceNamespacedSecret(name, namespace, current);
    auditLog.log({
      category: 'kubernetes', action: 'Secret data updated',
      resource: `${namespace}/${name}`, details: { keys: Object.keys(data) }, level: 'warning',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

function normalizeTextData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data object required');
  const normalized = {};
  Object.entries(data).forEach(([key, value]) => {
    const name = String(key || '').trim();
    if (!name) throw new Error('data keys cannot be empty');
    normalized[name] = String(value ?? '');
  });
  return normalized;
}

app.get('/api/:namespace/resourcequotas', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await core.listResourceQuotaForAllNamespaces() : await core.listNamespacedResourceQuota(namespace);
    res.json(listItems(result).map(rq => ({ name: rq.metadata.name, namespace: rq.metadata.namespace, hard: summarizeObject(rq.status?.hard), used: summarizeObject(rq.status?.used), age: rq.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/resourcequotas/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await core.readNamespacedResourceQuota(name, namespace));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/limitranges', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await core.listLimitRangeForAllNamespaces() : await core.listNamespacedLimitRange(namespace);
    res.json(listItems(result).map(lr => ({ name: lr.metadata.name, namespace: lr.metadata.namespace, types: (lr.spec?.limits || []).map(item => item.type).join(', ') || '-', items: lr.spec?.limits?.length || 0, age: lr.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/limitranges/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await core.readNamespacedLimitRange(name, namespace));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/hpas', async (req, res) => {
  try {
    const { autoscaling } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await autoscaling.listHorizontalPodAutoscalerForAllNamespaces() : await autoscaling.listNamespacedHorizontalPodAutoscaler(namespace);
    res.json(listItems(result).map(hpa => ({
      name: hpa.metadata.name,
      namespace: hpa.metadata.namespace,
      target: `${hpa.spec?.scaleTargetRef?.kind || '-'}/${hpa.spec?.scaleTargetRef?.name || '-'}`,
      min: hpa.spec?.minReplicas ?? '-',
      max: hpa.spec?.maxReplicas ?? '-',
      current: hpa.status?.currentReplicas ?? 0,
      age: hpa.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/hpas/:name/yaml', async (req, res) => {
  try {
    const { autoscaling } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await autoscaling.readNamespacedHorizontalPodAutoscaler(name, namespace));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/pdbs', async (req, res) => {
  try {
    const { policy } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await policy.listPodDisruptionBudgetForAllNamespaces() : await policy.listNamespacedPodDisruptionBudget(namespace);
    res.json(listItems(result).map(pdb => ({ name: pdb.metadata.name, namespace: pdb.metadata.namespace, minAvailable: pdb.spec?.minAvailable ?? '-', maxUnavailable: pdb.spec?.maxUnavailable ?? '-', allowed: pdb.status?.disruptionsAllowed ?? 0, age: pdb.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/pdbs/:name/yaml', async (req, res) => {
  try {
    const { policy } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await policy.readNamespacedPodDisruptionBudget(name, namespace));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/leases', async (req, res) => {
  try {
    const { coordination } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all' ? await coordination.listLeaseForAllNamespaces() : await coordination.listNamespacedLease(namespace);
    res.json(listItems(result).map(lease => ({ name: lease.metadata.name, namespace: lease.metadata.namespace, holder: lease.spec?.holderIdentity || '-', renewTime: lease.spec?.renewTime || '-', age: lease.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/leases/:name/yaml', async (req, res) => {
  try {
    const { coordination } = clients();
    const { namespace, name } = req.params;
    yamlResponse(res, await coordination.readNamespacedLease(name, namespace));
  } catch (err) { handleError(res, err); }
});

// ─── PersistentVolumeClaims ───────────────────────────────────────────────────

app.get('/api/:namespace/pvcs', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listPersistentVolumeClaimForAllNamespaces()
      : await core.listNamespacedPersistentVolumeClaim(namespace);

    res.json(result.body.items.map(pvc => ({
      name:         pvc.metadata.name,
      namespace:    pvc.metadata.namespace,
      status:       pvc.status.phase || 'Unknown',
      storageClass: pvc.spec.storageClassName || '-',
      capacity:     pvc.status.capacity?.storage || '-',
      accessModes:  pvc.spec.accessModes?.join(', ') || '-',
      age:          pvc.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/pvcs/:name', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    await core.deleteNamespacedPersistentVolumeClaim(name, namespace);
    auditLog.log({
      category: 'kubernetes', action: 'PVC deleted',
      resource: `${namespace}/${name}`, level: 'critical',
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/pvcs/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedPersistentVolumeClaim(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

// ─── Nodes ────────────────────────────────────────────────────────────────────

app.get('/api/nodes', async (_req, res) => {
  try {
    const { core } = clients();
    const result   = await core.listNode();

    res.json(result.body.items.map(node => {
      const conds        = node.status.conditions || [];
      const ready        = conds.find(c => c.type === 'Ready')?.status === 'True';
      const unschedulable = node.spec.unschedulable || false;
      const roles        = Object.keys(node.metadata.labels || {})
        .filter(l => l.startsWith('node-role.kubernetes.io/'))
        .map(l => l.replace('node-role.kubernetes.io/', ''))
        .join(', ') || 'worker';

      return {
        name:          node.metadata.name,
        status:        ready ? 'Ready' : 'NotReady',
        unschedulable,
        roles,
        age:           node.metadata.creationTimestamp,
        version:       node.status.nodeInfo?.kubeletVersion || '-',
        os:            node.status.nodeInfo?.osImage || '-',
        cpu:           node.status.capacity?.cpu || '-',
        memory:        node.status.capacity?.memory || '-',
      };
    }));
  } catch (err) { handleError(res, err); }
});

app.get('/api/nodes/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const result   = await core.readNode(req.params.name);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

app.get('/api/nodes/:name/metrics', async (req, res) => {
  const { name } = req.params;
  try {
    const { core, custom } = clients();
    const [nodeResult, metricsResult] = await Promise.all([
      core.readNode(name),
      custom.getClusterCustomObject('metrics.k8s.io', 'v1beta1', 'nodes', name),
    ]);
    const node = nodeResult.body || nodeResult || {};
    const body = metricsResult.body || metricsResult || {};
    const cpuNano = parseCpu(body.usage?.cpu);
    const memoryBytes = parseMemory(body.usage?.memory);
    res.json(metricPayload({
      timestamp: body.timestamp,
      window: body.window,
      items: [{ name, cpu: body.usage?.cpu, memory: body.usage?.memory }],
      cpuNano,
      memoryBytes,
      cpuCapacityNano: parseCpu(node.status?.allocatable?.cpu || node.status?.capacity?.cpu || '1'),
      memoryCapacityBytes: parseMemory(node.status?.allocatable?.memory || node.status?.capacity?.memory || '512Mi'),
    }));
  } catch (err) {
    if (isMetricsApiUnavailable(err)) {
      try {
        return res.json(await prometheusMetricsForNode(name));
      } catch (promErr) {
        return res.status(503).json({ error: `Metrics API unavailable and Prometheus query failed: ${promErr.message}` });
      }
    }
    if (metricsUnavailable(res, err)) return;
    handleError(res, err);
  }
});

app.get('/api/priorityclasses', async (_req, res) => {
  try {
    const { scheduling } = clients();
    const result = await scheduling.listPriorityClass();
    res.json(listItems(result).map(pc => ({ name: pc.metadata.name, value: pc.value, globalDefault: pc.globalDefault ? 'Yes' : 'No', description: pc.description || '-', age: pc.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/priorityclasses/:name/yaml', async (req, res) => {
  try {
    const { scheduling } = clients();
    yamlResponse(res, await scheduling.readPriorityClass(req.params.name));
  } catch (err) { handleError(res, err); }
});

app.get('/api/runtimeclasses', async (_req, res) => {
  try {
    const { node } = clients();
    const result = await node.listRuntimeClass();
    res.json(listItems(result).map(rc => ({ name: rc.metadata.name, handler: rc.handler || '-', overhead: rc.overhead ? 'Yes' : 'No', scheduling: rc.scheduling ? 'Yes' : 'No', age: rc.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/runtimeclasses/:name/yaml', async (req, res) => {
  try {
    const { node } = clients();
    yamlResponse(res, await node.readRuntimeClass(req.params.name));
  } catch (err) { handleError(res, err); }
});

app.get('/api/mutatingwebhookconfigurations', async (_req, res) => {
  try {
    const { admission } = clients();
    const result = await admission.listMutatingWebhookConfiguration();
    res.json(listItems(result).map(wh => ({ name: wh.metadata.name, webhooks: wh.webhooks?.length || 0, age: wh.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/mutatingwebhookconfigurations/:name/yaml', async (req, res) => {
  try {
    const { admission } = clients();
    yamlResponse(res, await admission.readMutatingWebhookConfiguration(req.params.name));
  } catch (err) { handleError(res, err); }
});

app.get('/api/validatingwebhookconfigurations', async (_req, res) => {
  try {
    const { admission } = clients();
    const result = await admission.listValidatingWebhookConfiguration();
    res.json(listItems(result).map(wh => ({ name: wh.metadata.name, webhooks: wh.webhooks?.length || 0, age: wh.metadata.creationTimestamp })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/validatingwebhookconfigurations/:name/yaml', async (req, res) => {
  try {
    const { admission } = clients();
    yamlResponse(res, await admission.readValidatingWebhookConfiguration(req.params.name));
  } catch (err) { handleError(res, err); }
});

app.post('/api/nodes/:name/cordon', async (req, res) => {
  try {
    const { core } = clients();
    const { name } = req.params;
    const unschedulable = req.body.cordon !== false;
    await core.patchNode(name, { spec: { unschedulable } },
      undefined, undefined, undefined, undefined, PATCH_HEADERS);
    auditLog.log({
      category: 'kubernetes',
      action: unschedulable ? 'Node cordoned' : 'Node uncordoned',
      resource: name, level: 'warning', context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.post('/api/nodes/:name/drain', async (req, res) => {
  try {
    const { core } = clients();
    const { name } = req.params;

    // 1. Cordon
    await core.patchNode(name, { spec: { unschedulable: true } },
      undefined, undefined, undefined, undefined, PATCH_HEADERS);

    // 2. List all non-DaemonSet, non-mirror pods on the node
    const podsRes = await core.listPodForAllNamespaces(
      undefined, undefined, undefined, `spec.nodeName=${name}`
    );
    const pods = podsRes.body.items.filter(pod => {
      const owners = pod.metadata.ownerReferences || [];
      return !owners.some(o => o.kind === 'DaemonSet')
          && !pod.metadata.annotations?.['kubernetes.io/config.mirror'];
    });

    // 3. Evict them
    const results = await Promise.allSettled(
      pods.map(pod => core.createNamespacedPodEviction(
        pod.metadata.name,
        pod.metadata.namespace,
        {
          apiVersion: 'policy/v1',
          kind:       'Eviction',
          metadata:   { name: pod.metadata.name, namespace: pod.metadata.namespace },
        }
      ))
    );

    const evicted  = results.filter(r => r.status === 'fulfilled').length;
    const failed   = results.filter(r => r.status === 'rejected').length;
    auditLog.log({
      category: 'kubernetes', action: 'Node drained',
      resource: name, details: { evicted, failed },
      level: 'critical', context: currentContext,
    });
    res.json({ success: true, evicted, failed });
  } catch (err) { handleError(res, err); }
});

// ─── Events ───────────────────────────────────────────────────────────────────

app.get('/api/events/related', async (req, res) => {
  try {
    const { core } = clients();
    const kind = String(req.query.kind || '').toLowerCase();
    const name = String(req.query.name || '');
    const namespace = String(req.query.namespace || '');
    if (!kind || !name) return res.status(400).json({ error: 'kind and name are required' });
    const result = namespace
      ? await core.listNamespacedEvent(namespace)
      : await core.listEventForAllNamespaces();
    const events = listItems(result)
      .map(normalizeEvent)
      .filter(evt => evt.objectKind.toLowerCase() === kind && evt.objectName === name)
      .sort((a, b) => new Date(b.lastTimestamp || 0) - new Date(a.lastTimestamp || 0));
    const warnings = events.filter(evt => String(evt.type).toLowerCase() === 'warning').length;
    res.json({ total: events.length, warnings, events });
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/events', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listEventForAllNamespaces()
      : await core.listNamespacedEvent(namespace);

    res.json(result.body.items.map(normalizeEvent));
  } catch (err) { handleError(res, err); }
});

// ─── Apply YAML ───────────────────────────────────────────────────────────────

app.put('/api/apply', async (req, res) => {
  try {
    const { yamlContent } = req.body;
    if (!yamlContent) return res.status(400).json({ error: 'yamlContent required' });

    let obj;
    try {
      obj = yaml.load(yamlContent);
    } catch (err) {
      const mark = err.mark ? `line ${err.mark.line + 1}, column ${err.mark.column + 1}: ` : '';
      return res.status(400).json({ error: `YAML validation error: ${mark}${err.reason || err.message}` });
    }
    if (!obj || typeof obj !== 'object') return res.status(400).json({ error: 'YAML must contain a Kubernetes object' });
    const kind      = obj.kind;
    const ns        = obj.metadata?.namespace || 'default';
    const name      = obj.metadata?.name;
    if (!kind) return res.status(400).json({ error: 'YAML validation error: missing kind' });
    if (!name) return res.status(400).json({ error: 'YAML validation error: missing metadata.name' });
    const { core, apps, networking } = clients();

    const handlers = {
      Deployment:             () => apps.patchNamespacedDeployment(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
      StatefulSet:            () => apps.patchNamespacedStatefulSet(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
      DaemonSet:              () => apps.patchNamespacedDaemonSet(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
      Service:                () => core.patchNamespacedService(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
      ConfigMap:              () => core.patchNamespacedConfigMap(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
      Secret:                 () => core.patchNamespacedSecret(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
      Ingress:                () => networking.patchNamespacedIngress(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
      PersistentVolumeClaim:  () => core.patchNamespacedPersistentVolumeClaim(name, ns, obj, undefined, undefined, undefined, undefined, PATCH_HEADERS),
    };

    if (!handlers[kind]) return res.status(400).json({ error: `Unsupported kind: ${kind}` });
    await handlers[kind]();
    auditLog.log({
      category: 'kubernetes', action: 'YAML applied',
      resource: `${kind}/${ns}/${name}`, details: { kind, namespace: ns },
      context: currentContext,
    });
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── WebSocket – Log streaming ────────────────────────────────────────────────

wss.on('connection', ws => {
  let currentStreams = [];
  let currentReqs    = [];

  function stopStream() {
    currentReqs.forEach(req => {
      try {
        if (typeof req.abort    === 'function') req.abort();
        if (typeof req.destroy  === 'function') req.destroy();
      } catch (_) {}
    });
    currentStreams.forEach(s => { try { s.destroy(); } catch (_) {} });
    currentReqs = [];
    currentStreams = [];
  }

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    if (msg.action === 'stop') { stopStream(); return; }

    if (msg.action === 'start') {
      stopStream();
      const { namespace, pod, resourceType = 'pods', container, previous, tailLines = 200 } = msg;

      try {
        const { log } = clients();
        const pods = await resolveLogPods(resourceType, namespace, pod);
        const selectedPods = pods.filter(p => !container || p.containers.includes(container));
        if (!selectedPods.length) {
          throw new Error(`No pods found for ${resourceType}/${pod}${container ? ` with container ${container}` : ''}`);
        }
        for (const targetPod of selectedPods) {
          const logStream = new stream.PassThrough();
          currentStreams.push(logStream);
          logStream.on('data', chunk => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: 'log', pod: targetPod.name, data: chunk.toString('utf-8') }));
          });

          const req = await log.log(
            namespace, targetPod.name, container || null, logStream,
            err => {
              if (err && ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'error', data: `${targetPod.name}: ${err.message}` }));
            },
            { follow: true, tailLines, previous: !!previous }
          );
          currentReqs.push(req);
        }
      } catch (err) {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'error', data: err.message }));
      }
    }
  });

  ws.on('close', stopStream);
});

// ─── WebSocket – Exec (interactive shell) ────────────────────────────────────

wssExec.on('connection', ws => {
  let stdin  = null;
  let execWs = null;

  function stopExec() {
    if (stdin)  { try { stdin.destroy();  } catch (_) {} stdin  = null; }
    if (execWs) { try { execWs.close();   } catch (_) {} execWs = null; }
  }

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    if (msg.action === 'stop') { stopExec(); return; }

    // Send stdin data to running shell
    if (msg.action === 'stdin') {
      if (stdin && !stdin.destroyed) stdin.push(msg.data);
      return;
    }

    if (msg.action === 'start') {
      stopExec();
      const { namespace, pod, container } = msg;
      try {
        const exec   = new k8s.Exec(currentKc);
        const stdout = new stream.PassThrough();
        const stderr = new stream.PassThrough();
        stdin = new stream.PassThrough();

        stdout.on('data', chunk => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'out', data: chunk.toString('utf-8') }));
        });
        stderr.on('data', chunk => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'err', data: chunk.toString('utf-8') }));
        });

        // tty: false — pipe mode, no TTY. Avoids immediate shell exit caused by
        // missing terminal resize when tty:true is used without a real PTY.
        execWs = await exec.exec(
          namespace, pod, container || null, ['/bin/sh'],
          stdout, stderr, stdin, false,
          status => {
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: 'done', code: status?.status === 'Success' ? 0 : 1 }));
          }
        );

        execWs.on('error', err => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'error', data: err.message }));
        });
        execWs.on('close', () => {
          stdin = null; execWs = null;
        });

        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'connected', pod, container }));
      } catch (err) {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'error', data: err.message }));
      }
    }
  });

  ws.on('close', stopExec);
});

// ─── WebSocket – Local Shell ──────────────────────────────────────────────────
// Spawns a local shell process (PowerShell on Windows, $SHELL on Unix).
// Security: only accepts connections from localhost.
// Protocol (same JSON envelope as exec WS):
//   client → server:  { action: 'stdin', data: string }
//                     { action: 'stop' }
//                     { action: 'resize', cols: n, rows: n }  (future node-pty)
//   server → client:  { type: 'connected', shell, cwd }
//                     { type: 'out',  data: string }
//                     { type: 'err',  data: string }
//                     { type: 'done', code: number }
//                     { type: 'error', data: string }

const { spawn } = require('child_process');

/** Strip ANSI/VT escape codes from shell output before sending to client */
function stripAnsi(text) {
  return text
    .replace(/\x1b\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '') // CSI sequences (colors, cursor, DEC private e.g. ?2004h)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')            // OSC sequences (title, etc.)
    .replace(/\x1b[()][A-B0-9]/g, '')                            // charset sequences
    .replace(/\x1b[@-_]/g, '')                                   // 2-byte ESC sequences
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');              // other ctrl chars except \n \r \t
}

wssShell.on('connection', (ws, req) => {
  // Only allow localhost connections
  const remote = req.socket.remoteAddress;
  const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLocal) {
    ws.close(1008, 'Local connections only');
    return;
  }

  const isWin   = process.platform === 'win32';
  const shell   = isWin ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
  const args    = isWin ? ['-NoLogo', '-NoProfile'] : [];
  const initCwd = os.homedir();

  // Marker used to extract CWD from shell output without polluting visible output
  const CWD_MARKER = '##KUA_CWD##';
  // Probe injected after every stdin line to detect the new working directory
  const cwdProbe = isWin
    ? `\nWrite-Host "${CWD_MARKER}$($PWD.Path)${CWD_MARKER}"\n`
    : `\necho "${CWD_MARKER}$(pwd)${CWD_MARKER}"\n`;
  // Regex to match the marker line in raw output — uses lazy .*? not a broken char class
  const CWD_RE = new RegExp(`${CWD_MARKER}(.*?)${CWD_MARKER}`);

  let proc = null;
  // Buffer for assembling multi-chunk lines so we can reliably detect the marker
  let outBuf = '';

  function flushBuf(ws) {
    const lines = outBuf.split('\n');
    outBuf = lines.pop(); // keep incomplete last line in buffer
    for (const line of lines) {
      // Suppress any line that contains our marker (the Write-Host echo AND the output line)
      if (line.includes(CWD_MARKER)) {
        const m = line.match(CWD_RE);
        if (m) {
          const cwd = m[1].trim();
          // Only accept real paths — ignore the echoed command line where
          // the match would contain shell syntax like $($PWD.Path)
          const isRealPath = /^([A-Za-z]:[\\\/]|\/)/.test(cwd) && !cwd.includes('$');
          if (isRealPath && ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'cwd', path: cwd }));
        }
        // Either way: do NOT forward this line to the client
        continue;
      }
      const clean = stripAnsi(line);
      if (clean && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'out', data: clean }));
    }
  }

  function start() {
    proc = spawn(shell, args, {
      cwd:         initCwd,
      env:         { ...process.env, TERM: 'dumb' },
      shell:       false,
      windowsHide: true,
    });

    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'connected', shell, cwd: initCwd }));

    proc.stdout.on('data', chunk => {
      outBuf += chunk.toString('utf8');
      flushBuf(ws);
    });

    proc.stderr.on('data', chunk => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'err', data: stripAnsi(chunk.toString('utf8')) }));
    });

    proc.on('error', err => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'error', data: err.message }));
    });

    proc.on('close', code => {
      proc = null;
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'done', code: code ?? 0 }));
    });
  }

  start();

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    if (msg.action === 'stop') {
      if (proc && !proc.killed) proc.kill();
      return;
    }
    if (msg.action === 'restart') {
      if (proc && !proc.killed) proc.kill();
      setTimeout(start, 200);
      return;
    }
    if (msg.action === 'stdin') {
      if (proc && !proc.killed) {
        try {
          // Write the user's command, then inject the CWD probe so the
          // frontend's file browser stays in sync with the shell's directory.
          // The probe output is intercepted server-side and never shown to the user.
          const data = msg.data.endsWith('\n') ? msg.data : msg.data + '\n';
          proc.stdin.write(data + cwdProbe);
        } catch (_) {}
      }
    }
  });

  ws.on('close', () => {
    if (proc && !proc.killed) proc.kill();
  });
});

// ─── WebSocket – EC2 SSH Shell ────────────────────────────────────────────────
// Protocol (client → server):
//   First message:  { action: 'connect', host, user, keyPath, port? }
//   Then:           { action: 'stdin', data: string }
//                   { action: 'resize', cols, rows }
//                   { action: 'stop' }
// Protocol (server → client):
//   { type: 'connected', host, user }
//   { type: 'out',  data: string }
//   { type: 'err',  data: string }
//   { type: 'done', code: number }
//   { type: 'error', data: string }

wssEc2Shell.on('connection', (ws, req) => {
  const remote = req.socket.remoteAddress;
  const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLocal) {
    ws.close(1008, 'Local connections only');
    return;
  }

  let sshConn   = null;
  let sshStream = null;

  function send(obj) {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(obj));
  }

  function cleanup() {
    if (sshStream) { try { sshStream.end(); } catch (_) {} sshStream = null; }
    if (sshConn)   { try { sshConn.end();    } catch (_) {} sshConn   = null; }
  }

  ws.on('message', rawMsg => {
    let msg;
    try { msg = JSON.parse(rawMsg); } catch (_) { return; }

    if (msg.action === 'connect') {
      const { Client } = require('ssh2');
      const { host, user = 'ec2-user', keyPath, port = 22, passphrase, authMethod = 'key', password } = msg;

      if (!host) { send({ type: 'error', data: 'host is required' }); return; }

      if (authMethod === 'key') {
        if (!keyPath) { send({ type: 'error', data: 'keyPath is required for key authentication' }); return; }
      } else if (authMethod === 'password') {
        if (!password) { send({ type: 'error', data: 'password is required for password authentication' }); return; }
      } else {
        send({ type: 'error', data: 'Invalid authMethod. Use "key" or "password"' }); return;
      }

      let privateKey;
      if (authMethod === 'key') {
        try {
          privateKey = fs.readFileSync(keyPath);
        } catch (e) {
          send({ type: 'error', data: `Cannot read key file: ${e.message}` });
          return;
        }
      }

      cleanup();
      sshConn = new Client();

      sshConn.on('ready', () => {
        sshConn.shell({ term: 'dumb', cols: 220, rows: 50 }, (err, stream) => {
          if (err) {
            send({ type: 'error', data: `Shell error: ${err.message}` });
            cleanup();
            return;
          }
          sshStream = stream;
          send({ type: 'connected', host, user });

          stream.on('data', chunk => {
            send({ type: 'out', data: stripAnsi(chunk.toString('utf8')) });
          });

          stream.stderr.on('data', chunk => {
            send({ type: 'err', data: stripAnsi(chunk.toString('utf8')) });
          });

          stream.on('close', (code) => {
            send({ type: 'done', code: code ?? 0 });
            cleanup();
          });
        });
      });

      sshConn.on('error', err => {
        send({ type: 'error', data: `SSH error: ${err.message}` });
        cleanup();
      });

      sshConn.on('end', () => {
        if (sshStream) {
          send({ type: 'done', code: 0 });
          cleanup();
        }
      });

      const connectOpts = { host, port, username: user };
      if (authMethod === 'key') {
        connectOpts.privateKey = privateKey;
        if (passphrase) connectOpts.passphrase = passphrase;
      } else {
        connectOpts.password = password;
      }

      sshConn.connect(connectOpts);
      return;
    }

    if (msg.action === 'stdin' && sshStream) {
      try { sshStream.write(msg.data); } catch (_) {}
      return;
    }

    if (msg.action === 'resize' && sshStream) {
      try { sshStream.setWindow(msg.rows || 50, msg.cols || 220, 0, 0); } catch (_) {}
      return;
    }

    if (msg.action === 'stop') {
      cleanup();
      send({ type: 'done', code: 0 });
    }
  });

  ws.on('close', () => { cleanup(); });
});

// ─── WebSocket – EC2 RDP Canvas ───────────────────────────────────────────────
// Protocol (client → server):
//   { action: 'connect', host, user, password, domain?, port?, width?, height? }
//   { action: 'mouse', x, y, button, isDown }
//   { action: 'key',   code, isDown, extended? }
//   { action: 'stop' }
// Protocol (server → client):
//   { type: 'connected', width, height }
//   { type: 'bitmap', x, y, w, h, bpp, data: base64 }
//   { type: 'error',  data: string }
//   { type: 'done' }
//
// ⚠  node-rdpjs-2 does NOT support NLA (CredSSP). The Windows instance must
//    allow Classic RDP Security:
//    System Properties → Remote → "Allow connections from computers running
//    any version of Remote Desktop (less secure)"

wssEc2Rdp.on('connection', (ws, req) => {
  const remote = req.socket.remoteAddress;
  const isLocal = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLocal) { ws.close(1008, 'Local connections only'); return; }

  let rdpClient = null;

  function send(obj) {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(obj));
  }

  function cleanup() {
    if (rdpClient) {
      try { rdpClient.close(); } catch (_) {}
      rdpClient = null;
    }
  }

  ws.on('message', rawMsg => {
    let msg;
    try { msg = JSON.parse(rawMsg); } catch (_) { return; }

    // ── Connect ──────────────────────────────────────────────────────────────
    if (msg.action === 'connect') {
      const rdp = require('node-rdpjs-2');
      const {
        host, port = 3389,
        user = 'Administrator', password, domain = '',
        width = 1280, height = 800,
      } = msg;

      if (!host)     { send({ type: 'error', data: 'host is required' }); return; }
      if (!password) { send({ type: 'error', data: 'password is required' }); return; }

      cleanup();

      rdpClient = rdp.createClient({
        logLevel:         'ERROR',
        domain,
        userName:         user,
        password,
        enablePerf:       true,
        autoLogin:        true,
        screen:           { width, height },
        locale:           'en',
        enableGlyphCache: true,
      });

      rdpClient.on('connect', () => {
        send({ type: 'connected', width, height });
      });

      rdpClient.on('bitmap', bitmap => {
        // bitmap: destLeft, destTop, destRight, destBottom, width, height,
        //         bitsPerPixel, isCompress, data (Buffer, already decompressed)
        send({
          type: 'bitmap',
          x:    bitmap.destLeft,
          y:    bitmap.destTop,
          w:    bitmap.width  || (bitmap.destRight  - bitmap.destLeft + 1),
          h:    bitmap.height || (bitmap.destBottom - bitmap.destTop  + 1),
          bpp:  bitmap.bitsPerPixel,
          data: bitmap.data.toString('base64'),
        });
      });

      rdpClient.on('close', () => {
        send({ type: 'done' });
        cleanup();
      });

      rdpClient.on('error', err => {
        send({ type: 'error', data: err.message || String(err) });
        cleanup();
      });

      rdpClient.connect(host, port);
      return;
    }

    // ── Mouse ────────────────────────────────────────────────────────────────
    if (msg.action === 'mouse' && rdpClient) {
      try { rdpClient.sendPointerEvent(msg.x, msg.y, msg.button || 0, !!msg.isDown); } catch (_) {}
      return;
    }

    // ── Keyboard (scan code) ─────────────────────────────────────────────────
    if (msg.action === 'key' && rdpClient) {
      try { rdpClient.sendKeyEventScancode(msg.code, !!msg.isDown); } catch (_) {}
      return;
    }

    // ── Stop ─────────────────────────────────────────────────────────────────
    if (msg.action === 'stop') {
      cleanup();
      send({ type: 'done' });
    }
  });

  ws.on('close', () => { cleanup(); });
});

// For any GET that doesn't match an API route or static file, serve index.html
// so the Vue SPA can handle client-side routing.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 7190;
server.listen(PORT, () => {
  console.log(`\n  KuaDashboard running → http://localhost:${PORT}`);
  console.log(`  Context: ${currentContext}\n`);
});
