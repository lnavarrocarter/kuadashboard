'use strict';
/**
 * lib/advisor/vercel.js
 * Good-practice checks for a Vercel account or team, from the raw objects of
 * the free Vercel REST API that routes/vercel.js collects: projects, their
 * latest deployments, their env var definitions (key, type and target only:
 * values are never kept) and their domains. A source that failed for every
 * project is reported as unavailable and its checks are skipped.
 *
 * collectVercel() does the I/O (1 + 3 calls per project, up to 100 projects;
 * the Vercel API does not bill reads); adviseVercel() is pure.
 */

const { check, buildReport, SECRET_NAME_RE } = require('./core');

const DOCS = {
  envVars: 'https://vercel.com/docs/environment-variables',
  sensitiveEnv: 'https://vercel.com/docs/environment-variables/sensitive-environment-variables',
  protection: 'https://vercel.com/docs/deployment-protection',
  git: 'https://vercel.com/docs/git',
  nodeVersions: 'https://vercel.com/docs/functions/runtimes/node-js/node-js-versions',
  domains: 'https://vercel.com/docs/domains/working-with-domains/add-a-domain',
  spend: 'https://vercel.com/docs/spend-management',
  rollback: 'https://vercel.com/docs/instant-rollback',
  environments: 'https://vercel.com/docs/deployments/environments',
};

const RULES = {
  plainSecretEnv: { id: 'vercel.plain_secret_env', category: 'security', severity: 'high', docs: DOCS.envVars },
  previewCredentials: { id: 'vercel.preview_credentials', category: 'security', severity: 'medium', docs: DOCS.protection },
  secretInPreview: { id: 'vercel.secret_shared_with_preview', category: 'security', severity: 'medium', docs: DOCS.environments },
  previewUnprotected: { id: 'vercel.preview_unprotected', category: 'security', severity: 'medium', docs: DOCS.protection },
  forkProtectionOff: { id: 'vercel.fork_protection_off', category: 'security', severity: 'medium', docs: DOCS.git },
  secretNotSensitive: { id: 'vercel.secret_not_sensitive', category: 'security', severity: 'low', docs: DOCS.sensitiveEnv },
  productionFailed: { id: 'vercel.production_deploy_failed', category: 'infrastructure', severity: 'high', docs: DOCS.rollback },
  domainUnverified: { id: 'vercel.domain_unverified', category: 'infrastructure', severity: 'medium', docs: DOCS.domains },
  paused: { id: 'vercel.project_paused', category: 'infrastructure', severity: 'medium', docs: DOCS.spend },
  noProduction: { id: 'vercel.no_production', category: 'infrastructure', severity: 'low', docs: DOCS.environments },
  noPreviewFlow: { id: 'vercel.no_preview_flow', category: 'architecture', severity: 'low', docs: DOCS.environments },
  nodeDeprecated: { id: 'vercel.node_deprecated', category: 'development', severity: 'high', docs: DOCS.nodeVersions },
  failureRate: { id: 'vercel.deploy_failure_rate', category: 'development', severity: 'medium', docs: DOCS.git },
  noGitLink: { id: 'vercel.no_git_link', category: 'development', severity: 'low', docs: DOCS.git },
};

// Node.js majors past their end of life (as of 2026): Vercel no longer builds
// the oldest ones, and none of them receives security fixes.
const DEPRECATED_NODE = new Set(['8.x', '10.x', '12.x', '14.x', '16.x', '18.x', '20.x']);

// Env var types whose value anyone with access to the project can read in the
// dashboard ('system' variables are Vercel's own and are left out).
const READABLE_ENV_TYPES = new Set(['plain']);

const FAILURE_RATE_MIN_FINISHED = 4;
const FAILURE_RATE_THRESHOLD = 0.5;
const PREVIEW_FLOW_MIN_DEPLOYMENTS = 5;

// Parallel calls to Vercel, to stay well under its per-token rate limits.
const COLLECT_CONCURRENCY = 6;

// ── Collection ────────────────────────────────────────────────────────────────

/** Maps over items with at most `limit` promises in flight; never rejects. */
async function settleLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      try { results[index] = { ok: true, value: await fn(items[index]) }; } catch (error) { results[index] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Reads what adviseVercel() needs. `fetchJson(path)` is a Vercel GET with the
 * token and team already applied. Env var values are dropped as they arrive.
 * Returns { projects, deployments, envs, domains, unavailable } (Maps by project id).
 */
async function collectVercel({ fetchJson, endpoints, concurrency = COLLECT_CONCURRENCY }) {
  const data = await fetchJson(`${endpoints.projects}?limit=100`);
  const projects = Array.isArray(data) ? data : (data.projects || []);
  const sources = {
    deployments: async id => (await fetchJson(`${endpoints.deployments}?projectId=${encodeURIComponent(id)}&limit=10`)).deployments || [],
    env: async id => ((await fetchJson(`/v9/projects/${encodeURIComponent(id)}/env`)).envs || [])
      .map(env => ({ key: env.key, type: env.type, target: env.target, gitBranch: env.gitBranch || null })),
    domains: async id => (await fetchJson(`/v9/projects/${encodeURIComponent(id)}/domains?limit=50`)).domains || [],
  };
  const rows = {};
  const unavailable = [];
  for (const [source, load] of Object.entries(sources)) {
    const settled = await settleLimited(projects, concurrency, project => load(project.id));
    rows[source] = new Map(projects.map((project, index) => [project.id, settled[index].ok ? settled[index].value : []]));
    const failed = settled.filter(result => !result.ok);
    if (!failed.length) continue;
    const error = failed[0].error?.message || String(failed[0].error);
    unavailable.push(failed.length === projects.length
      ? { source, error }
      : { source, error, partial: true, action: `${source} (${failed.length}/${projects.length} projects)` });
  }
  return { projects, deployments: rows.deployments, envs: rows.env, domains: rows.domains, unavailable };
}

// ── Rules (pure) ──────────────────────────────────────────────────────────────

const ref = (project, detail) => ({ kind: 'Project', name: project.name || project.id, ...(detail ? { detail } : {}) });
const targetsOf = env => (Array.isArray(env.target) ? env.target : [env.target]).filter(Boolean);
const stateOf = deployment => deployment.readyState || deployment.state || '';
const createdOf = deployment => deployment.createdAt || deployment.created || 0;
const isSecretName = key => SECRET_NAME_RE.test(String(key || ''));
const names = (list, max = 3) => (list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max}` : list.join(', '));

function envRules(projects, envsOf, previewProtected = () => false) {
  const plain = [];
  const previewCredentials = [];
  const inPreview = [];
  const notSensitive = [];
  for (const project of projects) {
    const secrets = (envsOf(project.id) || []).filter(env => isSecretName(env.key));
    const readable = secrets.filter(env => READABLE_ENV_TYPES.has(env.type)).map(env => env.key);
    // The same variable reaches production and every preview branch.
    const shared = secrets.filter(env => !env.gitBranch && targetsOf(env).includes('production') && targetsOf(env).includes('preview')).map(env => env.key);
    // Preview-only credentials are the recommended setup; they are a risk only when
    // anyone can open the preview URLs. Shared ones are already reported above.
    const preview = previewProtected(project) ? [] : secrets
      .filter(env => targetsOf(env).includes('preview') && !shared.includes(env.key))
      .map(env => env.key);
    const encrypted = secrets.filter(env => env.type === 'encrypted' && targetsOf(env).includes('production')).map(env => env.key);
    if (readable.length) plain.push(ref(project, names(readable)));
    if (preview.length) previewCredentials.push(ref(project, names(preview)));
    if (shared.length) inPreview.push(ref(project, names(shared)));
    if (encrypted.length) notSensitive.push(ref(project, names(encrypted)));
  }
  return [
    check(RULES.plainSecretEnv, plain),
    check(RULES.previewCredentials, previewCredentials),
    check(RULES.secretInPreview, inPreview),
    check(RULES.secretNotSensitive, notSensitive),
  ];
}

/** Whether preview deployments need Vercel Authentication, a password or a trusted IP. */
function protectsPreview(project = {}) {
  if (project.trustedIps) return true;
  const protections = [project.ssoProtection, project.passwordProtection].filter(Boolean);
  // Either protection covers previews unless it is limited to production.
  return protections.some(protection => {
    const deploymentType = String(protection.deploymentType || '').trim().toLowerCase();
    return deploymentType !== 'production';
  });
}

function projectRules(projects) {
  const unprotected = projects.filter(project => !protectsPreview(project)).map(project => ref(project));
  return [
    check(RULES.previewUnprotected, unprotected),
    check(RULES.forkProtectionOff, projects.filter(p => p.gitForkProtection === false && p.link).map(p => ref(p, p.link.repo || p.link.type))),
    check(RULES.paused, projects.filter(p => p.paused).map(p => ref(p))),
    check(RULES.nodeDeprecated, projects.filter(p => DEPRECATED_NODE.has(p.nodeVersion)).map(p => ref(p, `Node.js ${p.nodeVersion}`))),
    check(RULES.noGitLink, projects.filter(p => !p.link).map(p => ref(p))),
  ];
}

function deploymentRules(projects, deploymentsOf) {
  const productionFailed = [];
  const failing = [];
  const noProduction = [];
  const noPreview = [];
  for (const project of projects) {
    const deployments = [...(deploymentsOf(project.id) || [])].sort((a, b) => createdOf(b) - createdOf(a));
    const production = deployments.filter(d => d.target === 'production');
    if (production[0] && stateOf(production[0]) === 'ERROR') productionFailed.push(ref(project, production[0].url || production[0].uid));
    if (!production.length && !project.targets?.production) noProduction.push(ref(project));
    if (deployments.length >= PREVIEW_FLOW_MIN_DEPLOYMENTS && production.length === deployments.length) noPreview.push(ref(project));
    const finished = deployments.filter(d => ['READY', 'ERROR'].includes(stateOf(d)));
    const failed = finished.filter(d => stateOf(d) === 'ERROR').length;
    if (finished.length >= FAILURE_RATE_MIN_FINISHED && failed / finished.length >= FAILURE_RATE_THRESHOLD) {
      failing.push(ref(project, `${failed}/${finished.length}`));
    }
  }
  return [
    check(RULES.productionFailed, productionFailed),
    check(RULES.noProduction, noProduction),
    check(RULES.noPreviewFlow, noPreview),
    check(RULES.failureRate, failing),
  ];
}

function domainRules(projects, domainsOf) {
  const unverified = projects.flatMap(project => (domainsOf(project.id) || [])
    .filter(domain => domain.verified === false)
    .map(domain => ({ kind: 'Domain', name: domain.name, namespace: project.name || project.id })));
  return [check(RULES.domainUnverified, unverified)];
}

/**
 * @param projects     raw project objects (GET /v10/projects)
 * @param deployments  Map or object: projectId → raw deployments, newest first
 * @param envs         Map or object: projectId → env var definitions (no values)
 * @param domains      Map or object: projectId → project domains
 * @param unavailable  [{ source, error?, action? }]; a source without `partial` was not read at all
 */
function adviseVercel({ projects = [], deployments = {}, envs = {}, domains = {}, unavailable = [], teamId = null, now = Date.now() } = {}) {
  const reader = rows => id => (rows instanceof Map ? rows.get(id) : rows[id]);
  const skipped = new Set(unavailable.filter(item => !item.partial).map(item => item.source));
  const results = [...projectRules(projects)];
  if (!skipped.has('env')) results.push(...envRules(projects, reader(envs), protectsPreview));
  if (!skipped.has('deployments')) results.push(...deploymentRules(projects, reader(deployments)));
  if (!skipped.has('domains')) results.push(...domainRules(projects, reader(domains)));
  return buildReport(results, {
    unavailable: unavailable.map(({ source, error, action }) => ({ source, ...(error ? { error } : {}), ...(action ? { action } : {}) })),
    scope: { provider: 'vercel', teamId: teamId || 'personal' },
    now,
  });
}

module.exports = { adviseVercel, collectVercel, RULES, DEPRECATED_NODE };
