'use strict';
/**
 * routes/systemTools.js
 * Detects whether required CLI tools are installed on the host machine.
 *
 * GET /api/system/tools
 * Returns an array of tool descriptors:
 * [
 *   {
 *     id:          string   – internal identifier
 *     name:        string   – display name
 *     installed:   boolean
 *     version:     string | null   – parsed version string if installed
 *     downloadUrl: string   – official download page
 *     docsUrl:     string   – installation docs
 *     description: string   – one-liner about why it's needed
 *   }
 * ]
 *
 * The check is intentionally lightweight (just `which`/`where` + `--version`).
 * All tools are optional — only the features that need them will be affected.
 */

const express        = require('express');
const { exec }       = require('child_process');
const { promisify }  = require('util');
const isWin          = process.platform === 'win32';

const router    = express.Router();
const execAsync = promisify(exec);

/**
 * Run a command through the native shell so it inherits the user's PATH
 * (including tools installed via winget, scoop, chocolatey, brew, etc.).
 * On Windows: cmd /c <command>
 * On Unix:    sh -c <command>
 */
async function shellExec(cmd, timeout = 6000) {
  const opts = { timeout, windowsHide: true };
  return execAsync(
    isWin ? `powershell -NoProfile -NonInteractive -Command "${cmd}"` : `sh -c "${cmd}"`,
    opts
  );
}

// ─── Tool registry ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    id:          'kubectl',
    name:        'kubectl',
    binary:      'kubectl',
    versionArgs: ['version', '--client'],
    // version output: "Client Version: v1.29.0"
    versionRegex: /v(\d+\.\d+\.\d+)/,
    description: 'Required for Kubernetes cluster management, exec shells and log streaming.',
    downloadUrl: 'https://kubernetes.io/docs/tasks/tools/#kubectl',
    docsUrl:     'https://kubernetes.io/docs/tasks/tools/',
  },
  {
    id:          'aws',
    name:        'AWS CLI v2',
    binary:      'aws',
    versionArgs: ['--version'],
    // version output: "aws-cli/2.15.4 Python/3.11.6 ..."
    versionRegex: /aws-cli\/(\S+)/,
    description: 'Required for advanced AWS operations and EKS authentication.',
    downloadUrl: 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
    docsUrl:     'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html',
  },
  {
    id:          'gcloud',
    name:        'Google Cloud CLI (gcloud)',
    binary:      'gcloud',
    versionArgs: ['version', '--format=json'],
    // version output (JSON): { "Google Cloud SDK": "461.0.0" }
    versionRegex: /"Google Cloud SDK"\s*:\s*"([^"]+)"/,
    description: 'Required for GKE authentication and advanced GCP operations.',
    downloadUrl: 'https://cloud.google.com/sdk/docs/install',
    docsUrl:     'https://cloud.google.com/sdk/docs/install',
  },
  {
    id:          'helm',
    name:        'Helm',
    binary:      'helm',
    versionArgs: ['version'],
    // "version.BuildInfo{Version:"v3.14.4", ...}" or "v3.14.0+g3fc9f4b" (--short, older)
    versionRegex: /[Vv]ersion[.:{" ]*v?(\d+\.\d+\.\d+)/,
    description: 'Optional: enables Helm chart management from the dashboard.',
    downloadUrl: 'https://helm.sh/docs/intro/install/',
    docsUrl:     'https://helm.sh/docs/intro/install/',
  },
];

// ─── Detection helpers ────────────────────────────────────────────────────────

/**
 * Run `binary versionArgs` through the native shell and parse the version.
 * Returns null on any failure (binary not found, error, timeout).
 */
async function detectVersion(binary, versionArgs, regex) {
  const cmd = [binary, ...versionArgs].join(' ');
  try {
    const { stdout, stderr } = await shellExec(cmd);
    const combined = (stdout + stderr).trim();
    const match    = combined.match(regex);
    return match ? match[1] : combined.split('\n')[0].trim() || 'installed';
  } catch (e) {
    // Some CLIs write version to stderr; check there too
    const errOut = (e.stderr || e.stdout || '').trim();
    if (!errOut) return null;
    const match = errOut.match(regex);
    return match ? match[1] : null;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/tools', async (_req, res) => {
  try {
    const results = await Promise.all(
      TOOLS.map(async tool => {
        // Try version detection directly — if it works, the tool is installed.
        // This is more reliable than `which`/`where` when PATH differs between
        // the shell and the Node.js subprocess environment (common on Windows).
        const version = await detectVersion(tool.binary, tool.versionArgs, tool.versionRegex);
        const installed = version !== null;

        return {
          id:          tool.id,
          name:        tool.name,
          installed,
          version,
          description: tool.description,
          downloadUrl: tool.downloadUrl,
          docsUrl:     tool.docsUrl,
        };
      })
    );
    res.json(results);
  } catch (err) {
    console.error('[systemTools]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
