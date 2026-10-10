'use strict';
/**
 * lib/kubeExecCredentials.js
 * Exec credential plugins of a kubeconfig (aws eks get-token,
 * gke-gcloud-auth-plugin, kubelogin…) without blocking the server.
 *
 * @kubernetes/client-node 0.20 runs the plugin with spawnSync inside every
 * request that has no cached token: the whole backend (every route, the
 * account, the WebSockets) stops for the seconds the CLI takes, the cache
 * lives in each KubeConfig (lost on every context switch), and while the
 * plugin fails (an expired SSO session) it runs again on every request.
 *
 * Here the plugin runs asynchronously with a timeout, once per command for
 * every KubeConfig. The credential is kept until shortly before it expires
 * (renewed in the background), and a failure is remembered for a short while
 * so the UI polling does not run the CLI again and again.
 */

const { execFile } = require('node:child_process');
const { ExecAuth } = require('@kubernetes/client-node/dist/exec_auth');

const TIMEOUT_MS = 60 * 1000;
// Renewed in the background during the last minute of a credential.
const RENEW_BEFORE_MS = 60 * 1000;
// A credential without expirationTimestamp (the plugin did not say).
const NO_EXPIRY_MS = 10 * 60 * 1000;
// A failed plugin is not run again for this long: requests fail fast with its error.
const FAILURE_MS = 15 * 1000;

/** The exec section of a kubeconfig user (users[].user.exec, or the legacy auth-provider one). */
function execOf(user) {
  return user?.exec || user?.authProvider?.config?.exec || null;
}

// gke-gcloud-auth-plugin only turns gcloud's access token into an
// ExecCredential. kubeconfigs written by `gcloud container clusters
// get-credentials` name it even when it was never installed, which made every
// request fail with "spawn gke-gcloud-auth-plugin.exe ENOENT". Without the
// plugin, the same token is read from gcloud (same env, so the same account).
const GKE_PLUGIN = /(^|[\\/])gke-gcloud-auth-plugin(\.exe)?$/i;

function gcloudExecCredential(env, { timeoutMs = TIMEOUT_MS, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    // gcloud is a .cmd on Windows: it needs a shell to be found and run (a fixed
    // command line, no user input).
    const win = process.platform === 'win32';
    const [file, args] = win ? ['gcloud config config-helper --format=json', []] : ['gcloud', ['config', 'config-helper', '--format=json']];
    execFileImpl(file, args, { env, timeout: timeoutMs, windowsHide: true, shell: win, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || '').trim() || err.message));
      try {
        const credential = JSON.parse(stdout)?.credential || {};
        if (!credential.access_token) throw new Error('no access token');
        resolve({
          apiVersion: 'client.authentication.k8s.io/v1beta1',
          kind: 'ExecCredential',
          status: { token: credential.access_token, ...(credential.token_expiry ? { expirationTimestamp: credential.token_expiry } : {}) },
        });
      } catch (parseErr) { reject(new Error(`gcloud did not return an access token (${parseErr.message})`)); }
    });
  });
}

/** Runs the plugin like client-node does (same command, args and env), but asynchronously. */
function runPlugin(exec, { timeoutMs = TIMEOUT_MS, execFileImpl = execFile } = {}) {
  const env = exec.env?.length ? { ...process.env, ...Object.fromEntries(exec.env.map(e => [e.name, e.value])) } : process.env;
  return new Promise((resolve, reject) => {
    execFileImpl(exec.command, exec.args || [], { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT' && GKE_PLUGIN.test(exec.command)) {
        return gcloudExecCredential(env, { timeoutMs, execFileImpl }).then(resolve, gcloudErr => reject(new Error(
          `gke-gcloud-auth-plugin is not installed and gcloud could not provide a token (${gcloudErr.message}). ` +
          'Install it with: gcloud components install gke-gcloud-auth-plugin')));
      }
      if (err) return reject(new Error(String(stderr || '').trim() || (err.killed ? `${exec.command} did not answer in ${timeoutMs / 1000} s` : err.message)));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`${exec.command} did not return an ExecCredential`)); }
    });
  });
}

function createExecCredentials({ run = runPlugin, now = () => Date.now() } = {}) {
  const entries = new Map();
  const keyOf = exec => JSON.stringify([exec.command, exec.args || [], exec.env || []]);

  function load(key, exec) {
    const entry = entries.get(key) || {};
    entries.set(key, entry);
    // One run per command at a time: concurrent requests share it.
    entry.pending ||= Promise.resolve()
      .then(() => run(exec))
      .then(credential => {
        const expires = Date.parse(credential?.status?.expirationTimestamp);
        Object.assign(entry, { credential, expiresAt: Number.isFinite(expires) ? expires : now() + NO_EXPIRY_MS, error: null });
        return credential;
      }, err => {
        Object.assign(entry, { error: err, failedAt: now() });
        throw err;
      })
      .finally(() => { entry.pending = null; });
    return entry.pending;
  }

  /** The credential for this exec section: cached, being loaded, or loaded now. */
  async function get(exec) {
    const key = keyOf(exec);
    const entry = entries.get(key);
    if (entry?.credential && now() < entry.expiresAt) {
      if (now() >= entry.expiresAt - RENEW_BEFORE_MS && !entry.pending && !(entry.error && now() - entry.failedAt < FAILURE_MS)) {
        load(key, exec).catch(() => { /* the current one is still valid */ });
      }
      return entry.credential;
    }
    if (entry?.pending) return entry.pending;
    if (entry?.error && now() - entry.failedAt < FAILURE_MS) throw entry.error;
    return load(key, exec);
  }

  /** Loads the current user's credential ahead of the first request (boot, context switch). */
  function warm(kubeConfig) {
    let exec = null;
    try { exec = execOf(kubeConfig?.getCurrentUser?.()); } catch { /* no current user */ }
    if (exec?.command) get(exec).catch(() => { /* reported by the first request */ });
  }

  return { get, warm, clear: () => entries.clear() };
}

/**
 * Same result as client-node's ExecAuth.applyAuthentication (certificate,
 * key and bearer token from the ExecCredential status), with the credential
 * from `credentials` instead of a spawnSync.
 */
function installAsyncExecAuth(credentials, { target = ExecAuth.prototype } = {}) {
  async function applyAuthentication(user, opts) {
    const exec = execOf(user);
    if (!exec) return;
    if (!exec.command) throw new Error('No command was specified for exec authProvider!');
    const status = (await credentials.get(exec))?.status || {};
    if (status.clientCertificateData) opts.cert = status.clientCertificateData;
    if (status.clientKeyData) opts.key = status.clientKeyData;
    if (status.token) {
      opts.headers ||= {};
      opts.headers.Authorization = `Bearer ${status.token}`;
    }
  }
  target.applyAuthentication = applyAuthentication;
}

let shared = null;
/** The server's credentials, installed into client-node the first time. */
function getExecCredentials() {
  if (!shared) {
    shared = createExecCredentials();
    installAsyncExecAuth(shared);
  }
  return shared;
}

module.exports = { createExecCredentials, installAsyncExecAuth, getExecCredentials, execOf, runPlugin };
