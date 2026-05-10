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
 *   POST /install                                 → install/upgrade a chart
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
const KUBECONFIG_PATHS   = path.join(os.homedir(), '.kube', 'kuadashboard_paths.json');
const SAFE_NAME_RE = /^[a-zA-Z0-9_\-\.]+$/;
const SAFE_CHART_RE = /^[a-zA-Z0-9_\-\.]+\/[a-zA-Z0-9_\-\.]+$/;
const SAFE_VERSION_RE = /^[a-zA-Z0-9_\-\.+]+$/;
const METRICS_SERVER_PRESET = `args:
  - --kubelet-insecure-tls
  - --kubelet-preferred-address-types=InternalIP,ExternalIP,Hostname
apiService:
  insecureSkipTLSVerify: true
`;

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
  readRegisteredKubeconfigPaths().forEach(file => {
    if (!files.includes(file) && fs.existsSync(file)) files.push(file);
  });
  return files.join(sep);
}

function readRegisteredKubeconfigPaths() {
  try {
    const parsed = JSON.parse(fs.readFileSync(KUBECONFIG_PATHS, 'utf8'));
    return Array.isArray(parsed.paths) ? parsed.paths.filter(p => typeof p === 'string') : [];
  } catch (_) {
    return [];
  }
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function validateName(value, label) {
  if (!value || !SAFE_NAME_RE.test(value)) throw new Error(`Invalid ${label}`);
}

function validateChart(value) {
  if (!value || !SAFE_CHART_RE.test(value)) throw new Error('Invalid chart name. Expected repo/chart');
}

function isMetricsServerChart(chart) {
  const name = String(chart || '').toLowerCase();
  return name === 'metrics-server/metrics-server' || name.endsWith('/metrics-server');
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

/**
 * POST /install
 * Body: { chart, releaseName, namespace, version?, values?, createNamespace?, wait?, context?, preset? }
 */
router.post('/install', async (req, res) => {
  const { chart, releaseName, namespace = 'default', version = '', values = '', createNamespace = true, wait = false, context = '', preset = '' } = req.body || {};
  const valuesFiles = [];
  try {
    validateChart(chart);
    validateName(releaseName, 'release name');
    validateName(namespace, 'namespace');
    if (version && !SAFE_VERSION_RE.test(version)) throw new Error('Invalid chart version');

    const base = helmBase(context);
    const args = ['upgrade', '--install', shellQuote(releaseName), shellQuote(chart), '-n', shellQuote(namespace), '--timeout', '2m'];
    if (createNamespace) args.push('--create-namespace');
    if (wait) args.push('--wait');
    if (version) args.push('--version', shellQuote(version));
    if (preset === 'metrics-server' && isMetricsServerChart(chart)) {
      const presetFile = path.join(os.tmpdir(), `kuadashboard-helm-preset-${Date.now()}-${Math.random().toString(16).slice(2)}.yaml`);
      fs.writeFileSync(presetFile, METRICS_SERVER_PRESET, 'utf8');
      valuesFiles.push(presetFile);
      args.push('-f', shellQuote(presetFile));
    }
    if (String(values || '').trim()) {
      const valuesFile = path.join(os.tmpdir(), `kuadashboard-helm-${Date.now()}-${Math.random().toString(16).slice(2)}.yaml`);
      fs.writeFileSync(valuesFile, String(values), 'utf8');
      valuesFiles.push(valuesFile);
      args.push('-f', shellQuote(valuesFile));
    }
    const cmd = `${base} ${args.join(' ')}`;
    const { stdout, stderr } = await shellExec(cmd, 2 * 60 * 1000);
    let status = null;
    try {
      const statusResult = await shellExec(`${base} status ${shellQuote(releaseName)} -n ${shellQuote(namespace)} --output json`, 15000);
      status = parseJson(statusResult.stdout, null);
    } catch (_) {}
    res.json({ success: true, output: (stdout + stderr).trim(), status });
  } catch (err) {
    handleErr(res, err, 'install');
  } finally {
    valuesFiles.forEach(file => fs.promises.unlink(file).catch(() => {}));
  }
});

module.exports = router;
