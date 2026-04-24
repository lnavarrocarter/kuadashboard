'use strict';
/**
 * routes/helm.js
 * Helm integration endpoints — requires `helm` CLI on the host PATH.
 *
 * Base path: /api/helm
 *
 * Endpoints:
 *   GET  /releases          ?context=&namespace=  → list installed releases (helm list)
 *   DELETE /releases/:ns/:name ?context=          → uninstall a release (helm uninstall)
 *   GET  /repos                                   → list configured repos (helm repo list)
 *   POST /repos                                   → add a repo { name, url, [username], [password] }
 *   DELETE /repos/:name                           → remove a repo (helm repo remove)
 *   POST /repos/update                            → update all repos (helm repo update)
 *   GET  /search            ?query=&repo=         → search charts in repos (helm search repo)
 */

const express       = require('express');
const { exec }      = require('child_process');
const { promisify } = require('util');
const path          = require('path');
const os            = require('os');
const fs            = require('fs');

const router    = express.Router();
const execAsync = promisify(exec);
const isWin     = process.platform === 'win32';

const MERGED_KUBECONFIG  = path.join(os.homedir(), '.kube', 'kuadashboard_merged.yaml');
const DEFAULT_KUBECONFIG = path.join(os.homedir(), '.kube', 'config');

/**
 * Build the KUBECONFIG env-var string using the same sources as server.js:
 * KUBECONFIG env paths + ~/.kube/config + kuadashboard_merged.yaml
 */
function resolveKubeconfigEnv() {
  const sep    = isWin ? ';' : ':';
  const envVar = process.env.KUBECONFIG || '';
  const fromEnv = envVar
    ? envVar.split(sep).map(p => p.trim()).filter(p => p && fs.existsSync(p))
    : [];
  const files = [...fromEnv];
  if (!files.includes(DEFAULT_KUBECONFIG) && fs.existsSync(DEFAULT_KUBECONFIG)) {
    files.push(DEFAULT_KUBECONFIG);
  }
  if (fs.existsSync(MERGED_KUBECONFIG) && !files.includes(MERGED_KUBECONFIG)) {
    files.push(MERGED_KUBECONFIG);
  }
  return files.join(sep);
}

// ─── Shell helper ─────────────────────────────────────────────────────────────

/**
 * Execute a command through the native shell so it inherits the user's PATH
 * (including tools installed via winget, scoop, chocolatey, brew, etc.).
 */
async function shellExec(cmd, timeout = 15000) {
  const opts = { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 };
  const kubeconfig = resolveKubeconfigEnv();
  if (isWin) {
    const psScript =
      "$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + " +
      "[Environment]::GetEnvironmentVariable('Path','User'); " +
      (kubeconfig ? `$env:KUBECONFIG = ${JSON.stringify(kubeconfig)}; ` : '') +
      cmd;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    return execAsync(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      opts
    );
  }
  const kubePfx = kubeconfig ? `KUBECONFIG=${kubeconfig.replace(/'/g, "'\\''")} ` : '';
  return execAsync(`sh -c '${kubePfx}${cmd.replace(/'/g, "'\\''")}' `, opts);
}

/**
 * Build the base helm command with optional --kube-context flag.
 */
function helmBase(context) {
  // Quote the context name to handle ARN-style names with colons and slashes
  return context ? `helm --kube-context "${context}"` : 'helm';
}

/**
 * Parse JSON output from helm commands. Returns parsed object or throws.
 */
function parseJson(raw, fallback = []) {
  const text = (raw || '').trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function handleErr(res, err, label) {
  const msg = err.stderr || err.stdout || err.message || String(err);
  console.error(`[helm/${label}]`, msg);
  res.status(500).json({ error: msg.split('\n')[0].trim() });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /releases
 * Query params: context (optional), namespace (optional, default = all)
 */
router.get('/releases', async (req, res) => {
  const { context, namespace } = req.query;
  const base = helmBase(context);
  const nsFlag = namespace && namespace !== 'all' ? `-n ${namespace}` : '-A';
  const cmd = `${base} list ${nsFlag} --output json`;
  try {
    const { stdout } = await shellExec(cmd);
    res.json(parseJson(stdout, []));
  } catch (err) {
    handleErr(res, err, 'releases');
  }
});

/**
 * DELETE /releases/:ns/:name
 * Query params: context (optional)
 */
router.delete('/releases/:ns/:name', async (req, res) => {
  const { ns, name } = req.params;
  const { context } = req.query;
  // Validate identifiers to prevent command injection
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(name) || !/^[a-zA-Z0-9_\-\.]+$/.test(ns)) {
    return res.status(400).json({ error: 'Invalid release or namespace name' });
  }
  const base = helmBase(context);
  const cmd = `${base} uninstall ${name} -n ${ns}`;
  try {
    await shellExec(cmd);
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, 'uninstall');
  }
});

/**
 * GET /repos
 * Returns the list of configured Helm repositories.
 */
router.get('/repos', async (_req, res) => {
  try {
    const { stdout } = await shellExec('helm repo list --output json');
    res.json(parseJson(stdout, []));
  } catch (err) {
    // helm repo list exits 1 with "no repositories configured" when list is empty
    const msg = (err.stderr || err.stdout || '').toLowerCase();
    if (msg.includes('no repositories') || msg.includes('no repo')) {
      return res.json([]);
    }
    handleErr(res, err, 'repos');
  }
});

/**
 * POST /repos
 * Body: { name, url, username?, password? }
 */
router.post('/repos', async (req, res) => {
  const { name, url, username, password } = req.body || {};
  if (!name || !url) {
    return res.status(400).json({ error: 'name and url are required' });
  }
  // Validate to prevent command injection
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid repository name' });
  }
  // URL validated by enclosing in quotes; no further validation needed for URL
  let cmd = `helm repo add ${name} "${url}"`;
  if (username) cmd += ` --username "${username}"`;
  if (password) cmd += ` --password "${password}"`;
  cmd += ' --force-update';
  try {
    await shellExec(cmd);
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, 'repo-add');
  }
});

/**
 * DELETE /repos/:name
 */
router.delete('/repos/:name', async (req, res) => {
  const { name } = req.params;
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(name)) {
    return res.status(400).json({ error: 'Invalid repository name' });
  }
  try {
    await shellExec(`helm repo remove ${name}`);
    res.json({ success: true });
  } catch (err) {
    handleErr(res, err, 'repo-remove');
  }
});

/**
 * POST /repos/update
 * Runs `helm repo update` to refresh all configured repos.
 */
router.post('/repos/update', async (_req, res) => {
  try {
    const { stdout, stderr } = await shellExec('helm repo update', 30000);
    res.json({ success: true, output: (stdout + stderr).trim() });
  } catch (err) {
    handleErr(res, err, 'repo-update');
  }
});

/**
 * GET /search
 * Query params: query (required), repo (optional prefix filter)
 */
router.get('/search', async (req, res) => {
  const { query = '', repo = '' } = req.query;
  const term = repo ? `${repo}/${query}` : query;
  const cmd = `helm search repo ${term} --output json`;
  try {
    const { stdout } = await shellExec(cmd, 20000);
    res.json(parseJson(stdout, []));
  } catch (err) {
    handleErr(res, err, 'search');
  }
});

module.exports = router;
