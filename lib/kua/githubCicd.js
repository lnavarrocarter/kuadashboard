'use strict';
/**
 * lib/kua/githubCicd.js
 * Plugin GitHub CI/CD (#238): explains what changed and when in a KUA Application.
 *
 * Read-only. It reads GitHub Actions runs and deployments of the repositories associated with an
 * application (REST API, GET only) and exposes them as `history` evidence of the extension
 * contract (#156). For a resource that no longer exists (#236) it names the deploy that most
 * likely replaced it: "probably deploy #N (commit, author, time)". It never writes to GitHub,
 * never triggers a workflow, and never changes membership or relationships by itself.
 *
 * It uses the GitHub CLI (`gh`) already logged in on this computer: KUA stores no token. Which
 * applications sync with GitHub, and which repositories, is local to this computer (never part of
 * the application, sync or export).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { canonicalFromApm } = require('./applicationRegistryService');
const { readPresence } = require('../apm/resourcePresence');

const SOURCE_ID = 'github.cicd';
const MAX_REPOSITORIES = 10;
const CACHE_MS = 5 * 60 * 1000;
const DEPLOY_NAME = /deploy|release|publish|rollout|\bcd\b|production|prod\b/i;
// A resource is replaced by a deploy shortly before it is noticed missing.
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const LOOKAHEAD_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const GITHUB_CICD_MANIFEST = Object.freeze({
  manifestVersion: 1,
  id: SOURCE_ID,
  version: '1.0.0',
  contractVersion: 1,
  source: { kind: 'builtin', publisher: 'KUA', name: 'GitHub CI/CD' },
  capabilities: {
    discovery: false,
    enrichment: false,
    relationshipEvidence: false,
    telemetry: false,
    historicalSearch: true,
    findings: false,
  },
  transport: { kind: 'internal', runtime: 'node' },
  scopes: ['application', 'resource'],
  permissions: ['github.actions.read', 'github.deployments.read'],
});

function githubError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** "owner/repo" from "owner/repo", "https://github.com/owner/repo(.git)" or "git@github.com:owner/repo.git". */
function parseRepository(input) {
  let value = String(input || '').trim();
  value = value.replace(/^git@github\.com:/i, '').replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/.exec(value);
  if (!match || match[2] === '.' || match[2] === '..') throw githubError(`"${String(input || '').slice(0, 80)}" is not a GitHub repository (owner/name)`, 400, 'INVALID_REPOSITORY');
  return `${match[1]}/${match[2]}`;
}

function normalizeRepositories(list) {
  if (!Array.isArray(list)) throw githubError('repositories must be an array', 400, 'INVALID_REPOSITORY');
  const repositories = [];
  for (const item of list) {
    const repository = parseRepository(item);
    if (!repositories.some(existing => existing.toLowerCase() === repository.toLowerCase())) repositories.push(repository);
  }
  if (repositories.length > MAX_REPOSITORIES) throw githubError(`At most ${MAX_REPOSITORIES} repositories per application`, 400, 'TOO_MANY_REPOSITORIES');
  return repositories;
}

function ghFailure(error) {
  const text = `${error?.stderr || ''} ${error?.message || ''}`;
  if (error?.code === 'ENOENT') return githubError('The GitHub CLI (gh) is not installed on this computer', 409, 'GH_NOT_INSTALLED');
  if (error?.killed) return githubError('GitHub did not answer in time', 502, 'GITHUB_UNREACHABLE');
  if (/gh auth login|not logged in|authentication|HTTP 401|bad credentials/i.test(text)) return githubError('The GitHub CLI is not logged in: run "gh auth login"', 409, 'GH_NOT_AUTHENTICATED');
  if (/rate limit|HTTP 429/i.test(text)) return githubError('GitHub rate limit reached', 403, 'GITHUB_RATE_LIMITED');
  if (/HTTP 404/i.test(text)) return githubError('Repository not found or not visible to your GitHub account', 404, 'GITHUB_NOT_FOUND');
  if (/HTTP 403/i.test(text)) return githubError('Your GitHub account cannot read this repository', 403, 'GITHUB_FORBIDDEN');
  if (/could not resolve|timed out|connection|network/i.test(text)) return githubError('GitHub could not be reached', 502, 'GITHUB_UNREACHABLE');
  return githubError('The GitHub CLI failed', 502, 'GITHUB_ERROR');
}

function execGh(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); } else resolve(stdout);
    });
  });
}

/** Read-only client over the local GitHub CLI. Only `gh api` GET requests and `gh repo list` exist here. */
function createGithubClient({ exec = execGh } = {}) {
  async function json(args) {
    let output;
    try { output = await exec(args); } catch (error) { throw ghFailure(error); }
    try { return JSON.parse(output || 'null'); } catch { throw githubError('The GitHub CLI answered something unreadable', 502, 'GITHUB_ERROR'); }
  }
  const api = pathname => json(['api', '--method', 'GET', pathname, '-H', 'X-GitHub-Api-Version: 2022-11-28']);

  return {
    user: () => api('user'),
    availableRepositories: () => json(['repo', 'list', '--limit', '100', '--json', 'nameWithOwner']),
    workflowRuns: repository => api(`repos/${repository}/actions/runs?per_page=50&exclude_pull_requests=true`),
    deployments: repository => api(`repos/${repository}/deployments?per_page=30`),
  };
}

const iso = value => {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function fromWorkflowRun(repository, run) {
  const at = iso(run.updated_at || run.run_started_at || run.created_at);
  if (!at || run.status !== 'completed') return null;
  return {
    id: `run:${repository}:${run.id}`,
    kind: 'workflow_run',
    repository,
    number: run.run_number,
    name: String(run.name || run.display_title || 'workflow').slice(0, 120),
    conclusion: run.conclusion || null,
    deploy: run.conclusion === 'success' && DEPLOY_NAME.test(String(run.name || '')),
    sha: run.head_sha ? String(run.head_sha) : null,
    branch: run.head_branch || null,
    actor: run.triggering_actor?.login || run.actor?.login || null,
    commit: run.head_commit ? {
      message: String(run.head_commit.message || '').split('\n')[0].slice(0, 160),
      author: run.head_commit.author?.name || null,
      at: iso(run.head_commit.timestamp),
    } : null,
    at,
    url: typeof run.html_url === 'string' && run.html_url.startsWith('https://github.com/') ? run.html_url : null,
  };
}

function fromDeployment(repository, deployment) {
  const at = iso(deployment.created_at);
  if (!at) return null;
  return {
    id: `deployment:${repository}:${deployment.id}`,
    kind: 'deployment',
    repository,
    number: deployment.id,
    name: String(deployment.environment || 'deployment').slice(0, 120),
    conclusion: null,
    deploy: true,
    sha: deployment.sha ? String(deployment.sha) : null,
    branch: deployment.ref || null,
    actor: deployment.creator?.login || null,
    commit: deployment.description ? { message: String(deployment.description).split('\n')[0].slice(0, 160), author: null, at: null } : null,
    at,
    // The API URL is not a page: link the commit of the deployment instead.
    url: deployment.sha ? `https://github.com/${repository}/commit/${deployment.sha}` : null,
  };
}

/** The event that most likely replaced something at `at`: a deploy shortly before it, nearest first. */
function likelyCause(events, at) {
  const reference = Date.parse(at);
  if (!Number.isFinite(reference)) return null;
  const candidates = events
    .filter(event => event.conclusion !== 'failure' && event.conclusion !== 'cancelled')
    .map(event => ({ event, delta: reference - Date.parse(event.at) }))
    .filter(item => item.delta >= -LOOKAHEAD_MS && item.delta <= LOOKBACK_MS);
  if (!candidates.length) return null;
  const rank = item => (item.event.deploy ? 0 : 1);
  candidates.sort((a, b) => rank(a) - rank(b) || Math.abs(a.delta) - Math.abs(b.delta));
  const { event, delta } = candidates[0];
  return { event, minutesBefore: Math.round(delta / 60000), confidence: event.deploy ? 'probable' : 'possible' };
}

/** Deploy frequency and lead time (commit → deploy) over the last `days`: the base for DORA (#96). */
function deliveryMetrics(events, { days = 30, now = Date.now() } = {}) {
  const since = now - days * DAY_MS;
  const deploys = events.filter(event => event.deploy && Date.parse(event.at) >= since && Date.parse(event.at) <= now);
  const leadTimes = deploys
    .filter(event => event.commit?.at && Date.parse(event.at) >= Date.parse(event.commit.at))
    .map(event => (Date.parse(event.at) - Date.parse(event.commit.at)) / 3600000)
    .sort((a, b) => a - b);
  const median = leadTimes.length
    ? (leadTimes.length % 2 ? leadTimes[(leadTimes.length - 1) / 2] : (leadTimes[leadTimes.length / 2 - 1] + leadTimes[leadTimes.length / 2]) / 2)
    : null;
  return {
    days,
    deploys: deploys.length,
    perWeek: Math.round((deploys.length / days) * 7 * 10) / 10,
    leadTimeHours: median === null ? null : Math.round(median * 10) / 10,
    leadTimeSamples: leadTimes.length,
  };
}

function createGithubCicd({ dataDir = null, client = createGithubClient(), apmDatabase = null, fileSystem = fs, now = () => Date.now() } = {}) {
  const file = dataDir ? path.join(dataDir, 'github-cicd.json') : null;
  let state = { applications: {}, updatedAt: null };
  try { if (file) state = { ...state, ...JSON.parse(fileSystem.readFileSync(file, 'utf8')) }; } catch { /* nothing synced yet */ }
  const github = client;
  const cache = new Map();
  let statusCache = null;

  function persist() {
    state.updatedAt = new Date(now()).toISOString();
    if (!file) return;
    fileSystem.mkdirSync(path.dirname(file), { recursive: true });
    fileSystem.writeFileSync(file, JSON.stringify({ applications: state.applications, updatedAt: state.updatedAt }));
  }

  /** Whether the GitHub CLI of this computer is installed and logged in. */
  async function connection({ refresh = false } = {}) {
    if (!refresh && statusCache && now() - statusCache.at < 60000) return statusCache.value;
    let value;
    try {
      const user = await github.user();
      value = { available: true, authenticated: true, login: user?.login ? String(user.login) : null, readOnly: true };
    } catch (error) {
      value = { available: error.code !== 'GH_NOT_INSTALLED', authenticated: false, login: null, readOnly: true, code: error.code || 'GITHUB_ERROR', error: error.message };
    }
    statusCache = { at: now(), value };
    return value;
  }

  const settings = applicationId => ({
    enabled: state.applications[applicationId]?.enabled === true,
    repositories: [...(state.applications[applicationId]?.repositories || [])],
  });

  function configure(applicationId, { enabled, repositories } = {}) {
    const current = settings(applicationId);
    const next = {
      enabled: enabled === undefined ? current.enabled : enabled === true,
      repositories: repositories === undefined ? current.repositories : normalizeRepositories(repositories),
    };
    if (next.enabled || next.repositories.length) state.applications[applicationId] = next;
    else delete state.applications[applicationId];
    cache.delete(applicationId);
    persist();
    return settings(applicationId);
  }

  /** Repositories the logged-in account can see, to pick from instead of typing. */
  async function availableRepositories() {
    const list = await github.availableRepositories();
    return (Array.isArray(list) ? list : []).map(item => item?.nameWithOwner).filter(name => typeof name === 'string');
  }

  /** Events of the application's repositories. A repository that fails is reported, not fatal. */
  async function activity(applicationId, { refresh = false } = {}) {
    const { enabled, repositories: list } = settings(applicationId);
    const empty = { enabled, repositories: list, events: [], errors: [], retrievedAt: new Date(now()).toISOString() };
    if (!enabled || !list.length) return empty;
    const cached = cache.get(applicationId);
    if (!refresh && cached && now() - cached.at < CACHE_MS && cached.key === list.join(',')) return cached.value;
    const events = [];
    const errors = [];
    for (const repository of list) {
      try {
        const [runs, deployments] = await Promise.all([github.workflowRuns(repository), github.deployments(repository)]);
        for (const run of runs?.workflow_runs || []) { const event = fromWorkflowRun(repository, run); if (event) events.push(event); }
        for (const deployment of Array.isArray(deployments) ? deployments : []) { const event = fromDeployment(repository, deployment); if (event) events.push(event); }
      } catch (error) {
        errors.push({ repository, code: error.code || 'GITHUB_ERROR', error: error.message });
      }
    }
    events.sort((a, b) => b.at.localeCompare(a.at));
    const value = { ...empty, events, errors };
    // Nothing is cached when everything failed (for example the CLI is logged out), so the next read retries.
    if (events.length || !errors.length) cache.set(applicationId, { at: now(), key: list.join(','), value });
    return value;
  }

  /** Adds `cause` to each missing resource of the observer (#236). Never fails the observer. */
  async function explainMissing(applicationId, items) {
    let result;
    try { result = await activity(applicationId); } catch { return items; }
    if (!result.events.length) return items;
    return items.map(item => {
      const found = likelyCause(result.events, item.successors?.[0]?.createdAt || item.goneSince);
      return found ? { ...item, cause: { ...found, source: SOURCE_ID } } : item;
    });
  }

  function evidenceRecord(applicationId, retrievedAt, event, resourceId, summaryPrefix = '') {
    const label = `${event.repository} ${event.kind === 'deployment' ? 'deployment' : 'run'} #${event.number}`;
    const what = `${event.kind === 'deployment' ? 'Deployment to' : 'Workflow'} ${event.name}${event.conclusion ? ` ${event.conclusion}` : ''}${event.branch ? ` on ${event.branch}` : ''}${event.actor ? ` by ${event.actor}` : ''}.`;
    return {
      schemaVersion: 1,
      id: `evidence:${crypto.createHash('sha256').update(`${SOURCE_ID}\n${event.id}\n${resourceId || ''}`).digest('hex').slice(0, 32)}`,
      sourceId: SOURCE_ID,
      reference: { kind: 'external', uri: event.url || `https://github.com/${event.repository}`, label },
      scope: { applicationId, resourceId, scopeKey: null },
      observedAt: event.at,
      retrievedAt,
      revision: null,
      generation: event.sha ? event.sha.slice(0, 40) : null,
      freshness: 'unknown',
      class: 'history',
      summary: `${summaryPrefix}${what}`.slice(0, 1000),
    };
  }

  // Resources of the application that stopped existing (#236), by their registry id.
  function missingResources(applicationId) {
    if (!apmDatabase) return [];
    const application = apmDatabase.getApplication(applicationId);
    if (!application) return [];
    const registryIds = new Set(apmDatabase.listRegistryResources(applicationId).map(resource => resource.id));
    const missing = [];
    for (const resource of apmDatabase.listResources(applicationId)) {
      const presence = readPresence(apmDatabase, resource.id);
      if (!presence.goneSince) continue;
      let registryId = null;
      try { registryId = canonicalFromApm(application, resource).id; } catch { /* not in the registry */ }
      if (registryId && registryIds.has(registryId)) missing.push({ registryId, name: resource.name, goneSince: presence.goneSince });
    }
    return missing;
  }

  const adapter = {
    manifest: GITHUB_CICD_MANIFEST,
    async queryEvidence({ applicationId }) {
      const result = await activity(applicationId);
      const records = result.events.slice(0, 100).map(event => evidenceRecord(applicationId, result.retrievedAt, event, null));
      // The deploy that most likely replaced each missing resource is history of that resource.
      for (const item of missingResources(applicationId)) {
        const found = likelyCause(result.events, item.goneSince);
        if (found) records.push(evidenceRecord(applicationId, result.retrievedAt, found.event, item.registryId, `Probably replaced ${item.name}: `));
      }
      return records;
    },
  };

  return {
    adapter, connection, settings, configure, availableRepositories, activity, explainMissing,
    metrics: async (applicationId, options) => deliveryMetrics((await activity(applicationId)).events, { now: now(), ...options }),
  };
}

module.exports = {
  GITHUB_CICD_MANIFEST,
  createGithubCicd,
  createGithubClient,
  deliveryMetrics,
  likelyCause,
  normalizeRepositories,
  parseRepository,
};
