'use strict';

const express    = require('express');
const http       = require('http');
const net        = require('net');
const fs         = require('fs');
const os         = require('os');
const path       = require('path');
const stream     = require('stream');
const WebSocket  = require('ws');
const k8s        = require('@kubernetes/client-node');
const yaml       = require('js-yaml');

const app    = express();
const server = http.createServer(app);

// ─── Cloud integration routes ─────────────────────────────────────────────────
const envManagerRoutes  = require('./routes/envManager');
const gcpRoutes         = require('./routes/gcp');
const awsRoutes         = require('./routes/aws');
const systemToolsRoutes = require('./routes/systemTools');
const localShellRoutes  = require('./routes/localShell');
// Use noServer + manual upgrade routing to avoid the ws multi-server path conflict
// where the first WebSocket.Server's upgrade listener destroys sockets meant for the second.
const wss        = new WebSocket.Server({ noServer: true });
const wssExec    = new WebSocket.Server({ noServer: true });
const wssShell   = new WebSocket.Server({ noServer: true });
const wssEc2Shell = new WebSocket.Server({ noServer: true });

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
  } else {
    socket.destroy();
  }
});

app.use(express.json({ limit: '2mb' }));

// ─── Mount cloud routes ───────────────────────────────────────────────────────
app.use('/api/cloud/envs', envManagerRoutes);
app.use('/api/cloud/gcp',  gcpRoutes);
app.use('/api/cloud/aws',  awsRoutes);
app.use('/api/system',     systemToolsRoutes);
app.use('/api/local',      localShellRoutes);

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
  return files;
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

    // Parse
    let parsed;
    try { parsed = yaml.load(yamlContent); }
    catch (e) { return res.status(400).json({ error: `YAML parse error: ${e.message}` }); }

    // Validate structure
    const validErr = validateKubeconfig(parsed);
    if (validErr) return res.status(400).json({ error: validErr });

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

    res.json({ success: true, added: addedContexts.length, contexts: addedContexts });
  } catch (err) { handleError(res, err); }
});

function clients() {
  return {
    core:       currentKc.makeApiClient(k8s.CoreV1Api),
    apps:       currentKc.makeApiClient(k8s.AppsV1Api),
    networking: currentKc.makeApiClient(k8s.NetworkingV1Api),
    batch:      currentKc.makeApiClient(k8s.BatchV1Api),
    log:        new k8s.Log(currentKc),
  };
}

// ─── Error helper ─────────────────────────────────────────────────────────────

function handleError(res, err) {
  const status  = err.statusCode || err.response?.statusCode || 500;
  const message = err.body?.message || err.message || 'Internal server error';
  console.error('[ERROR]', status, message);
  res.status(status).json({ error: message });
}

const PATCH_HEADERS = { headers: { 'Content-Type': 'application/strategic-merge-patch+json' } };

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

// ─── Pods ─────────────────────────────────────────────────────────────────────

app.get('/api/:namespace/pods', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listPodForAllNamespaces()
      : await core.listNamespacedPod(namespace);

    res.json(result.body.items.map(pod => ({
      name:       pod.metadata.name,
      namespace:  pod.metadata.namespace,
      status:     pod.status.phase || 'Unknown',
      ready:      `${pod.status.containerStatuses?.filter(c => c.ready).length ?? 0}/${pod.status.containerStatuses?.length ?? 0}`,
      restarts:   pod.status.containerStatuses?.reduce((s, c) => s + c.restartCount, 0) ?? 0,
      age:        pod.metadata.creationTimestamp,
      nodeName:   pod.spec.nodeName || '-',
      containers: pod.spec.containers.map(c => c.name),
    })));
  } catch (err) { handleError(res, err); }
});

app.get('/api/:namespace/pods/:name/yaml', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    const result = await core.readNamespacedPod(name, namespace);
    res.type('text/plain').send(yaml.dump(result.body));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/pods/:name', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    await core.deleteNamespacedPod(name, namespace);
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

    res.json(result.body.items.map(d => ({
      name:      d.metadata.name,
      namespace: d.metadata.namespace,
      ready:     `${d.status.readyReplicas ?? 0}/${d.spec.replicas ?? 0}`,
      replicas:  d.spec.replicas ?? 0,
      age:       d.metadata.creationTimestamp,
      images:    d.spec.template.spec.containers.map(c => c.image),
    })));
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
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/deployments/:name', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    await apps.deleteNamespacedDeployment(name, namespace);
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

    res.json(result.body.items.map(ss => ({
      name:      ss.metadata.name,
      namespace: ss.metadata.namespace,
      ready:     `${ss.status.readyReplicas ?? 0}/${ss.spec.replicas ?? 0}`,
      replicas:  ss.spec.replicas ?? 0,
      age:       ss.metadata.creationTimestamp,
    })));
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
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/statefulsets/:name', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    await apps.deleteNamespacedStatefulSet(name, namespace);
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

    res.json(result.body.items.map(ds => ({
      name:      ds.metadata.name,
      namespace: ds.metadata.namespace,
      desired:   ds.status.desiredNumberScheduled ?? 0,
      current:   ds.status.currentNumberScheduled ?? 0,
      ready:     ds.status.numberReady ?? 0,
      age:       ds.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/daemonsets/:name', async (req, res) => {
  try {
    const { apps } = clients();
    const { namespace, name } = req.params;
    await apps.deleteNamespacedDaemonSet(name, namespace);
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

// ─── Services ─────────────────────────────────────────────────────────────────

app.get('/api/:namespace/services', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listServiceForAllNamespaces()
      : await core.listNamespacedService(namespace);

    res.json(result.body.items.map(svc => ({
      name:       svc.metadata.name,
      namespace:  svc.metadata.namespace,
      type:       svc.spec.type,
      clusterIP:  svc.spec.clusterIP,
      externalIP: svc.spec.externalIPs?.join(',')
                  || svc.status.loadBalancer?.ingress?.[0]?.ip
                  || svc.status.loadBalancer?.ingress?.[0]?.hostname
                  || '-',
      ports: svc.spec.ports?.map(p => `${p.port}:${p.targetPort}/${p.protocol}`).join(', ') || '-',
      age:   svc.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/services/:name', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace, name } = req.params;
    await core.deleteNamespacedService(name, namespace);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// Port-forward state: map localPort -> { server, id }
const portForwards = new Map();

app.post('/api/:namespace/services/:name/portforward', async (req, res) => {
  try {
    const { namespace, name } = req.params;
    const { localPort, remotePort } = req.body;
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);
    if (!lp || !rp || lp < 1024 || lp > 65535 || rp < 1 || rp > 65535)
      return res.status(400).json({ error: 'Invalid ports (localPort 1024-65535, remotePort 1-65535)' });
    if (portForwards.has(lp))
      return res.status(409).json({ error: `Port ${lp} is already forwarded` });

    const forward  = new k8s.PortForward(currentKc);
    const tcpServer = net.createServer(async socket => {
      try {
        // Find a pod backing this service
        const { core } = clients();
        const svcRes   = await core.readNamespacedService(name, namespace);
        const selector = svcRes.body.spec.selector || {};
        const labelSel = Object.entries(selector).map(([k,v]) => `${k}=${v}`).join(',');
        const podsRes  = await core.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSel);
        const pod      = podsRes.body.items.find(p => p.status.phase === 'Running') || podsRes.body.items[0];
        if (!pod) { socket.destroy(); return; }
        await forward.portForward(namespace, pod.metadata.name, [rp], socket, null, socket);
      } catch (e) { socket.destroy(); }
    });

    tcpServer.listen(lp, '127.0.0.1', () => {
      const id = `${namespace}/${name}:${lp}->${rp}`;
      portForwards.set(lp, { server: tcpServer, id, namespace, name, localPort: lp, remotePort: rp });
      res.json({ success: true, id, localPort: lp, remotePort: rp });
    });
    tcpServer.on('error', err => {
      portForwards.delete(lp);
      if (!res.headersSent) handleError(res, err);
    });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/portforward/:localPort', (req, res) => {
  const lp = parseInt(req.params.localPort, 10);
  const pf = portForwards.get(lp);
  if (!pf) return res.status(404).json({ error: 'Port forward not found' });
  pf.server.close();
  portForwards.delete(lp);
  res.json({ success: true });
});

app.get('/api/portforwards', (_req, res) => {
  const list = [];
  portForwards.forEach(v => list.push({ id: v.id, localPort: v.localPort, remotePort: v.remotePort, namespace: v.namespace, name: v.name }));
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

    res.json(result.body.items.map(ing => ({
      name:      ing.metadata.name,
      namespace: ing.metadata.namespace,
      hosts:     ing.spec.rules?.map(r => r.host || '*').join(', ') || '-',
      tls:       ing.spec.tls ? 'Yes' : 'No',
      age:       ing.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

app.delete('/api/:namespace/ingresses/:name', async (req, res) => {
  try {
    const { networking } = clients();
    const { namespace, name } = req.params;
    await networking.deleteNamespacedIngress(name, namespace);
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

app.post('/api/nodes/:name/cordon', async (req, res) => {
  try {
    const { core } = clients();
    const { name } = req.params;
    const unschedulable = req.body.cordon !== false;
    await core.patchNode(name, { spec: { unschedulable } },
      undefined, undefined, undefined, undefined, PATCH_HEADERS);
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
    res.json({ success: true, evicted, failed });
  } catch (err) { handleError(res, err); }
});

// ─── Events ───────────────────────────────────────────────────────────────────

app.get('/api/:namespace/events', async (req, res) => {
  try {
    const { core } = clients();
    const { namespace } = req.params;
    const result = namespace === 'all'
      ? await core.listEventForAllNamespaces()
      : await core.listNamespacedEvent(namespace);

    res.json(result.body.items.map(evt => ({
      namespace:  evt.metadata.namespace,
      type:       evt.type,
      reason:     evt.reason,
      object:     `${evt.involvedObject.kind}/${evt.involvedObject.name}`,
      message:    evt.message,
      count:      evt.count || 1,
      age:        evt.lastTimestamp || evt.metadata.creationTimestamp,
    })));
  } catch (err) { handleError(res, err); }
});

// ─── Apply YAML ───────────────────────────────────────────────────────────────

app.put('/api/apply', async (req, res) => {
  try {
    const { yamlContent } = req.body;
    if (!yamlContent) return res.status(400).json({ error: 'yamlContent required' });

    const obj       = yaml.load(yamlContent);
    const kind      = obj.kind;
    const ns        = obj.metadata?.namespace || 'default';
    const name      = obj.metadata?.name;
    const { core, apps, networking } = clients();

    const MERGE = { headers: { 'Content-Type': 'application/merge-patch+json' } };

    const handlers = {
      Deployment:             () => apps.patchNamespacedDeployment(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
      StatefulSet:            () => apps.patchNamespacedStatefulSet(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
      DaemonSet:              () => apps.patchNamespacedDaemonSet(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
      Service:                () => core.patchNamespacedService(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
      ConfigMap:              () => core.patchNamespacedConfigMap(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
      Secret:                 () => core.patchNamespacedSecret(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
      Ingress:                () => networking.patchNamespacedIngress(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
      PersistentVolumeClaim:  () => core.patchNamespacedPersistentVolumeClaim(name, ns, obj, undefined, undefined, undefined, undefined, MERGE),
    };

    if (!handlers[kind]) return res.status(400).json({ error: `Unsupported kind: ${kind}` });
    await handlers[kind]();
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── WebSocket – Log streaming ────────────────────────────────────────────────

wss.on('connection', ws => {
  let currentStream  = null;
  let currentReq     = null;

  function stopStream() {
    if (currentReq) {
      try {
        if (typeof currentReq.abort    === 'function') currentReq.abort();
        if (typeof currentReq.destroy  === 'function') currentReq.destroy();
      } catch (_) {}
      currentReq = null;
    }
    if (currentStream) {
      try { currentStream.destroy(); } catch (_) {}
      currentStream = null;
    }
  }

  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    if (msg.action === 'stop') { stopStream(); return; }

    if (msg.action === 'start') {
      stopStream();
      const { namespace, pod, container, previous, tailLines = 200 } = msg;

      currentStream = new stream.PassThrough();
      currentStream.on('data', chunk => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'log', data: chunk.toString('utf-8') }));
      });

      try {
        const { log } = clients();
        currentReq = await log.log(
          namespace, pod, container || null, currentStream,
          err => {
            if (err && ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: 'error', data: err.message }));
            if (ws.readyState === WebSocket.OPEN)
              ws.send(JSON.stringify({ type: 'done' }));
          },
          { follow: true, tailLines, previous: !!previous }
        );
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
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')   // CSI sequences (colors, cursor)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC sequences (title, etc.)
    .replace(/\x1b[()][A-B0-9]/g, '')          // charset sequences
    .replace(/\x1b[@-_]/g, '')                 // 2-byte ESC sequences
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // other ctrl chars except \n \r \t
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
      const { host, user = 'ec2-user', keyPath, port = 22, passphrase } = msg;

      if (!host)    { send({ type: 'error', data: 'host is required' }); return; }
      if (!keyPath) { send({ type: 'error', data: 'keyPath is required' }); return; }

      let privateKey;
      try {
        privateKey = fs.readFileSync(keyPath);
      } catch (e) {
        send({ type: 'error', data: `Cannot read key file: ${e.message}` });
        return;
      }

      cleanup();
      sshConn = new Client();

      sshConn.on('ready', () => {
        sshConn.shell({ term: 'xterm-256color', cols: 220, rows: 50 }, (err, stream) => {
          if (err) {
            send({ type: 'error', data: `Shell error: ${err.message}` });
            cleanup();
            return;
          }
          sshStream = stream;
          send({ type: 'connected', host, user });

          stream.on('data', chunk => {
            send({ type: 'out', data: chunk.toString('utf8') });
          });

          stream.stderr.on('data', chunk => {
            send({ type: 'err', data: chunk.toString('utf8') });
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

      const connectOpts = { host, port, username: user, privateKey };
      if (passphrase) connectOpts.passphrase = passphrase;

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

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n  KuaDashboard running → http://localhost:${PORT}`);
  console.log(`  Context: ${currentContext}\n`);
});
