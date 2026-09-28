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
// gcloud access tokens live ~60 min; refresh well before expiry
const TOKEN_TTL_MS = 30 * 60 * 1000;
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

  async function getAccessToken(configName) {
    const cached = tokenCache.get(configName);
    if (cached && cached.expiresAt > now()) return cached.value;
    if (tokenInFlight.has(configName)) return tokenInFlight.get(configName);
    const pending = (async () => {
      try {
        const token = String(await exec(`auth print-access-token --configuration=${configName}`) || '').trim();
        if (!token) throw new Error(`No access token returned for gcloud config: ${configName}`);
        tokenCache.set(configName, { value: token, expiresAt: now() + tokenTtlMs });
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

  return { listConfigs, getAccessToken, invalidate };
}

module.exports = { createGcloudCli, CONFIG_LIST_ARGS };
