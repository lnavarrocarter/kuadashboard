'use strict';
/**
 * lib/kubeLogs/routes.js
 * /api/kube-logs: the CloudWatch Logs experience for Kubernetes workloads,
 * on the same shared log cache (lib/awsLogCache.js). Paths mirror the AWS
 * ones under /api/cloud/aws/cloudwatch so the same UI panels work with a
 * different base URL.
 *
 *   profile  "k8s:<context>"  (X-Profile-Id, default: the current context)
 *   region   the namespace
 *   group    "<namespace>/<kind>/<name>"  (lib/kubeLogs/kubeLogClient.js)
 *
 * Everything is read through the Kubernetes API with the user's kubeconfig;
 * there are no cloud charges.
 */

const express = require('express');
const { createKubeLogClient, parseWorkloadGroup, workloadGroup } = require('./kubeLogClient');
const { registerLogSource, getLogScanRunner } = require('../logScanRunner');
const { getLogCache } = require('../awsLogCache');
const { checkRefreshMinutes } = require('../plans');

const PROFILE_PREFIX = 'k8s:';
// One sync reads every container of the workload (one page each).
const SYNC_PAGES = 200;
const LIVE_QUERY_PAGES = 200;

/**
 * @param options.k8s            @kubernetes/client-node
 * @param options.getKubeConfig  () => the loaded KubeConfig
 * @param options.getContext     () => the current context name
 */
function createKubeLogsRouter({ k8s, getKubeConfig, getContext, cache = getLogCache, runner = getLogScanRunner }) {
  const router = express.Router();

  /** API clients of a context (the current one, or a copy of the kubeconfig switched to it). */
  function clientsFor(context) {
    let kc = getKubeConfig();
    if (context && context !== getContext()) {
      const copy = new k8s.KubeConfig();
      copy.loadFromString(kc.exportConfig());
      copy.setCurrentContext(context);
      kc = copy;
    }
    return { core: kc.makeApiClient(k8s.CoreV1Api), apps: kc.makeApiClient(k8s.AppsV1Api) };
  }

  const clientFor = profileId => createKubeLogClient(clientsFor(String(profileId).slice(PROFILE_PREFIX.length)));
  // Background scans of Kubernetes workloads run on the shared runner with this client.
  registerLogSource(PROFILE_PREFIX, async profileId => clientFor(profileId));

  function profileOf(req) {
    const header = req.get('X-Profile-Id');
    return header && header.startsWith(PROFILE_PREFIX) ? header : `${PROFILE_PREFIX}${getContext()}`;
  }

  /** Parses ?group= / body.group into the cache scope, or answers 400. */
  function scopeOf(req, res, value) {
    const workload = parseWorkloadGroup(value);
    if (!workload) {
      res.status(400).json({ error: 'group must be <namespace>/<deployments|statefulsets|daemonsets|pods>/<name>' });
      return null;
    }
    return { profileId: profileOf(req), region: workload.namespace, logGroup: workloadGroup(workload) };
  }

  function fail(res, err) {
    const status = err.statusCode || err.response?.statusCode || (err.name === 'ResourceNotFoundException' ? 404 : 500);
    res.status(status).json({ error: err.body?.message || err.message || 'Internal error' });
  }

  function requireCached(res, scope) {
    if (cache().isCached(scope.profileId, scope.region, scope.logGroup)) return true;
    res.status(404).json({ error: 'Workload is not cached' });
    return false;
  }

  // ── Workloads ──

  router.get('/workloads', async (req, res) => {
    const namespace = String(req.query.namespace || '');
    const all = !namespace || namespace === 'all';
    try {
      const { core, apps } = clientsFor(getContext());
      const items = result => (result?.body ?? result)?.items || [];
      const [deployments, statefulsets, daemonsets, pods] = await Promise.all([
        all ? apps.listDeploymentForAllNamespaces() : apps.listNamespacedDeployment(namespace),
        all ? apps.listStatefulSetForAllNamespaces() : apps.listNamespacedStatefulSet(namespace),
        all ? apps.listDaemonSetForAllNamespaces() : apps.listNamespacedDaemonSet(namespace),
        all ? core.listPodForAllNamespaces() : core.listNamespacedPod(namespace),
      ]);
      const profileId = profileOf(req);
      await cache().ready();
      const cached = new Set(cache().summary({ profileId }).groups.map(group => group.logGroup));
      const row = (kind, object, extra) => {
        const group = workloadGroup({ namespace: object.metadata.namespace, kind, name: object.metadata.name });
        return { group, kind, name: object.metadata.name, namespace: object.metadata.namespace, cached: cached.has(group), ...extra };
      };
      const workloads = [
        ...items(deployments).map(d => row('deployments', d, { pods: d.status?.replicas ?? 0, ready: d.status?.readyReplicas ?? 0 })),
        ...items(statefulsets).map(s => row('statefulsets', s, { pods: s.status?.replicas ?? 0, ready: s.status?.readyReplicas ?? 0 })),
        ...items(daemonsets).map(d => row('daemonsets', d, { pods: d.status?.desiredNumberScheduled ?? 0, ready: d.status?.numberReady ?? 0 })),
        // Pods without an owner (not managed by a workload above).
        ...items(pods).filter(p => !(p.metadata.ownerReferences || []).length)
          .map(p => row('pods', p, { pods: 1, ready: (p.status?.containerStatuses || []).every(c => c.ready) ? 1 : 0 })),
      ].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
      res.json({ context: getContext(), profileId, namespace: all ? 'all' : namespace, workloads });
    } catch (err) { fail(res, err); }
  });

  // ── Cache ──

  router.get('/log-cache', async (req, res) => {
    try {
      await cache().ready();
      res.json({ context: getContext(), ...cache().summary({ profileId: profileOf(req) }) });
    } catch (err) { fail(res, err); }
  });

  // Adds a workload to the cache and runs its first sync.
  router.post('/log-cache', async (req, res) => {
    const scope = scopeOf(req, res, req.body?.group);
    if (!scope) return;
    try {
      const historyHours = req.body?.historyHours;
      cache().enable({
        ...scope, storedBytes: null, retentionInDays: null, creationTime: null,
        ...(historyHours === undefined ? {} : { historyMs: historyHours === null ? null : Math.max(0, Number(historyHours) || 0) * 3600000 }),
      });
      res.json(await cache().syncGroup({ ...scope, client: clientFor(scope.profileId), FilterLogEventsCommand: FilterCommand, maxPages: SYNC_PAGES }));
    } catch (err) { fail(res, err); }
  });

  // Syncs one cached workload (body.group) or every cached workload of the context.
  router.post('/log-cache/sync', async (req, res) => {
    const profileId = profileOf(req);
    try {
      let scopes = cache().summary({ profileId }).groups.map(group => ({ profileId, region: group.region, logGroup: group.logGroup }));
      if (req.body?.group) {
        const scope = scopeOf(req, res, req.body.group);
        if (!scope) return;
        scopes = scopes.filter(item => item.logGroup === scope.logGroup);
        if (!scopes.length) return res.status(404).json({ error: 'Workload is not cached' });
      }
      const client = clientFor(profileId);
      const results = [];
      for (const scope of scopes) {
        try {
          results.push({ logGroup: scope.logGroup, ...(await cache().syncGroup({ ...scope, client, FilterLogEventsCommand: FilterCommand, maxPages: SYNC_PAGES })) });
        } catch (err) {
          results.push({ logGroup: scope.logGroup, status: 'error', error: err.message });
        }
      }
      res.json({ results, ...cache().summary({ profileId }) });
    } catch (err) { fail(res, err); }
  });

  router.delete('/log-cache', (req, res) => {
    const scope = scopeOf(req, res, req.query.group);
    if (!scope) return;
    try {
      cache().disable(scope);
      res.json({ ok: true, ...cache().summary({ profileId: scope.profileId }) });
    } catch (err) { fail(res, err); }
  });

  router.patch('/log-cache', (req, res) => {
    const scope = scopeOf(req, res, req.body?.group);
    if (!scope) return;
    const body = req.body || {};
    const hours = body.historyHours;
    if ('historyHours' in body && hours !== null && !(Number(hours) >= 0)) return res.status(400).json({ error: 'historyHours must be null or a number of hours' });
    if (!('historyHours' in body) && !('refreshMinutes' in body)) return res.status(400).json({ error: 'historyHours or refreshMinutes is required' });
    try {
      const refreshMinutes = 'refreshMinutes' in body ? checkRefreshMinutes(body.refreshMinutes) : undefined;
      if (!requireCached(res, scope)) return;
      let result = cache().describeGroup(scope.profileId, scope.region, scope.logGroup);
      if ('historyHours' in body) result = cache().setHistory({ ...scope, historyMs: hours === null ? null : Number(hours) * 3600000 });
      if (refreshMinutes !== undefined) result = cache().setRefresh({ ...scope, minutes: refreshMinutes });
      res.json(result);
    } catch (err) {
      if (err.code === 'PLAN_REQUIRED' || err.statusCode === 400) return res.status(err.statusCode).json({ error: err.message, code: err.code, required: err.required });
      fail(res, err);
    }
  });

  // ── Background scans (shared runner, lib/logScanRunner.js) ──

  const scanDays = value => {
    const days = Number(value);
    return Number.isFinite(days) && days > 0 ? Math.min(days, 5) : null;
  };

  router.get('/log-scans', (req, res) => {
    try {
      const profileId = profileOf(req);
      res.json({ context: getContext(), maxDays: 5, scans: runner().list({ profileId }), active: runner().activeCount(), usage: cache().usage() });
    } catch (err) { fail(res, err); }
  });

  // The kubelet does not report log sizes: the estimate only says whether the cache has room.
  router.get('/log-scans/estimate', (req, res) => {
    const scope = scopeOf(req, res, req.query.group);
    if (!scope) return;
    const days = scanDays(req.query.days);
    if (!days) return res.status(400).json({ error: 'days must be between 1 hour and 5 days' });
    const usage = cache().usage();
    const to = Date.now();
    res.json({
      group: scope.logGroup, cached: cache().isCached(scope.profileId, scope.region, scope.logGroup),
      from: to - days * 86400000, to, days, dailyBytes: null, estimatedBytes: null,
      freeBytes: Math.max(0, usage.budgetBytes - usage.bytes), budgetBytes: usage.budgetBytes, fits: usage.bytes < usage.budgetBytes, unknownSize: true,
    });
  });

  router.post('/log-scans', async (req, res) => {
    const scope = scopeOf(req, res, req.body?.group);
    if (!scope) return;
    const days = scanDays(req.body?.days);
    if (!days) return res.status(400).json({ error: 'days must be between 1 hour and 5 days' });
    try {
      await cache().ready();
      if (!cache().isCached(scope.profileId, scope.region, scope.logGroup)) {
        cache().enable({ ...scope, storedBytes: null, retentionInDays: null, creationTime: null });
      }
      const to = Date.now();
      const scan = runner().start({ ...scope, from: to - days * 86400000, to });
      res.status(201).json({ scan, group: cache().describeGroup(scope.profileId, scope.region, scope.logGroup) });
    } catch (err) { fail(res, err); }
  });

  function scopedScan(req, res) {
    const scan = runner().get(Number(req.params.id));
    if (!scan || scan.profileId !== profileOf(req)) {
      res.status(404).json({ error: 'Scan not found' });
      return null;
    }
    return scan;
  }

  router.post('/log-scans/:id/:action', (req, res) => {
    const action = { pause: 'pause', resume: 'resume', cancel: 'cancel' }[req.params.action];
    if (!action) return res.status(400).json({ error: 'Unknown action' });
    try {
      const scan = scopedScan(req, res);
      if (!scan) return;
      res.json(runner()[action](scan.id));
    } catch (err) { fail(res, err); }
  });

  router.delete('/log-scans/:id', (req, res) => {
    try {
      const scan = scopedScan(req, res);
      if (!scan) return;
      runner().remove(scan.id);
      res.status(204).end();
    } catch (err) { fail(res, err); }
  });

  // ── Intelligence (same read model as CloudWatch: anomalies, ML, recommendations) ──

  const validFilter = (req, res) => {
    const category = String(req.query.category || '');
    const level = String(req.query.level || '');
    if (category && !/^[a-z_]{2,40}$/.test(category)) { res.status(400).json({ error: 'Invalid category' }); return null; }
    if (level && !['error', 'warn', 'info'].includes(level)) { res.status(400).json({ error: 'Invalid level' }); return null; }
    return { category, level };
  };

  router.get('/log-intelligence', async (req, res) => {
    const scope = scopeOf(req, res, req.query.group);
    if (!scope) return;
    try {
      const intelligence = await cache().intelligenceFor(scope);
      if (!intelligence) return res.status(404).json({ error: 'Workload is not cached' });
      res.json({ ...intelligence, apm: [] });
    } catch (err) { fail(res, err); }
  });

  router.get('/log-intelligence/histogram', async (req, res) => {
    const scope = scopeOf(req, res, req.query.group);
    if (!scope) return;
    const filter = validFilter(req, res);
    if (!filter) return;
    try {
      if (!requireCached(res, scope)) return;
      const to = Number(req.query.to) || Date.now();
      const from = Number(req.query.from) || to - 24 * 3600000;
      if (!(from < to) || to - from > 8 * 24 * 3600000) return res.status(400).json({ error: 'Invalid range' });
      res.json(await cache().histogram({ ...scope, from, to, binMs: Number(req.query.binMs) || undefined, ...filter, pattern: String(req.query.pattern || '').slice(0, 512) }));
    } catch (err) { fail(res, err); }
  });

  router.get('/log-intelligence/events', async (req, res) => {
    const scope = scopeOf(req, res, req.query.group);
    if (!scope) return;
    const filter = validFilter(req, res);
    if (!filter) return;
    try {
      if (!requireCached(res, scope)) return;
      const minutes = Math.min(Math.max(parseInt(req.query.minutes, 10) || 7 * 1440, 1), 7 * 1440);
      const to = Number(req.query.to) || null;
      const from = Number(req.query.from) || (to || Date.now()) - minutes * 60000;
      res.json(await cache().filterEvents({
        ...scope, from, to, ...filter,
        signature: String(req.query.signature || '').slice(0, 200), pattern: String(req.query.pattern || '').slice(0, 512), limit: req.query.limit,
      }));
    } catch (err) { fail(res, err); }
  });

  router.get('/log-intelligence/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.status(400).json({ error: 'q is required' });
    let scope = null;
    if (req.query.group) {
      scope = scopeOf(req, res, req.query.group);
      if (!scope) return;
    }
    try {
      const profileId = profileOf(req);
      // Search every namespace of the context (region null) unless a workload is given.
      const results = await cache().searchSignatures({ profileId, region: scope?.region ?? null, query: query.slice(0, 500), logGroup: scope?.logGroup ?? null, limit: Math.min(Number(req.query.limit) || 20, 50) });
      res.json({ query, context: getContext(), results });
    } catch (err) {
      if (err.code === 'ML_DISABLED') return res.status(409).json({ error: 'Local ML is disabled. Enable it in KUA (Intelligence → Local ML).', code: 'ML_DISABLED' });
      fail(res, err);
    }
  });

  // ── Queries (Logs Insights syntax, shared engine) over the cache or live pod logs ──

  router.post('/log-groups/query', async (req, res) => {
    const scope = scopeOf(req, res, req.body?.group);
    if (!scope) return;
    let engine;
    try {
      engine = await import('../../frontend/src/shared/logsQuery.mjs');
      const query = String(req.body?.query || '').slice(0, 10000);
      const check = engine.validateQuery(query);
      if (!check.ok) return res.status(400).json({ error: check.error.message, queryError: check.error });
      const minutes = Math.min(Math.max(parseInt(req.body?.minutes, 10) || 60, 1), 7 * 1440);
      const end = Date.now();
      const start = end - minutes * 60000;
      let events;
      let coverage;
      let storedInCache = 0;
      if (req.body?.source === 'cache') {
        const scanned = await cache().scan({ ...scope, from: start, to: end });
        events = scanned.events;
        coverage = { truncated: scanned.truncated, from: events.length ? events[events.length - 1].timestamp : null, to: events.length ? events[0].timestamp : null };
      } else {
        const { fetchNewest } = require('../awsLogFetch');
        const sample = await fetchNewest({ client: clientFor(scope.profileId), FilterLogEventsCommand: FilterCommand, logGroupName: scope.logGroup, startTime: start, endTime: end, limit: 50000, maxPages: LIVE_QUERY_PAGES });
        events = sample.events;
        coverage = { truncated: sample.more, from: sample.more ? sample.from : start, to: end };
        if (cache().isCached(scope.profileId, scope.region, scope.logGroup)) {
          try { storedInCache = await cache().ingest({ ...scope, events }); } catch (cacheErr) { console.warn('[kube-logs]', cacheErr.message); }
        }
      }
      const result = engine.runQuery(query, events, { logGroup: scope.logGroup });
      res.json({ source: req.body?.source === 'cache' ? 'cache' : 'live', ...result, storedInCache, coverage: { events: events.length, ...coverage } });
    } catch (err) {
      if (engine && err instanceof engine.QueryError) {
        return res.status(400).json({ error: err.message, queryError: { code: err.code, params: err.params, message: err.message } });
      }
      fail(res, err);
    }
  });

  return router;
}

// Minimal command object: the Kubernetes client only reads `input`.
class FilterCommand {
  constructor(input) { this.input = input; }
}

module.exports = { createKubeLogsRouter, PROFILE_PREFIX };
