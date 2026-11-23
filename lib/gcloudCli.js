'use strict';

// Cached access to the local gcloud CLI for "local:<config>" GCP profiles.
//
// Every GCP request resolves its auth through here. Opening the GCP view loads
// ~25 tabs at once; spawning `gcloud` (via PowerShell on Windows, ~5 s each)
// twice per request meant ~50 concurrent processes, all of which hit the timeout
// and surfaced as "gcloud config not found". This module:
//   - caches the configuration list and each config's access token
//   - shares one in-flight call between concurrent requests
//   - reports CLI failures as such instead of an empty config list

const CONFIG_TTL_MS = 60 * 1000;
// gcloud access tokens live ~60 min, but the one gcloud hands out may be close to its end:
// a token is kept until shortly before the expiry gcloud reports, and never longer than this.
const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
// Plain --format=json: a projection like json(name,...) needs quotes, which break
// inside the `powershell -Command "..."` wrapper used on Windows.
const CONFIG_LIST_ARGS = 'config configurations list --format=json';

function createGcloudCli({ exec, now = () => Date.now(), configTtlMs = CONFIG_TTL_MS, tokenTtlMs = TOKEN_TTL_MS } = {}) {
  let configCache = null;        // { value, expiresAt }
  let configInFlight = null;
  const tokenCache = new Map();  // configName -> { value, expiresAt }
  const tokenInFlight = new Map();

  function cliError(what, err) {
    const reason = err?.killed ? 'timed out' : (err?.message || String(err)).split('\n')[0];
    return Object.assign(new Error(`gcloud ${what} failed (${reason}). Check that the Google Cloud CLI is installed and logged in.`), {
      code: 503, cause: err,
    });
  }

  /** List local configurations. Throws on CLI failure (never caches failures). */
  async function listConfigs({ force = false } = {}) {
    if (!force && configCache && configCache.expiresAt > now()) return configCache.value;
    if (configInFlight) return configInFlight;
    configInFlight = (async () => {
      try {
        const raw = await exec(CONFIG_LIST_ARGS);
        const value = JSON.parse(raw || '[]').map(c => ({
          name: c.name,
          project: c.properties?.core?.project || null,
          account: c.properties?.core?.account || null,
          region: c.properties?.compute?.region || null,
          isActive: c.is_active === true,
        }));
        configCache = { value, expiresAt: now() + configTtlMs };
        return value;
      } catch (err) {
        throw cliError('config listing', err);
      } finally {
        configInFlight = null;
      }
    })();
    return configInFlight;
  }

  /** List every project visible to the account in a local gcloud configuration. */
  async function listProjects(configName, account) {
    if (configName && !/^[a-zA-Z0-9_-]+$/.test(String(configName))) {
      throw Object.assign(new Error('Invalid gcloud configuration name'), { code: 400 });
    }
    if (!configName && (!account || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(account))) {
      throw Object.assign(new Error('A valid gcloud configuration or Google account is required'), { code: 400 });
    }
    try {
      const selector = configName
        ? ` --configuration=${configName}`
        : ` --account=${account}`;
      const raw = await exec(`projects list --format=json${selector}`);
      return JSON.parse(raw || '[]').map(project => ({
        id: project.projectId,
        name: project.name || null,
        state: project.lifecycleState || project.state || null,
        createTime: project.createTime?.seconds ?? project.createTime ?? null,
      }));
    } catch (err) {
      if (err.code === 400) throw err;
      throw cliError('project listing', err);
    }
  }

  /** Remove only the project association from a local configuration. */
  async function unsetProject(configName) {
    if (!/^[a-zA-Z0-9_-]+$/.test(String(configName || ''))) {
      throw Object.assign(new Error('Invalid gcloud configuration name'), { code: 400 });
    }
    try {
      await exec(`config unset project --configuration=${configName}`);
      invalidate();
    } catch (err) {
      if (err.code === 400) throw err;
      throw cliError(`project removal from configuration "${configName}"`, err);
    }
  }

  /** Confirm that the selected account can access a project before linking it. */
  async function describeProject(projectId, account) {
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(String(projectId || ''))) {
      throw Object.assign(new Error('Invalid Google Cloud project ID'), { code: 400 });
    }
    if (account && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(account)) {
      throw Object.assign(new Error('Invalid Google account email'), { code: 400 });
    }
    try {
      const accountArg = account ? ` --account=${account}` : '';
      const raw = await exec(`projects describe ${projectId} --format=json${accountArg}`);
      return JSON.parse(raw || '{}');
    } catch (err) {
      if (err.code === 400) throw err;
      throw cliError(`project access check for "${projectId}"`, err);
    }
  }

  async function getAccessToken(configName) {
    const cached = tokenCache.get(configName);
    if (cached && cached.expiresAt > now()) return cached.value;
    if (tokenInFlight.has(configName)) return tokenInFlight.get(configName);
    const pending = (async () => {
      try {
        // config-helper returns the token with its expiry (and refreshes it when it has expired).
        const raw = String(await exec(`config config-helper --format=json --configuration=${configName}`) || '').trim();
        let credential = null;
        try { credential = JSON.parse(raw)?.credential || null; } catch { /* reported below */ }
        const token = String(credential?.access_token || '').trim();
        if (!token) throw new Error(`No access token returned for gcloud config: ${configName}`);
        const expiry = Date.parse(credential.token_expiry || '');
        const expiresAt = Math.min(now() + tokenTtlMs, Number.isFinite(expiry) ? expiry - TOKEN_REFRESH_MARGIN_MS : Infinity);
        // A token about to expire is used once and not kept: the next request asks gcloud again.
        if (expiresAt > now()) tokenCache.set(configName, { value: token, expiresAt });
        return token;
      } catch (err) {
        if (/No access token returned/.test(err.message)) throw err;
        throw cliError(`access token for "${configName}"`, err);
      } finally {
        tokenInFlight.delete(configName);
      }
    })();
    tokenInFlight.set(configName, pending);
    return pending;
  }

  /** Call after creating configs or logging in. */
  function invalidate() {
    configCache = null;
    tokenCache.clear();
  }

  /** Google refused this config's token (revoked, or the account logged in again): ask gcloud next time. */
  function invalidateToken(configName) {
    tokenCache.delete(configName);
  }

  return { listConfigs, listProjects, unsetProject, describeProject, getAccessToken, invalidate, invalidateToken };
}

module.exports = { createGcloudCli, CONFIG_LIST_ARGS };
