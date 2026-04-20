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
const { execFile }   = require('child_process');
const { promisify }  = require('util');
const which          = process.platform === 'win32' ? 'where' : 'which';

const router       = express.Router();
const execFileAsync = promisify(execFile);

// ─── Tool registry ────────────────────────────────────────────────────────────

const TOOLS = [
  {
    id:          'kubectl',
    name:        'kubectl',
    binary:      'kubectl',
    versionArgs: ['version', '--client', '--short'],
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
    versionArgs: ['version', '--short'],
    // version output: "v3.14.0+g3fc9f4b"
    versionRegex: /v(\d+\.\d+\.\d+)/,
    description: 'Optional: enables Helm chart management from the dashboard.',
    downloadUrl: 'https://helm.sh/docs/intro/install/',
    docsUrl:     'https://helm.sh/docs/intro/install/',
  },
];

// ─── Detection helpers ────────────────────────────────────────────────────────

/**
 * Check if a binary exists in PATH.
 * Returns true/false — does NOT throw.
 */
async function isBinaryInPath(binary) {
  try {
    await execFileAsync(which, [binary], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `binary ...versionArgs` and parse out the version string.
 * Returns null on any failure.
 */
async function detectVersion(binary, versionArgs, regex) {
  try {
    const { stdout, stderr } = await execFileAsync(binary, versionArgs, {
      timeout: 5000,
      windowsHide: true,
    });
    const combined = (stdout + stderr).trim();
    const match    = combined.match(regex);
    return match ? match[1] : combined.split('\n')[0].trim() || null;
  } catch (e) {
    // Some tools write version to stderr (e.g. aws --version)
    const errOut = (e.stderr || e.stdout || '').trim();
    const match  = errOut.match(regex);
    return match ? match[1] : null;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.get('/tools', async (_req, res) => {
  try {
    const results = await Promise.all(
      TOOLS.map(async tool => {
        const installed = await isBinaryInPath(tool.binary);
        const version   = installed
          ? await detectVersion(tool.binary, tool.versionArgs, tool.versionRegex)
          : null;

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
