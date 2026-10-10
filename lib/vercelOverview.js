'use strict';
/**
 * lib/vercelOverview.js
 * Summary of a Vercel account or team for the Vercel Overview, built from the
 * same collection the Advisor reads (lib/advisor/vercel.js collectVercel), so
 * the overview costs no extra API call. Env vars are counted by type only.
 * Pure: no I/O.
 */

const createdOf = deployment => deployment.createdAt || deployment.created || 0;
const stateOf = deployment => deployment.readyState || deployment.state || '';
const IN_PROGRESS = new Set(['BUILDING', 'QUEUED', 'INITIALIZING']);
const DAY = 24 * 60 * 60 * 1000;
// Activity windows over the deployments read (the last 10 per project).
const WINDOWS = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY };
// A project without deployments in this time is inactive: a failure there is history, not an incident.
const INACTIVE_AFTER = 30 * DAY;

/** State of the production side of a project: its latest production deployment. */
function productionOf(project, deployments) {
  const latest = deployments.find(deployment => deployment.target === 'production');
  if (latest) return { state: stateOf(latest), url: latest.url || null, createdAt: createdOf(latest) || null };
  const target = project.targets?.production;
  if (target) return { state: target.readyState || 'READY', url: target.url || null, createdAt: target.createdAt || null };
  return null;
}

/**
 * @param collected  { projects, deployments, envs, domains, unavailable } from collectVercel()
 * @param options    { now } reference time for activity windows and inactive projects
 * @returns { health, projects, production, deployments, domains, env, rows }
 *
 * production.failed counts failing production in active projects; a failure in a
 * project inactive for 30 days is production.failedInactive and does not make the
 * account critical. deployments.windows counts finished and failed deployments by age.
 */
function summarizeVercel({ projects = [], deployments = new Map(), envs = new Map(), domains = new Map(), unavailable = [] } = {}, { now = Date.now() } = {}) {
  const read = (rows, id) => (rows instanceof Map ? rows.get(id) : rows[id]) || [];
  const production = { healthy: 0, failed: 0, failedInactive: 0, building: 0, none: 0 };
  const recent = { total: 0, ready: 0, error: 0, building: 0, canceled: 0, lastAt: null };
  const windows = Object.fromEntries(Object.keys(WINDOWS).map(key => [key, { finished: 0, failed: 0 }]));
  const domainTotals = { total: 0, unverified: 0 };
  const env = { total: 0, byType: {} };
  const frameworks = new Map();

  const rows = projects.map(project => {
    const list = [...read(deployments, project.id)].sort((a, b) => createdOf(b) - createdOf(a));
    const prod = productionOf(project, list);
    const lastAt = list[0] ? createdOf(list[0]) || null : null;
    const lastActivity = lastAt || prod?.createdAt || null;
    const inactive = !!lastActivity && now - lastActivity > INACTIVE_AFTER;
    if (!prod) production.none += 1;
    else if (prod.state === 'ERROR') production[inactive ? 'failedInactive' : 'failed'] += 1;
    else if (IN_PROGRESS.has(prod.state)) production.building += 1;
    else production.healthy += 1;

    let failed = 0;
    let finished = 0;
    for (const deployment of list) {
      const state = stateOf(deployment);
      recent.total += 1;
      if (state === 'READY') { recent.ready += 1; finished += 1; }
      else if (state === 'ERROR') { recent.error += 1; finished += 1; failed += 1; }
      else if (state === 'CANCELED') recent.canceled += 1;
      else if (IN_PROGRESS.has(state)) recent.building += 1;
      const age = now - createdOf(deployment);
      if (state !== 'READY' && state !== 'ERROR') continue;
      for (const [key, span] of Object.entries(WINDOWS)) {
        if (!createdOf(deployment) || age > span) continue;
        windows[key].finished += 1;
        if (state === 'ERROR') windows[key].failed += 1;
      }
    }
    if (lastAt && (!recent.lastAt || lastAt > recent.lastAt)) recent.lastAt = lastAt;

    const projectDomains = read(domains, project.id);
    const unverified = projectDomains.filter(domain => domain.verified === false).length;
    domainTotals.total += projectDomains.length;
    domainTotals.unverified += unverified;

    for (const variable of read(envs, project.id)) {
      env.total += 1;
      const type = variable.type || 'unknown';
      env.byType[type] = (env.byType[type] || 0) + 1;
    }

    const framework = project.framework || 'other';
    frameworks.set(framework, (frameworks.get(framework) || 0) + 1);

    return {
      id: project.id,
      name: project.name || project.id,
      framework: project.framework || null,
      nodeVersion: project.nodeVersion || null,
      paused: !!project.paused,
      git: project.link ? (project.link.repo || project.link.type || true) : null,
      production: prod,
      lastDeployAt: lastAt,
      inactive,
      recent: { finished, failed },
      domains: projectDomains.length,
      unverifiedDomains: unverified,
    };
  });

  const finished = recent.ready + recent.error;
  const paused = rows.filter(row => row.paused).length;
  const health = production.failed ? 'critical'
    : (paused || production.failedInactive || domainTotals.unverified || unavailable.length) ? 'degraded'
      : 'healthy';
  const rate = ({ finished: done, failed: bad }) => (done ? Math.round((bad / done) * 100) : null);

  return {
    health,
    projects: {
      total: projects.length,
      paused,
      withGit: rows.filter(row => row.git).length,
      frameworks: [...frameworks.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    },
    production,
    deployments: {
      ...recent,
      failureRate: finished ? Math.round((recent.error / finished) * 100) : null,
      windows: Object.fromEntries(Object.entries(windows).map(([key, value]) => [key, { ...value, failureRate: rate(value) }])),
    },
    domains: domainTotals,
    env,
    rows: rows.sort((a, b) => (b.lastDeployAt || 0) - (a.lastDeployAt || 0) || a.name.localeCompare(b.name)),
  };
}

module.exports = { summarizeVercel };
